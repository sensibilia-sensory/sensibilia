import { readFile, writeFile } from 'node:fs/promises';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '../../src/api-schema';
import { csvRecords } from './csv';
import { capture } from './capture';
import { evidencePath } from './evidence';
type Row = components['schemas']['DataRowRead'];
type Dictionary = components['schemas']['ExportDictionaryRead'];
export function recoverWide(records: Record<string, string>[]): Row[] {
  return records.flatMap((record) =>
    Object.entries(record)
      .filter(([key, cell]) => key.startsWith('w_') && cell)
      .flatMap(([, cell]) => JSON.parse(cell) as Row[]),
  );
}
function ordered(rows: Row[]) {
  return [...rows].sort((a, b) => a.row_id.localeCompare(b.row_id));
}
export async function proveWide(
  request: APIRequestContext,
  headers: Record<string, string>,
  study: string,
  version: string,
) {
  const query = new URLSearchParams({ ...(version ? { study_version_id: version } : {}) });
  const source: Row[] = await (
    await request.get('/studies/' + study + '/data?' + query + '&limit=1000', { headers })
  ).json();
  for (const history of ['all', 'current']) {
    query.set('history', history);
    const dictionary: Dictionary = await (
      await request.get('/studies/' + study + '/export/dictionary?' + query, { headers })
    ).json();
    const response = await request.get('/studies/' + study + '/export?' + query + '&format=wide', {
      headers,
    });
    expect(response.status()).toBe(200);
    const records = csvRecords(await response.text());
    expect(ordered(recoverWide(records))).toEqual(
      ordered(source.filter((r) => history === 'all' || r.is_current !== false)),
    );
    for (const record of records)
      for (const column of dictionary.columns) {
        if (!record[column.column]) continue;
        for (const row of JSON.parse(record[column.column]) as Row[]) {
          expect(JSON.parse(column.key_json)).toEqual(
            Object.fromEntries(dictionary.key_fields.map((key) => [key, row[key as keyof Row]])),
          );
        }
      }
  }
  return source;
}
export async function wideExportWorkflow(
  page: Page,
  request: APIRequestContext,
  headers: Record<string, string>,
  study: string,
  version: string,
) {
  await page.goto('/researcher/studies/' + study + '/versions/' + version + '/data');
  await page
    .getByLabel('Access key', { exact: true })
    .fill(headers.Authorization.replace('Bearer ', ''));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Export format', { exact: true }).selectOption('wide');
  await page.getByRole('button', { name: 'Read wide dictionary', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Download dictionary JSON', exact: true }),
  ).toBeEnabled();
  const dictionaryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download dictionary JSON', exact: true }).click();
  const dictionary: Dictionary = JSON.parse(
    await readFile((await (await dictionaryDownload).path())!, 'utf8'),
  );
  expect(dictionary.study_version_id).toBe(version);
  const source = await proveWide(request, headers, study, version);
  await page
    .getByRole('region', { name: 'Wide export dictionary', exact: true })
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await capture(page, 'slice-19-live-dictionary', 'desktop', '#main');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export wide CSV', exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toContain(version + '-wide-all.csv');
  const records = csvRecords(await readFile((await downloaded.path())!, 'utf8'));
  expect(ordered(recoverWide(records))).toEqual(ordered(source));
  expect(Object.keys(records[0])).toEqual([
    ...dictionary.row_keys,
    ...dictionary.columns.map((c) => c.column),
  ]);
  expect(recoverWide(records).every((r) => r.study_version_id === version)).toBe(true);
  await page.getByLabel('Data scope', { exact: true }).selectOption('');
  await expect(
    page.getByRole('button', { name: 'Download dictionary JSON', exact: true }),
  ).toBeDisabled();
  const allSource = await proveWide(request, headers, study, '');
  expect(new Set(allSource.map((r) => r.study_version_id)).size).toBeGreaterThan(1);
  await page.getByLabel('Export history', { exact: true }).selectOption('current');
  const allDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export wide CSV', exact: true }).click();
  const allFile = await allDownload;
  expect(allFile.suggestedFilename()).toContain('all-versions-wide-current.csv');
  const allRecords = recoverWide(csvRecords(await readFile((await allFile.path())!, 'utf8')));
  expect(ordered(allRecords)).toEqual(ordered(allSource.filter((r) => r.is_current !== false)));
  await writeFile(
    evidencePath('slice-19-reconciliation.json'),
    JSON.stringify(
      {
        study_id: study,
        version_id: version,
        scoped_records: source.length,
        wide_session_rows: records.length,
        columns: dictionary.columns.length,
        all_version_records: allRecords.length,
        exact_roundtrip: true,
      },
      null,
      2,
    ) + '\n',
  );
}
