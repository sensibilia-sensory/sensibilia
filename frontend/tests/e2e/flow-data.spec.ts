import { proveWide, recoverWide } from './wide-export-workflow';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { csvRecords } from './csv';
import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { timeoutScale } from '../timeouts';

test(
  'Data gallery wide ledger keyboard scroll, states, density and axe',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(90000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    const fixture = page.getByRole('region', { name: 'Data fixtures' });
    const ledger = fixture.getByRole('region', { name: 'Data provenance', exact: true });
    await expect(ledger.locator('tbody tr[data-row-id]')).toHaveCount(20);
    await capture(page, 'slice-7-gallery-data', 'desktop', '#data');
    const scroll = page.getByRole('region', { name: 'Data provenance scroll area' });
    await scroll.focus();
    await page.keyboard.press('End');
    await scroll.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(
      ledger.getByRole('columnheader', { name: 'Serving plan JSON', exact: true }),
    ).toBeInViewport();
    await capture(page, 'slice-7-gallery-data-right');
    for (const state of ['Empty', 'Loading', 'Error']) {
      await fixture.getByRole('tab', { name: state, exact: true }).click();
      await expect(ledger.locator('thead')).toBeVisible();
      await capture(page, 'slice-7-gallery-data-' + state.toLowerCase(), 'desktop', '#data');
    }
    await fixture.getByRole('button', { name: 'Retry data' }).click();
    await expect(ledger.locator('tbody tr[data-row-id]')).toHaveCount(20);
  },
);

test('Data real API RATA states, corrections, scope and lossless CSV download', async ({
  page,
  request,
}) => {
  test.setTimeout(90000 * timeoutScale);
  const access = 'e2e-researcher-' + 'x'.repeat(32),
    headers = { Authorization: 'Bearer ' + access };
  const study = await (
    await request.post('/studies', { headers, data: { title: 'Slice 7 RATA data' } })
  ).json();
  const studyId = study.id,
    versionId = study.versions[0].id;
  const sample = await (
    await request.post('/studies/' + studyId + '/samples', {
      headers,
      data: { code: '317', label: 'Å, "香り"\nprivate' },
    })
  ).json();
  const questions = ['zero', 'unrated', 'unselected', 'skipped', 'missing'];
  const method = await (
    await request.post('/studies/' + studyId + '/tests', {
      headers,
      data: {
        test_type_id: 'rata-v1',
        configuration: {
          kind: 'rata',
          instructions: 'Rate coded sample',
          sample_ids: [sample.id],
          questions: questions.map((id) => ({ id, prompt: id })),
          scale_labels: ['None', 'High'],
          rating_min: 0,
          require_ratings: false,
          allow_skips: true,
        },
      },
    })
  ).json();
  expect((await request.post('/studies/' + studyId + '/publish', { headers })).status()).toBe(200);
  const session = await (
    await request.post('/sessions', {
      headers,
      data: { study_version_id: versionId, assessor_code: 'Å, "quoted"\nline' },
    })
  ).json();
  const sessionHeaders = { Authorization: 'Bearer ' + session.session_token };
  const values = [
    { kind: 'rata', state: 'selected', rating: 0 },
    { kind: 'rata', state: 'selected', rating: null },
    { kind: 'rata', state: 'unselected', rating: null },
    { kind: 'rata', state: 'skipped', rating: null },
  ];
  const events = values.map((value, i) => ({
    client_event_id: randomUUID(),
    study_test_id: method.id,
    sample_id: sample.id,
    question_id: questions[i],
    value,
    recorded_at: '2026-10-11T12:00:00Z',
  }));
  const url = '/sessions/' + session.id + '/responses';
  expect((await request.post(url, { headers: sessionHeaders, data: { events } })).status()).toBe(
    200,
  );
  const retried = await (
    await request.post(url, { headers: sessionHeaders, data: { events } })
  ).json();
  expect(retried.events.every((e: { status: string }) => e.status === 'duplicate')).toBeTruthy();
  const correction = {
    ...events[0],
    client_event_id: randomUUID(),
    supersedes_event_id: events[0].client_event_id,
    value: { kind: 'rata', state: 'selected', rating: 1 },
  };
  expect(
    (await request.post(url, { headers: sessionHeaders, data: { events: [correction] } })).status(),
  ).toBe(200);
  await page.goto('/researcher/studies/' + studyId + '/versions/' + versionId + '/data');
  await page.getByLabel('Access key', { exact: true }).fill(access);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const ledger = page.getByTestId('data-ledger');
  await expect(ledger.locator('tbody tr[data-row-id]')).toHaveCount(6);
  await capture(page, 'slice-7-rata-data', 'desktop', '#main');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export long CSV', exact: true }).click();
  const records = csvRecords(await readFile((await (await downloading).path())!, 'utf8'));
  expect(records).toHaveLength(6);
  const original = records.find((r) => r.client_event_id === events[0].client_event_id)!;
  expect(JSON.parse(original.value_json)).toEqual(values[0]);
  expect(original.is_current).toBe('False');
  const current = records.find((r) => r.client_event_id === correction.client_event_id)!;
  expect(current.is_current).toBe('True');
  expect(current.supersedes_event_id).toBe(events[0].client_event_id);
  expect(
    records.every(
      (r) => r.assessor_code === session.assessor_code && r.study_version_id === versionId,
    ),
  ).toBeTruthy();
  expect(original.sample_label).toBe(sample.label);
  const missing = records.find((r) => r.row_kind === 'expected_missing')!;
  expect(missing.value_json).toBe('null');
  expect(missing.client_event_id).toBe('');
  expect(missing.recorded_at).toBe('');
  for (const [i, value] of values.entries())
    expect(
      JSON.parse(records.find((r) => r.client_event_id === events[i].client_event_id)!.value_json),
    ).toEqual(value);
  await proveWide(request, headers, studyId, versionId);
  await page.getByLabel('Export format', { exact: true }).selectOption('wide');
  await page.getByLabel('Export history', { exact: true }).selectOption('current');
  const wideDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export wide CSV', exact: true }).click();
  const wideRows = recoverWide(
    csvRecords(await readFile((await (await wideDownload).path())!, 'utf8')),
  );
  expect(wideRows.some((r) => r.client_event_id === events[0].client_event_id)).toBe(false);
  expect(wideRows.some((r) => r.client_event_id === correction.client_event_id)).toBe(true);
  expect(wideRows.some((r) => r.state === 'missing')).toBe(true);
  await page.getByLabel('Export format', { exact: true }).selectOption('long');
  await page.getByLabel('Export history', { exact: true }).selectOption('all');
  const draft = await (await request.post('/studies/' + studyId + '/drafts', { headers })).json();
  await page.goto('/researcher/studies/' + studyId + '/versions/' + draft.id + '/data');
  await page.getByLabel('Access key', { exact: true }).fill(access);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(ledger).toContainText('No data for this scope.');
  await capture(page, 'slice-7-empty-data', 'desktop', '#main');
  const emptyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export long CSV', exact: true }).click();
  const emptyCSV = await readFile((await (await emptyDownload).path())!, 'utf8');
  expect(csvRecords(emptyCSV)).toEqual([]);
  expect(emptyCSV).toContain('value_json');
  expect(emptyCSV).toContain('row_kind');
  await page.getByLabel('Data scope', { exact: true }).selectOption('');
  await expect(ledger.locator('tbody tr[data-row-id]')).toHaveCount(6);
  expect(
    (
      await request.get('/studies/' + studyId + '/data?study_version_id=' + randomUUID(), {
        headers,
      })
    ).status(),
  ).toBe(404);
});
