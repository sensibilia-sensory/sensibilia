import {
  expect,
  type Page,
  type APIRequestContext,
  type BrowserContext,
  chromium,
  type Route,
} from '@playwright/test';
import type { LocalSession } from '../../src/assessor/storage';
import { currentNode, type Flow, type Answer } from '../../src/shared/flow';
import { capture } from './capture';
import type { Locator } from '@playwright/test';
import type { Package } from '../../src/assessor/storage';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { evidencePath } from './evidence';
export async function stored(page: Page, id: string): Promise<LocalSession> {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('sensibilia-assessor', 1);
        open.onsuccess = () => {
          const db = open.result,
            get = db.transaction('sessions').objectStore('sessions').get(id);
          get.onsuccess = () => {
            resolve(get.result);
            db.close();
          };
          get.onerror = () => reject(get.error);
        };
        open.onerror = () => reject(open.error);
      }),
    id,
  );
}
const researchRecord = ({ serving: _serving, ...record }: LocalSession) => record;
const servingUUIDs = (s: LocalSession) =>
  new Set([
    ...(s.serving?.pending ?? []).map((e) => e.client_event_id),
    ...(s.serving?.acknowledged ?? []).map((e) => e.client_event_id),
    ...(s.serving?.suppressed ?? []).map((e) => e.client_event_id),
  ]);
async function imageCacheProof(page: Page, pkg: Package) {
  for (const asset of pkg.assets ?? []) {
    const fact = await page.evaluate(async (asset) => {
      const cache = await caches.open('sensibilia-stimuli-1');
      const response = await cache.match(location.origin + '/assessor/stimuli/' + asset.sha256);
      if (!response) throw new Error('Missing cached stimulus');
      const blob = await response.blob(),
        buffer = await blob.arrayBuffer();
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      const bitmap = await createImageBitmap(blob);
      const result = { sha, size: blob.size, width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    }, asset);
    expect(fact).toEqual({
      sha: asset.sha256,
      size: asset.byte_size,
      width: asset.width,
      height: asset.height,
    });
    await expect(
      page.getByRole('img', {
        name: asset.alt_text[String(pkg.context?.language ?? 'en')],
        exact: true,
      }),
    ).toBeVisible();
    const display = await page
      .getByRole('img', {
        name: asset.alt_text[String(pkg.context?.language ?? 'en')],
        exact: true,
      })
      .boundingBox();
    expect(display!.width).toBeLessThanOrEqual(asset.width);
    expect(display!.height).toBeLessThanOrEqual(asset.height);
  }
}
export async function driveTask(
  page: Page,
  id: string,
  state?: 'missing' | 'skipped' | 'unselected',
  answer?: Answer,
) {
  const local = await stored(page, id),
    node = currentNode(local.package.flow as Flow, local.state)!;
  if (local.state.review) {
    await page.getByRole('button', { name: 'Return to flow', exact: true }).click();
    return;
  }
  if (state === 'skipped')
    await page.getByRole('button', { name: 'Skip question', exact: true }).click();
  else if (state === 'unselected')
    await page.getByRole('button', { name: 'No selections', exact: true }).click();
  else if (state === 'missing') {
    // Deliberately leave the optional input untouched.
  } else if (node.kind === 'consent')
    await page
      .getByRole('radio')
      .nth(answer?.state === 'answered' && answer.value === false ? 1 : 0)
      .check();
  else if (node.kind === 'confirm') await page.getByRole('checkbox').first().check();
  else if (node.kind === 'code_entry') {
    await page
      .getByRole('textbox')
      .fill(
        String(node.data.source === 'sample_code' ? local.state.variables['sample.code'] : 'ABC'),
      );
  } else if (node.kind === 'serve_gate') {
    await expect
      .poll(
        async () =>
          !!(await stored(page, id)).serving?.waits[
            local.package.serving_assignment!.id +
              ':' +
              (local.state.loop
                ? local.state.loop.id +
                  ':' +
                  local.state.assignments.find((a) => a.loop_id === local.state.loop!.id)!.samples[
                    local.state.loop.position
                  ].sample_id
                : 'study') +
              ':' +
              node.id
          ],
      )
      .toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Yes, I have them', exact: true })).toBeVisible();
    // The assessor's confirmation is the delivery: no staff action or waiting is needed.
    const before = local.state.path.length;
    await page.getByRole('button', { name: 'Yes, I have them', exact: true }).click();
    await expect
      .poll(async () => (await stored(page, id)).state.path.length)
      .toBeGreaterThan(before);
    return;
  } else if (node.kind === 'embedded_method') {
    await answerMethodTask(
      page,
      local.package.tests.find((t) => t.id === node.data.study_test_id)!,
      local.package.assignments ?? [],
      local.state.loop?.position,
      id,
    );
  } else if (node.kind === 'question') {
    if (node.data.answer_type === 'integer') await page.getByRole('spinbutton').fill('0');
    else if (node.data.answer_type === 'text')
      await page.getByRole('textbox').fill('Recorded answer');
    else if (node.data.answer_type === 'single') await page.getByRole('radio').first().check();
    else await page.getByRole('checkbox').first().check();
  } else if (node.kind === 'matrix_question') {
    if (answer?.state === 'matrix') {
      const language = String(local.package.context?.language ?? Object.keys(node.title)[0]);
      for (const row of node.data.rows) {
        const value = answer.answers[row.id];
        if (value?.state === 'skipped')
          await page
            .getByRole('button', { name: 'Skip ' + row.prompt[language], exact: true })
            .click();
        else if (value?.state === 'selected') {
          const option = node.data.options.find((o) => o.id === value.option_id)!;
          await page
            .getByRole('group', { name: row.prompt[language], exact: true })
            .getByRole('radio', { name: option.label[language], exact: true })
            .check();
        }
      }
    } else
      for (const group of await page.locator('fieldset.ui-choice-scale').all())
        await group.getByRole('radio').last().check();
  }
  const count = local.state.path.length;
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect.poll(async () => (await stored(page, id)).state.path.length).toBeGreaterThan(count);
}
export async function offlineLifecycle({
  sessionId,
  token,
  profile: profileName,
  request,
  prefix = 'slice-6-tablet',
  beforeRetry,
  origin = 'http://127.0.0.1:' + (process.env.E2E_PORT ?? '5173'),
  taskStates = {},
  taskAnswers = {},
  expectedOutcome = 'completed',
  terminal,
  afterHandover,
  onPending,
  storageStall = false,
  audit = false,
}: {
  sessionId: string;
  token: string;
  profile: string;
  request: APIRequestContext;
  prefix?: string;
  origin?: string;
  beforeRetry?: (local: LocalSession) => Promise<void>;
  taskStates?: Record<string, 'missing' | 'skipped' | 'unselected'>;
  taskAnswers?: Record<string, Answer>;
  expectedOutcome?: 'completed' | 'screened_out';
  terminal?: { id: string; terminal_token: string };
  storageStall?: boolean;
  // Scan the assessor states once per run; repeated lifecycles skip axe.
  audit?: boolean;
  onPending?: (
    page: Page,
    local: LocalSession,
    terminal: { id: string; terminal_token: string },
  ) => Promise<void>;
  afterHandover?: (
    page: Page,
    local: LocalSession,
    terminal: { id: string; terminal_token: string },
  ) => Promise<void>;
}) {
  // Keep the tablet profile path short. Chromium's CacheStorage files sit deep in the
  // profile; under test-results they exceed Windows MAX_PATH (260) and caches.open fails.
  const profile = await mkdtemp(join(tmpdir(), 'sensibilia-' + basename(profileName) + '-'));
  let context: BrowserContext = await chromium.launchPersistentContext(profile, {
    headless: true,
    ignoreHTTPSErrors: origin.startsWith('https:'),
    // Chromium's worker fetch requires a launch-level test certificate bypass.
    args: origin.startsWith('https:') ? ['--ignore-certificate-errors'] : [],
    viewport: { width: 1440, height: 900 },
  });
  let page = await context.newPage();
  try {
    const staffToken = 'e2e-researcher-' + 'x'.repeat(32);
    const staffHeaders = { Authorization: 'Bearer ' + staffToken };
    if (!terminal) {
      const registration = await request.post('/terminals', {
        headers: staffHeaders,
        data: {
          name: 'Tablet-' + sessionId,
          staff_name: 'Test technician',
          reason: 'Offline rehearsal',
        },
      });
      expect(registration.status(), await registration.text()).toBe(201);
      terminal = await registration.json();
      const assignment = await request.post('/terminals/' + terminal!.id + '/assignments', {
        headers: staffHeaders,
        data: {
          session_id: sessionId,
          expected_revision: 0,
          staff_name: 'Test technician',
          reason: 'Prepared assessment',
        },
      });
      expect(assignment.status(), await assignment.text()).toBe(200);
    }
    await page.goto(origin + '/researcher/terminals');
    await page.getByLabel('Access key', { exact: true }).fill(staffToken);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Registered terminal ID', { exact: true }).fill(terminal!.id);
    await page.getByLabel('Terminal access key', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'Prepare this tablet', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Terminal access key', { exact: true }).fill(terminal!.terminal_token);
    const imagePackage: Package = await (
      await request.get('/sessions/' + sessionId + '/test', {
        headers: { Authorization: 'Bearer ' + token },
      })
    ).json();
    if (imagePackage.assets?.length) {
      const pattern = '**/sessions/' + sessionId + '/assets/*';
      await context.route(pattern, (route) => route.abort('failed'));
      await page.getByRole('button', { name: 'Prepare this tablet', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await stored(page, sessionId)).toBeUndefined();
      await context.unroute(pattern);
    }
    if (storageStall) {
      // A stalled browser storage open must fail visibly and save nothing.
      await page.evaluate(() => {
        const open = CacheStorage.prototype.open;
        Object.assign(window, { restoreCacheOpen: () => (CacheStorage.prototype.open = open) });
        CacheStorage.prototype.open = () => new Promise<Cache>(() => {});
      });
      await page.getByRole('button', { name: 'Prepare this tablet', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Tablet image storage did not respond', {
        timeout: 25000,
      });
      expect(await stored(page, sessionId)).toBeUndefined();
      await page.evaluate(() =>
        (window as unknown as { restoreCacheOpen: () => void }).restoreCacheOpen(),
      );
    }
    await page.getByRole('button', { name: 'Prepare this tablet', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Tablet prepared.' })).toBeVisible({
      timeout: 45000,
    });
    await page.goto(origin + '/assessor/');
    await expect(page.getByLabel('Session token', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Assessor code', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Assigned sensory session' })).toBeVisible({
      timeout: 45000,
    });
    await capture(page, prefix + '-cached', 'desktop', audit ? 'page' : undefined);
    const cached = await stored(page, sessionId);
    if (cached.package.assets?.length) await imageCacheProof(page, cached.package);
    await context.setOffline(true);
    // Reload/restart with a committed rating and the next sample occurrence pending.
    for (let i = 0; i < 200; i++) {
      const local = await stored(page, sessionId);
      if (
        expectedOutcome === 'screened_out'
          ? local.state.outcome
          : local.state.loop && local.state.loop.position === 1
      )
        break;
      await driveTask(
        page,
        sessionId,
        taskStates[currentNode(local.package.flow as Flow, local.state)!.id],
        taskAnswers[currentNode(local.package.flow as Flow, local.state)!.id],
      );
    }
    if (expectedOutcome === 'completed')
      expect((await stored(page, sessionId)).state.loop?.position).toBe(1);
    else expect((await stored(page, sessionId)).state.outcome).toBe('screened_out');
    const interruptionRecord = await stored(page, sessionId);
    if (
      !interruptionRecord.outbox.some(
        (op) => op.endpoint === 'responses' || op.endpoint === 'temporal-runs',
      )
    ) {
      // A generated sequence may place the restricted sample first. Its durable
      // skipped path and ordinary answers are the interrupted records in that case.
      if (expectedOutcome === 'completed')
        expect(interruptionRecord.state.path.some((p) => p.reason === 'restriction')).toBe(true);
      else expect(interruptionRecord.state.outcome).toBe('screened_out');
      expect(interruptionRecord.outbox.some((op) => op.endpoint === 'form-events')).toBe(true);
    }

    let before = await stored(page, sessionId);
    await onPending?.(page, before, terminal!);
    expect(await stored(page, sessionId)).toEqual(before);
    expect(before.outbox.length).toBeGreaterThan(1);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Assigned sensory session' })).toBeVisible();
    expect(await stored(page, sessionId)).toEqual(before);
    await capture(page, prefix + '-offline-reload');
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      ignoreHTTPSErrors: origin.startsWith('https:'),
      // Chromium's worker fetch requires a launch-level test certificate bypass.
      args: origin.startsWith('https:') ? ['--ignore-certificate-errors'] : [],
      viewport: { width: 1440, height: 900 },
      offline: true,
    });
    page = await context.newPage();
    await page.goto(origin + '/assessor/sessions/' + sessionId);
    await expect(page.getByRole('region', { name: 'Assigned sensory session' })).toBeVisible();
    expect(await stored(page, sessionId)).toEqual(before);
    if (before.package.assets?.length) {
      await imageCacheProof(page, before.package);
      await capture(page, prefix + '-offline-image-restart', 'tablet', 'page');
    }
    for (let i = 0; i < 200; i++) {
      const local = await stored(page, sessionId);
      if (local.state.outcome) break;
      await driveTask(
        page,
        sessionId,
        taskStates[currentNode(local.package.flow as Flow, local.state)!.id],
        taskAnswers[currentNode(local.package.flow as Flow, local.state)!.id],
      );
    }
    before = await stored(page, sessionId);
    expect(before.state.outcome).toBe(expectedOutcome);
    if ((before.package.flow as Flow).restriction_source_id)
      expect(before.state.path.some((p) => p.reason === 'restriction')).toBeTruthy();
    // There is no button: reaching the end queues the completion by itself.
    await expect(page.getByRole('button', { name: 'Finish session' })).toHaveCount(0);
    await expect
      .poll(async () =>
        (await stored(page, sessionId)).outbox.some((o) => o.endpoint === 'complete'),
      )
      .toBeTruthy();
    await capture(page, prefix + '-offline-end', 'desktop', audit ? 'page' : undefined);
    const interruptions = [];
    // Real API commits are forwarded, then their acknowledgements are deliberately lost.
    // Also exercise server loss with navigator.onLine=true, before each dispatch.
    for (const endpoint of [
      'path-events',
      'form-events',
      'temporal-runs',
      'responses',
      'complete',
    ] as const) {
      if (endpoint === 'responses' && expectedOutcome === 'screened_out') continue;
      if (endpoint === 'temporal-runs' && !before.outbox.some((op) => op.endpoint === endpoint))
        continue;
      for (const committed of [false, true]) {
        let checkpoint: LocalSession | undefined;
        let acknowledgement: unknown;
        let handled = false;
        const pattern = '**/sessions/' + sessionId + '/' + endpoint;
        await context.route(pattern, async (route) => {
          if (handled) return route.continue();
          handled = true;
          checkpoint = await stored(page, sessionId);
          if (committed) {
            const response = await route.fetch();
            expect(response.status(), await response.text()).toBe(200);
            acknowledgement = await response.json();
          }
          await route.abort('connectionreset');
        });
        if (await page.evaluate(() => navigator.onLine))
          await (
            await openStaff(page)
          )
            .getByRole('button', { name: 'Synchronise saved events', exact: true })
            .click();
        else await context.setOffline(false);
        await expect.poll(() => handled).toBe(true);
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(
          (await openStaff(page)).getByRole('button', {
            name: 'Synchronise saved events',
            exact: true,
          }),
        ).toBeEnabled();
        expect(await page.evaluate(() => navigator.onLine)).toBe(true);
        expect(checkpoint?.outbox[0].endpoint).toBe(endpoint);
        expect(researchRecord(await stored(page, sessionId))).toEqual(researchRecord(checkpoint!));
        expect(servingUUIDs(await stored(page, sessionId))).toEqual(servingUUIDs(checkpoint!));
        expect(checkpoint!.finished).toBe(false);
        await context.unroute(pattern);
        if (committed) {
          interruptions.push({
            endpoint,
            event_ids: checkpoint!.outbox[0].events.map((e) => e.client_event_id),
            acknowledgement,
            record_sha256: createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex'),
            pending_retained: true,
            online_despite_failed_request: true,
          });
          if (endpoint === 'responses') await capture(page, prefix + '-lost-ack');
          await context.setOffline(true);
          await context.close();
          context = await chromium.launchPersistentContext(profile, {
            headless: true,
            ignoreHTTPSErrors: origin.startsWith('https:'),
            args: origin.startsWith('https:') ? ['--ignore-certificate-errors'] : [],
            viewport: { width: 1440, height: 900 },
            offline: true,
          });
          page = await context.newPage();
          await page.goto(origin + '/assessor/sessions/' + sessionId);
          await expect(
            page.getByRole('region', { name: 'Assigned sensory session' }),
          ).toBeVisible();
          expect(await stored(page, sessionId)).toEqual(checkpoint);
        }
      }
    }
    await writeFile(
      evidencePath(prefix + '-interruptions.json'),
      JSON.stringify({ session_id: sessionId, origin, interruptions }, null, 2) + '\n',
    );
    await context.setOffline(false);
    await expect
      .poll(async () => (await stored(page, sessionId)).finished, { timeout: 60000 })
      .toBeTruthy();
    await expect(
      (await openStaff(page)).getByRole('status').filter({ hasText: 'Synchronised' }),
    ).toBeVisible();
    const after = await stored(page, sessionId);
    expect(after.outbox).toEqual([]);
    expect(after.package).toEqual(cached.package);
    expect(after.token).toBe(cached.token);
    expect(after.acknowledged).toEqual([
      ...before.acknowledged,
      // The completion is queued by the tablet itself, so it may already be in `before`.
      ...before.outbox.filter((op) => op.endpoint !== 'complete'),
      ...after.acknowledged.filter((op) => op.endpoint === 'complete'),
    ]);
    expect(after.state).toEqual(before.state);
    await beforeRetry?.(after);
    // Exact retry after commit/finish simulates loss of acknowledgements. Every UUID is retained.
    for (const op of after.acknowledged) {
      if (op.endpoint === 'complete') continue;
      const retry = await request.post('/sessions/' + sessionId + '/' + op.endpoint, {
        headers: { Authorization: 'Bearer ' + token },
        data: { events: op.events },
      });
      expect(retry.status(), await retry.text()).toBe(200);
      expect(
        (await retry.json()).events.every((e: { status: string }) => e.status === 'duplicate'),
      ).toBeTruthy();
    }
    const progress = await request.get('/sessions/' + sessionId + '/progress', {
      headers: { Authorization: 'Bearer ' + token },
    });
    expect((await progress.json()).next_seq).toBe(after.state.path.length + 1);
    await capture(page, prefix + '-synchronised');
    await afterHandover?.(page, after, terminal!);
    return after;
  } catch (error) {
    await page.screenshot({ path: evidencePath(prefix + '-failure.png') }).catch(() => {});
    throw new Error(
      String(error) +
        '\nTablet: ' +
        (await page
          .locator('body')
          .innerText()
          .catch(() => 'Unavailable')),
    );
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

export async function answerMethodTask(
  page: Page,
  test: LocalSession['package']['tests'][number],
  assignments: NonNullable<LocalSession['package']['assignments']>,
  position?: number,
  temporalSessionId?: string,
) {
  const config = test.configuration;
  if (!('kind' in config)) {
    for (const group of await page.locator('fieldset.ui-choice-scale').all())
      await group.getByRole('radio').last().check();
  } else if (config.kind === 'tcata') {
    await page.getByRole('button', { name: 'Start temporal run', exact: true }).click();
    const a = config.attributes;
    let held: Route | undefined;
    const syncPattern = '**/sessions/' + temporalSessionId + '/path-events';
    if (temporalSessionId && position === 0) {
      await page.context().route(syncPattern, (route) => {
        held = route;
      });
      await page.context().setOffline(false);
      await expect.poll(() => !!held).toBe(true);
      await expect(
        page.getByRole('button', { name: a[0].prompt + ' · unselected', exact: true }),
      ).toBeEnabled();
    }
    await page.getByRole('button', { name: a[0].prompt + ' · unselected', exact: true }).click();
    await page.getByRole('button', { name: a[1].prompt + ' · unselected', exact: true }).click();
    if (held) {
      await held.abort('connectionreset');
      await expect(page.getByRole('alert')).toBeVisible();
      await page.context().unroute(syncPattern);
      await page.context().setOffline(true);
    }
    await expect(
      page.getByRole('button', { name: a[0].prompt + ' · selected', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    if (temporalSessionId && position === 1) {
      const before = await stored(page, temporalSessionId);
      const draft = Object.values(before.temporalDrafts!).find((d) => d.state === 'running')!;
      await page.reload();
      await expect(page.getByText(/Interrupted:.*reload/)).toBeVisible();
      const after = await stored(page, temporalSessionId);
      const restored = Object.values(after.temporalDrafts!).find(
        (d) => d.client_event_id === draft.client_event_id,
      )!;
      expect(restored.transitions).toEqual(draft.transitions);
      expect(restored.interruption_flags).toContain('reload');
      expect(restored.state).toBe('interrupted');
    } else {
      await page.getByRole('button', { name: a[0].prompt + ' · selected', exact: true }).click();
      await expect(page.getByText(/complete ·/)).toBeVisible({
        timeout: config.duration_ms + 10000,
      });
    }
  } else if (config.kind === 'cata') {
    // Explicit empty CATA: the shared renderer records every attribute unselected.
  } else if (config.kind === 'rata') {
    const checks = page.getByRole('checkbox');
    for (const checkbox of await checks.all()) await checkbox.check();
    await page.getByRole('radio').first().check();
    if (position === 1 && config.allow_skips && config.questions.length > 1)
      await page
        .getByRole('button', { name: 'Skip ' + config.questions[1].prompt, exact: true })
        .click();
  } else if (config.kind === 'jar') {
    for (const question of config.questions.filter((q) => q.required))
      await page
        .getByRole('group', { name: question.prompt + ': rating', exact: true })
        .getByRole('radio')
        .first()
        .check();
  } else if (config.kind === 'triangle' || config.kind === 'duo_trio' || config.kind === 'two_afc')
    await page.getByRole('radio').first().check();
  else if (config.kind === 'flash_profile') {
    await page.getByLabel('Descriptor 1', { exact: true }).fill('Toasted cereal');
    await page.getByRole('button', { name: 'Rank the samples', exact: true }).click();
    const assignment = assignments.find((a) => a.study_test_id === test.id)!;
    for (const [i, sample] of assignment.samples.entries())
      await page
        .getByLabel('Toasted cereal: sample ' + sample.code + ' rank', { exact: true })
        .selectOption(String(i + 1));
    await capture(page, 'slice-15-flash-task', 'tablet', 'page');
  } else if (config.kind === 'napping') {
    for (const sample of assignments.find((a) => a.study_test_id === test.id)!.samples) {
      await page.getByRole('button', { name: sample.code, exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
    }
    await capture(page, 'slice-15-napping-task', 'tablet', 'page');
  }
}

/** Staff status is hidden from participants: press and hold the corner to open it. */
export async function openStaff(scope: Page | Locator) {
  const region = scope.getByRole('region', { name: 'Staff status' });
  if (!(await region.isVisible()))
    await scope.getByRole('button', { name: 'Staff', exact: true }).click({ delay: 900 });
  await expect(region).toBeVisible();
  return region;
}
