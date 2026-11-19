import { offlineLifecycle, openStaff } from './offline-helpers';
import { test, expect } from '@playwright/test';
import { capture } from './capture';
import { proveCollection, proveCsv } from './complete-proof';
import { csvRecords } from './csv';
import { writeFile } from 'node:fs/promises';
import { timeoutScale } from '../timeouts';
import { evidencePath } from './evidence';

test(
  'session gallery list, states, once-only read-only token and tablet targets',
  { tag: '@audit' },
  async ({ page }) => {
    // Three full axe scans take ~10 s each on CI runners.
    test.setTimeout(90000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Sessions and offline', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Session fixtures', exact: true });
    await expect(
      gallery.getByTestId('sessions-table').locator('tbody tr[data-row-id]'),
    ).toHaveCount(20);
    await capture(page, 'slice-6-gallery-sessions', 'desktop', '#sessions');
    await gallery.getByRole('tab', { name: 'Empty', exact: true }).click();
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'Empty', exact: true })
        .getByText('No sessions for this version.'),
    ).toBeVisible();
    await gallery.getByRole('tab', { name: 'Loading', exact: true }).click();
    await expect(gallery.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await gallery.getByRole('tab', { name: 'Error', exact: true }).click();
    await expect(gallery.getByRole('alert')).toContainText('Cannot reach');
    await gallery.getByRole('button', { name: 'Retry sessions' }).click();
    await expect(gallery.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await gallery.getByRole('tab', { name: 'Credential', exact: true }).click();
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'Credential', exact: true })
        .getByLabel('Session token', { exact: true }),
    ).toHaveAttribute('readonly', '');
    await capture(page, 'slice-6-gallery-credential', 'desktop', '#sessions');
    await gallery.getByRole('button', { name: 'Close credential' }).click();
    await expect(gallery.getByRole('tabpanel', { name: 'Credential', exact: true })).toHaveCount(0);
    await gallery.getByRole('tab', { name: 'Tablet', exact: true }).click();
    await expect((await openStaff(gallery)).getByRole('status')).toContainText('3 pending');
    for (const button of await gallery
      .getByRole('region', { name: 'Assigned sensory session' })
      .getByRole('button')
      .all()) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await capture(page, 'slice-6-gallery-tablet', 'desktop', '#sessions');
    await gallery.getByRole('tab', { name: 'Read-only', exact: true }).click();
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'Read-only', exact: true })
        .getByText('Review only · answers are locked'),
    ).toBeVisible();
  },
);

test('restricted offline session survives reload and browser restart, then retries exact events', async ({
  request,
}, testInfo) => {
  test.setTimeout(150000 * timeoutScale);
  const headers = { Authorization: 'Bearer e2e-researcher-' + 'x'.repeat(32) };
  const study = await (
    await request.post('/studies', { headers, data: { title: 'Slice 6 offline contract' } })
  ).json();
  const v = study.versions[0].id,
    base = '/studies/' + study.id + '/versions/' + v;
  const method = await (
    await request.post('/studies/' + study.id + '/tests', {
      headers,
      data: {
        configuration: {
          instructions: 'Taste and rate.',
          questions: [{ id: 'liking', prompt: 'Liking', required: true }],
          allow_skips: false,
        },
      },
    })
  ).json();
  const samples = [];
  for (let i = 0; i < 4; i++)
    samples.push(
      await (
        await request.post('/studies/' + study.id + '/samples', {
          headers,
          data: { code: 'S' + i, label: 'Private ' + i, ingredient_tags: i === 1 ? ['nut'] : [] },
        })
      ).json(),
    );
  const node = (kind: string, data: object) => ({
    id: crypto.randomUUID(),
    kind,
    title: { en: kind },
    data,
    otherwise: { action: 'continue' },
  });
  const restriction = node('question', {
    prompt: { en: 'Restrictions' },
    answer_type: 'multiple',
    options: [
      { id: 'nuts', label: { en: 'Nuts' }, exclusive: false },
      { id: 'none', label: { en: 'None' }, exclusive: true },
    ],
    required: true,
    allow_skip: false,
  });
  const rating = {
    ...node('embedded_method', { study_test_id: method.id, sample_binding: 'current' }),
    guard: { variable: 'derived.sample_conflicts_restriction', operator: 'eq', value: false },
    otherwise: { action: 'next_sample' },
  };
  const taggedStates = (['missing', 'skipped', 'unselected'] as const).map((state) => ({
    state,
    node: node('question', {
      prompt: { en: state + ' fixture' },
      answer_type: 'multiple',
      options: [
        { id: 'a', label: { en: 'A' } },
        { id: 'b', label: { en: 'B' } },
      ],
      required: false,
      allow_skip: true,
    }),
  }));
  const flow = {
    schema_version: 2,
    languages: ['en'],
    default_language: 'en',
    restriction_source_id: restriction.id,
    restriction_tag_map: { nuts: ['nut'] },
    nodes: [
      node('info', {
        body: { en: 'Read the laboratory instructions.' },
        continue_label: { en: 'Continue' },
        asset_ids: [],
      }),
      restriction,
      ...taggedStates.map((fixture) => fixture.node),
      node('question', {
        prompt: { en: 'Zero' },
        answer_type: 'integer',
        min: 0,
        max: 5,
        required: true,
        allow_skip: false,
      }),
      node('loop_samples', {
        sample_ids: samples.map((s) => s.id),
        children: [
          node('code_entry', {
            prompt: { en: 'Sample code' },
            source: 'sample_code',
            allow_unknown: false,
            normalization: 'trim_upper_ascii',
          }),
          rating,
        ],
      }),
      node('end', { body: { en: 'Thank you.' }, outcome: 'completed' }),
    ],
  };
  const ver = await (await request.get(base, { headers })).json();
  expect(
    (
      await request.put(base + '/form', {
        headers,
        data: { form: flow, revision_hash: ver.revision_hash },
      })
    ).status(),
  ).toBe(200);
  const review = await (await request.get(base + '/validation', { headers })).json();
  expect(review.valid).toBeTruthy();
  expect(
    (
      await request.post('/studies/' + study.id + '/publish', {
        headers,
        data: { study_version_id: v, revision_hash: review.revision_hash },
      })
    ).status(),
  ).toBe(200);
  const cycles = [];
  for (let cycle = 1; cycle <= 3; cycle++) {
    const session = await (
      await request.post('/sessions', {
        headers,
        data: { study_version_id: v, assessor_code: 'OFFLINE-' + cycle },
      })
    ).json();
    const credential = { Authorization: 'Bearer ' + session.session_token };
    expect(
      (
        await request.get('/sessions/' + crypto.randomUUID() + '/test', { headers: credential })
      ).status(),
    ).toBe(401);
    const foreign = await (
      await request.post('/studies', { headers, data: { title: 'Foreign' } })
    ).json();
    const foreignMethod = await (
      await request.post('/studies/' + foreign.id + '/tests', {
        headers,
        data: { configuration: method.configuration },
      })
    ).json();
    expect(
      (
        await request.post('/sessions/' + session.id + '/responses', {
          headers: credential,
          data: {
            events: [
              {
                client_event_id: crypto.randomUUID(),
                study_test_id: foreignMethod.id,
                question_id: 'liking',
                value: { state: 'rated', rating: 9 },
                recorded_at: new Date().toISOString(),
              },
            ],
          },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await request.post('/sessions/' + session.id + '/path-events', {
          headers: credential,
          data: {
            events: [
              {
                client_event_id: crypto.randomUUID(),
                seq: 1,
                step_id: flow.nodes[0].id,
                occurrence_id: 'study',
                kind: 'entered',
                reason: 'restriction',
                recorded_at: new Date().toISOString(),
              },
            ],
          },
        })
      ).status(),
    ).toBe(422);
    let beforeRetry: Awaited<ReturnType<typeof proveCollection>> | undefined;
    const local = await offlineLifecycle({
      sessionId: session.id,
      token: session.session_token,
      profile: testInfo.outputPath('persistent-tablet-' + cycle),
      prefix: 'slice-11-cycle-' + cycle,
      storageStall: cycle === 1,
      audit: cycle === 1,
      origin: testInfo.project.use.baseURL,
      request,
      taskStates: Object.fromEntries(taggedStates.map(({ node, state }) => [node.id, state])),
      beforeRetry: async (saved) => {
        beforeRetry = await proveCollection(request, headers, saved);
      },
    });
    const proof = await proveCollection(request, headers, local);
    expect(proof).toEqual(beforeRetry);
    expect(proof.form.map((row) => 'value' in row && row.value)).toEqual(
      expect.arrayContaining([
        { state: 'missing' },
        { state: 'skipped' },
        { state: 'answered', value: [] },
        { state: 'answered', value: 0 },
      ]),
    );
    const exported = await request.get('/studies/' + study.id + '/export', { headers });
    expect(exported.status()).toBe(200);
    const csv = csvRecords(await exported.text()).filter((r) => r.session_id === local.id);
    proveCsv(csv, proof.ledger);
    expect(local.package.loop_assignments?.[0].samples.map((s) => s.sample_id)).toEqual(
      samples.map((s) => s.id),
    );
    const observations = (
      await (await request.get('/studies/' + study.id + '/responses', { headers })).json()
    ).filter((row: { session_id: string }) => row.session_id === session.id);
    expect(observations).toHaveLength(3);
    expect(
      new Set(observations.map((r: { client_event_id: string }) => r.client_event_id)).size,
    ).toBe(3);
    const form = (
      await (await request.get('/studies/' + study.id + '/form-responses', { headers })).json()
    ).filter((row: { session_id: string }) => row.session_id === session.id);
    expect(
      form.some(
        (r: { value: { state: string; value?: number } }) =>
          r.value.state === 'answered' && r.value.value === 0,
      ),
    ).toBeTruthy();
    cycles.push({
      cycle,
      session_id: session.id,
      observations: proof.observations.length,
      form_answers: proof.form.length,
      path_events: proof.paths.length,
      unique_event_ids: proof.allIds.length,
      csv_rows: csv.length,
      exact_retry_unchanged: true,
      shared_replay_identical: true,
    });
  }
  await writeFile(
    evidencePath('slice-11-three-cycle-reconciliation.json'),
    JSON.stringify({ study_id: study.id, study_version_id: v, cycles }, null, 2) + '\n',
  );
});
