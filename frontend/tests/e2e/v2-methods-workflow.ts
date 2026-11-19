import { initialState, currentNode, advance, type Flow } from '../../src/shared/flow';
import { rehearsalPackage } from '../../src/shared/nodes/rehearsal';
import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { expectFlowSaved } from './save';
import { offlineLifecycle, answerMethodTask } from './offline-helpers';
import { proveCollection, proveCsv } from './complete-proof';
import { csvRecords } from './csv';
import { capture } from './capture';
import { writeFile } from 'node:fs/promises';
import { evidencePath } from './evidence';
import { addStep, addMethodStep, startStudy } from './steps';
/** The next phase of the existing continuous proof, with an explicitly eligible set protocol. */
export async function registeredMethodsWorkflow(
  page: Page,
  request: APIRequestContext,
  headers: Record<string, string>,
  testInfo: TestInfo,
) {
  page.setDefaultTimeout(20000);
  await startStudy(page);
  await page.getByLabel('Title', { exact: true }).fill('Slice 15 reviewed registered methods');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/flow'));
  const parts = new URL(page.url()).pathname.split('/');
  const study = parts[3],
    version = parts[5];
  const api = '/studies/' + study + '/versions/' + version;
  const base = '/researcher' + api;
  const save = async () => {
    await page.getByRole('button', { name: 'Save flow', exact: true }).click();
    await expectFlowSaved(page);
  };
  await addStep(page, 'sample loop');
  const loop = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByLabel('Step title', { exact: true }).fill('Attribute samples');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Sample code', { exact: true }).fill(String(317 + i));
    await page.getByLabel('Private label', { exact: true }).fill('Private method product ' + i);
    await page.getByLabel('Ingredient tags', { exact: true }).fill('');
    await page.getByLabel('Tags reviewed', { exact: true }).check();
    await page.getByRole('button', { name: 'Create and include sample', exact: true }).click();
    // The fields clear when the sample exists and is in the loop; saving earlier races on slow runners.
    await expect(page.getByLabel('Sample code', { exact: true })).toHaveValue('');
  }
  await save();
  await addStep(page, 'info');
  await page
    .getByLabel('Text', { exact: true })
    .fill('Follow reviewed instructions for each attribute sample.');
  await save();
  const ids = [
    'cata-v1',
    'rata-v1',
    'jar-v1',
    'triangle-v1',
    'duo-trio-v1',
    'flash-profile-v1',
    'napping-v1',
  ];
  for (const id of ids) {
    const close = page.getByRole('button', { name: 'Close Step settings', exact: true });
    if (await close.isVisible()) await close.click();
    if (['cata-v1', 'rata-v1', 'jar-v1'].includes(id))
      await page
        .getByTestId('flow-outline')
        .locator('tr[data-row-id="' + loop + '"]')
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
    else {
      await page.goto(base + '/flow');
      await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await addMethodStep(page, id);
    const editor = page.getByRole('complementary').last();
    if (['cata-v1', 'rata-v1', 'jar-v1'].includes(id))
      await editor
        .getByLabel('Question text 1', { exact: true })
        .fill(id.replace('-v1', '') + ' sweetness');
    if (id === 'rata-v1') {
      await editor.getByLabel('First scale value', { exact: true }).fill('0');
      await editor.getByLabel('Require ratings', { exact: true }).uncheck();
      await editor.getByLabel('Allow skips', { exact: true }).check();
      await editor.getByRole('button', { name: 'Add Attribute', exact: true }).click();
      await editor.getByLabel('Question text 2', { exact: true }).fill('rata aroma');
    }
    if (id === 'jar-v1') {
      await editor.getByRole('button', { name: 'Add Attribute', exact: true }).click();
      await editor.getByLabel('Question text 2', { exact: true }).fill('jar optional');
      await editor.getByLabel('Must be answered 2', { exact: true }).uncheck();
    }
    await capture(page, 'slice-15-editor-' + id, 'desktop', '#main');
    await editor.getByRole('button', { name: 'Add configured method', exact: true }).click();
    await save();
  }
  const draft = await (await request.get(api, { headers })).json();
  const tests = await (await request.get(api + '/tests', { headers })).json();
  expect(tests.map((t: { test_type_id: string }) => t.test_type_id)).toEqual(ids);
  expect(
    draft.form.nodes[0].data.children.filter((n: { kind: string }) => n.kind === 'embedded_method'),
  ).toHaveLength(3);
  const samples = await (await request.get(api + '/samples', { headers })).json();
  const rehearsal = rehearsalPackage(draft.form, tests, samples);
  expect(rehearsal.issues).toEqual([]);
  let preview = initialState(draft.form, {}, rehearsal.assignments, rehearsal.methodAssignments);
  let previewWrites = 0;
  const observe = (r: { method: () => string; url: () => string }) => {
    if (r.method() === 'POST' && /responses|form-events|path-events/.test(r.url())) previewWrites++;
  };
  page.on('request', observe);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  for (let i = 0; i < 50 && !preview.outcome; i++) {
    const node = currentNode(draft.form as Flow, preview)!;
    if (node.kind === 'embedded_method')
      await answerMethodTask(
        page,
        tests.find((t: { id: string }) => t.id === node.data.study_test_id)!,
        rehearsal.methodAssignments,
        preview.loop?.position,
      );
    await page
      .getByRole('button', { name: node.kind === 'info' ? 'Continue' : 'Next', exact: true })
      .click();
    preview = advance(draft.form, preview, undefined);
  }
  expect(preview.outcome).toBe('completed');
  await expect(
    page.getByRole('status').filter({ hasText: 'Thank you for participating.' }),
  ).toBeVisible();
  expect(previewWrites).toBe(0);
  page.off('request', observe);
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await expect(page.getByLabel('Acknowledge freeze', { exact: true })).toBeEnabled();
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  const session = await (
    await request.post('/sessions', {
      headers,
      data: { study_version_id: version, assessor_code: 'METHODS-15' },
    })
  ).json();
  const local = await offlineLifecycle({
    sessionId: session.id,
    token: session.session_token,
    // Chromium CacheStorage filenames must fit Windows path limits.
    profile: testInfo.outputPath('methods'),
    request,
    prefix: 'slice-15-methods-tablet',
    origin: testInfo.project.use.baseURL,
  });
  expect(local.package.evaluator_version).toBe('methods-v2.8');
  expect(JSON.stringify(local.package)).not.toContain('Private method product');
  const proof = await proveCollection(request, headers, local);
  const values = proof.observations.flatMap((o) => ('value' in o ? [o.value] : []));
  expect(values.some((v) => 'kind' in v && v.kind === 'cata' && v.state === 'unselected')).toBe(
    true,
  );
  expect(
    values.some(
      (v) => 'kind' in v && v.kind === 'rata' && v.state === 'selected' && v.rating === 0,
    ),
  ).toBe(true);
  expect(
    values.some(
      (v) => 'kind' in v && v.kind === 'rata' && v.state === 'selected' && v.rating === null,
    ),
  ).toBe(true);
  expect(values.some((v) => 'kind' in v && v.kind === 'rata' && v.state === 'skipped')).toBe(true);
  expect(
    proof.ledger.some(
      (r) =>
        r.row_kind === 'expected_missing' &&
        r.question_id === tests[2].configuration.questions[1].id,
    ),
  ).toBe(true);
  proveCsv(
    csvRecords(
      await (
        await request.get('/studies/' + study + '/export?study_version_id=' + version, { headers })
      ).text(),
    ),
    proof.ledger,
  );
  await writeFile(
    evidencePath('slice-15-methods-reconciliation.json'),
    JSON.stringify(
      {
        study_version_id: version,
        session_id: local.id,
        methods: ids,
        observations: proof.observations.length,
        form_events: proof.form.length,
        path_events: proof.paths.length,
        atomic_event_ids: proof.allIds,
        csv_rows: proof.ledger.length,
        expected_missing: proof.ledger.filter((r) => r.row_kind === 'expected_missing').length,
        exact_retry_and_csv: true,
        shared_replay_equal: true,
      },
      null,
      2,
    ) + '\n',
  );
}
