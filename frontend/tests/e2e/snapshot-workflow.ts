import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { components } from '../../src/api-schema';
import { csvRecords } from './csv';
import { capture } from './capture';
import { python } from '../python';
import { evidencePath } from './evidence';
const execute = promisify(execFile);
type Snapshot = components['schemas']['SnapshotRead'];
type Job = components['schemas']['JobRead'];
export async function snapshotWorkflow(
  page: Page,
  request: APIRequestContext,
  headers: Record<string, string>,
  study: string,
  version: string,
) {
  await page.getByLabel('Data scope', { exact: true }).selectOption(version);
  await page.getByLabel('Export history', { exact: true }).selectOption('all');
  const scope = page.getByRole('region', { name: 'Snapshots and analysis', exact: true });
  await scope.getByLabel('Snapshot staff name', { exact: true }).fill('Browser proof scientist');
  await scope.getByLabel('Snapshot label', { exact: true }).fill('Continuous reviewed cut');
  await scope.getByRole('button', { name: 'Freeze dataset snapshot', exact: true }).click();
  const table = scope.getByRole('region', { name: 'Dataset snapshots', exact: true });
  await expect(table).toContainText('Continuous reviewed cut');
  const base = '/studies/' + study + '/snapshots';
  const snapshots: Snapshot[] = await (await request.get(base, { headers })).json();
  const item = snapshots.find((s) => s.label === 'Continuous reviewed cut')!;
  expect(item.study_version_id).toBe(version);
  expect(item.manifest.row_count).toBe(69);
  const row = table.locator('tr[data-row-id="' + item.id + '"]');
  const download = page.waitForEvent('download');
  await scope.getByRole('button', { name: 'Long CSV', exact: true }).click();
  const frozenCsv = await readFile((await (await download).path())!, 'utf8');
  const liveCsv = await (
    await request.get('/studies/' + study + '/export?study_version_id=' + version, { headers })
  ).text();
  expect(csvRecords(frozenCsv)).toEqual(csvRecords(liveCsv));
  const frozenWide = await (
    await request.get(base + '/' + item.id + '/export?format=wide', { headers })
  ).text();
  const selectedRows = csvRecords(frozenWide).flatMap((r) =>
    Object.entries(r)
      .filter(([k, v]) => k.startsWith('w_') && v)
      .flatMap(([, v]) => JSON.parse(v)),
  );
  expect(selectedRows).toHaveLength(item.manifest.row_count);
  const canonicalRows = JSON.stringify(
    selectedRows.sort((a, b) => a.row_id.localeCompare(b.row_id)),
  );
  const archiveDownload = page.waitForEvent('download');
  await scope.getByRole('button', { name: 'Archive', exact: true }).click();
  expect((await archiveDownload).suggestedFilename()).toBe(item.id + '.zip');
  await row.getByRole('button', { name: 'Inspect', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Frozen dataset manifest', exact: true });
  await expect(
    panel.getByRole('region', { name: 'Snapshot checksums', exact: true }),
  ).toContainText('dictionary.json');
  const manifestDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download manifest JSON', exact: true }).click();
  expect(JSON.parse(await readFile((await (await manifestDownload).path())!, 'utf8'))).toEqual(
    item.manifest,
  );
  await panel.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await capture(page, 'slice-20-live-manifest', 'desktop', '#main');
  await page.getByRole('button', { name: 'Close Frozen dataset manifest', exact: true }).click();
  await table.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await capture(page, 'slice-20-live-snapshots');
  await scope.getByRole('button', { name: 'Queue ledger census', exact: true }).click();
  const jobs = scope.getByRole('region', { name: 'Snapshot analysis jobs', exact: true });
  await expect(jobs).toContainText('queued');
  await jobs.getByRole('button', { name: 'Cancel job', exact: true }).click();
  await expect(jobs).toContainText('cancelled');
  await expect(jobs.getByRole('button', { name: 'Result JSON', exact: true })).toBeDisabled();
  const image = process.env.SENSIBILIA_ANALYSIS_TEST_IMAGE;
  const results: string[] = [];
  if (image) {
    const harness = JSON.parse(await readFile(evidencePath('slice-20-e2e-harness.json'), 'utf8'));
    expect(harness.database_url).toMatch(/sensibilia-e2e-.*browser.db/);
    for (let i = 0; i < 2; i++) {
      await scope.getByRole('button', { name: 'Queue ledger census', exact: true }).click();
      const inventory: Job[] = await (
        await request.get(base + '/' + item.id + '/jobs', { headers })
      ).json();
      const job = inventory.find((j) => j.status === 'queued')!;
      const proof = await execute(
        python,
        ['-m', 'sensibilia.analysis_worker', job.id, '--image', image],
        {
          env: {
            ...process.env,
            SENSIBILIA_DATABASE_URL: harness.database_url,
            SENSIBILIA_RESEARCHER_TOKEN: headers.Authorization.replace('Bearer ', ''),
          },
          timeout: 90000,
          windowsHide: true,
        },
      );
      expect(proof.stdout.trim()).toBe('succeeded');
      await scope.getByRole('button', { name: 'Refresh jobs', exact: true }).click();
      const jobRow = jobs.locator('tr[data-row-id="' + job.id + '"]');
      await expect(jobRow).toContainText('succeeded');
      const resultDownload = page.waitForEvent('download');
      await jobRow.getByRole('button', { name: 'Result JSON', exact: true }).click();
      const result: Job = JSON.parse(
        await readFile((await (await resultDownload).path())!, 'utf8'),
      );
      expect(result.result?.dataset_sha256).toBe(item.manifest.dataset_sha256);
      expect(result.result?.row_count).toBe(item.manifest.row_count);
      expect(result.result?.states).toEqual(item.manifest.states);
      expect(result.image).toBe(image);
      results.push(result.result_sha256!);
    }
    expect(results[0]).toBe(results[1]);
  }
  const after = await (
    await request.get(base + '/' + item.id + '/export?format=long', { headers })
  ).text();
  expect(after).toBe(frozenCsv);
  await jobs.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await capture(page, 'slice-20-live-jobs', 'desktop', '#main');
  await writeFile(
    evidencePath('slice-20-reconciliation.json'),
    JSON.stringify(
      {
        study_id: study,
        snapshot_id: item.id,
        rows: item.manifest.row_count,
        dataset_sha256: item.manifest.dataset_sha256,
        wide_roundtrip_sha256: createHash('sha256').update(canonicalRows).digest('hex'),
        frozen_csv_unchanged: true,
        job_result_hashes: results,
        container_reproduction_exercised: !!image,
      },
      null,
      2,
    ) + '\n',
  );
}
