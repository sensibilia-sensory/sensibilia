import { proveWide } from './wide-export-workflow';
import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { expectFlowSaved } from './save';
import { offlineLifecycle } from './offline-helpers';
import { proveCollection, proveCsv } from './complete-proof';
import { csvRecords } from './csv';
import { capture } from './capture';
import { writeFile } from 'node:fs/promises';
import { evidencePath } from './evidence';
import { addStep, addMethodStep, startStudy } from './steps';
/** Temporal methods in the established authoring/offline/reconciliation test. */
export async function temporalWorkflow(
  page: Page,
  request: APIRequestContext,
  headers: Record<string, string>,
  testInfo: TestInfo,
) {
  await startStudy(page);
  await page.getByLabel('Title', { exact: true }).fill('Slice 17 synthetic temporal protocol');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/flow'));
  const parts = new URL(page.url()).pathname.split('/'),
    study = parts[3],
    version = parts[5];
  const save = async () => {
    await page.getByRole('button', { name: 'Save flow', exact: true }).click();
    await expectFlowSaved(page);
  };
  await addStep(page, 'info');
  await page
    .getByLabel('Text', { exact: true })
    .fill('Synthetic timing rehearsal. Follow the configured start cue.');
  await save();
  await addStep(page, 'sample loop');
  await page.getByLabel('Step title', { exact: true }).fill('Temporal samples');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Sample code', { exact: true }).fill(String(731 + i));
    await page.getByLabel('Private label', { exact: true }).fill('Private temporal ' + i);
    await page.getByLabel('Ingredient tags', { exact: true }).fill('');
    await page.getByLabel('Tags reviewed', { exact: true }).check();
    await page.getByRole('button', { name: 'Create and include sample', exact: true }).click();
    // The fields clear when the sample exists and is in the loop; saving earlier races on slow runners.
    await expect(page.getByLabel('Sample code', { exact: true })).toHaveValue('');
  }
  await save();
  await addMethodStep(page, 'tcata-v1');
  const editor = page.getByRole('complementary').last();
  const attributes = editor.getByRole('region', {
    name: 'Temporal attributes editor',
    exact: true,
  });
  await attributes
    .getByRole('textbox', { name: 'Question text', exact: true })
    .nth(0)
    .fill('Sweet');
  await editor.getByRole('button', { name: 'Add Temporal attribute', exact: true }).click();
  await attributes
    .getByRole('textbox', { name: 'Question text', exact: true })
    .nth(1)
    .fill('Bitter');
  await editor.getByLabel('Duration ms', { exact: true }).fill('3000');
  await editor.getByLabel('Start instruction', { exact: true }).fill('Taste when pressing Start.');
  await capture(page, 'slice-17-authoring', 'desktop', '#main');
  await editor.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await save();
  // A hedonic task and ordinary instruction retain every earlier offline retry phase.
  await addMethodStep(page, 'hedonic-9-v1');
  await page
    .getByLabel('Instructions', { exact: true })
    .fill('Rate overall liking on the reviewed nine-point scale.');
  await page.getByLabel('Question text 1', { exact: true }).fill('Overall liking');
  await page.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await save();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  let writes = 0;
  const listener = (r: { method: () => string; url: () => string }) => {
    if (r.method() === 'POST' && /temporal-runs|responses|path-events/.test(r.url())) writes++;
  };
  page.on('request', listener);
  await page.getByRole('button', { name: 'Start temporal run', exact: true }).click();
  await page.getByRole('button', { name: 'Sweet · unselected', exact: true }).click();
  await expect(page.getByText(/complete ·/)).toBeVisible({ timeout: 15000 });
  await capture(page, 'slice-17-preview', 'tablet', '#main');
  expect(writes).toBe(0);
  page.off('request', listener);
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  const session = await (
    await request.post('/sessions', {
      headers,
      data: { study_version_id: version, assessor_code: 'TEMPORAL-17' },
    })
  ).json();
  const local = await offlineLifecycle({
    sessionId: session.id,
    token: session.session_token,
    profile: testInfo.outputPath('tcata'),
    request,
    origin: testInfo.project.use.baseURL,
    prefix: 'slice-17-tablet',
  });
  const proof = await proveCollection(request, headers, local);
  expect(local.package.evaluator_version).toBe('temporal-v2.9');
  expect(JSON.stringify(local.package)).not.toContain('Private temporal');
  const runs = proof.ledger.filter((r) => r.row_kind === 'temporal_run');
  expect(runs).toHaveLength(2);
  expect(new Set(runs.map((r) => r.state))).toEqual(new Set(['complete', 'interrupted']));
  expect(runs.some((r) => r.interruption_flags_json?.includes('reload'))).toBe(true);
  const exported = await (
    await request.get('/studies/' + study + '/export?study_version_id=' + version, { headers })
  ).text();
  proveCsv(csvRecords(exported), proof.ledger);
  await proveWide(request, headers, study, version);
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(page.getByTestId('data-ledger').locator('tbody tr[data-row-id]')).toHaveCount(
    proof.ledger.length,
  );
  const scroll = page.getByRole('region', { name: 'Data provenance scroll area', exact: true });
  await scroll.focus();
  // Scroll horizontally only, then align the region with the page top. A keyboard End
  // press here started an animated page scroll that raced this alignment.
  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
  });
  await expect(
    page.getByRole('columnheader', { name: 'Temporal elapsed ms', exact: true }),
  ).toBeInViewport();
  await capture(page, 'slice-17-data');
  await writeFile(
    evidencePath('slice-17-reconciliation.json'),
    JSON.stringify(
      {
        study_version_id: version,
        session_id: local.id,
        runs: runs.length,
        transitions: proof.ledger.filter((r) => r.row_kind === 'temporal_transition').length,
        atomic_UUIDs: proof.allIds.length,
        CSV_rows: proof.ledger.length,
      },
      null,
      2,
    ),
  );
}
