import { proveWide } from './wide-export-workflow';
import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { expectFlowSaved } from './save';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { offlineLifecycle } from './offline-helpers';
import { proveCollection, proveCsv } from './complete-proof';
import { csvRecords } from './csv';
import { capture } from './capture';
import { evidencePath } from './evidence';
import { addStep, addMethodStep, startStudy } from './steps';
function stimulusPng() {
  const crc = (bytes: Buffer) => {
    let n = 0xffffffff;
    for (const b of bytes) {
      n ^= b;
      for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind: string, data: Buffer) => {
    const size = Buffer.alloc(4),
      sum = Buffer.alloc(4),
      typed = Buffer.concat([Buffer.from(kind), data]);
    size.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc(typed));
    return Buffer.concat([size, typed, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(128);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(64 * (128 * 3 + 1));
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 128; x++) {
      const at = y * (128 * 3 + 1) + 1 + x * 3;
      pixels[at + (x < 64 ? 0 : 2)] = 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Image stimuli in the same complete authoring/offline/export test. */
export async function assetsWorkflow(
  page: Page,
  request: APIRequestContext,
  headers: Record<string, string>,
  testInfo: TestInfo,
) {
  const bytes = stimulusPng(),
    sha = createHash('sha256').update(bytes).digest('hex');
  await startStudy(page);
  await page.getByLabel('Title', { exact: true }).fill('Slice 18 synthetic image study');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/flow'));
  const parts = new URL(page.url()).pathname.split('/'),
    study = parts[3],
    version = parts[5];
  const save = async () => {
    await page.getByRole('button', { name: 'Save flow', exact: true }).click();
    await expectFlowSaved(page);
  };
  await addStep(page, 'sample loop');
  await page.getByLabel('Step title', { exact: true }).fill('Image samples');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Sample code', { exact: true }).fill(String(841 + i));
    await page.getByLabel('Private label', { exact: true }).fill('Private image sample ' + i);
    await page.getByLabel('Ingredient tags', { exact: true }).fill('');
    await page.getByLabel('Tags reviewed', { exact: true }).check();
    await page.getByRole('button', { name: 'Create and include sample', exact: true }).click();
    // The fields clear when the sample exists and is in the loop; saving earlier races on slow runners.
    await expect(page.getByLabel('Sample code', { exact: true })).toHaveValue('');
  }
  await save();
  await addStep(page, 'info');
  await page.getByLabel('Step title', { exact: true }).fill('Reviewed image');
  await page
    .getByLabel('Text', { exact: true })
    .fill('Inspect the synthetic stimulus before rating.');
  await save();
  const editor = page.getByRole('region', { name: 'Info images', exact: true });
  await editor
    .getByLabel('Stimulus PNG', { exact: true })
    .setInputFiles({ name: 'private-original.png', mimeType: 'image/png', buffer: bytes });
  await editor.getByLabel('Image name', { exact: true }).fill('Private administrative image name');
  await editor.getByLabel('Alt text en', { exact: true }).fill('Red and blue synthetic stimulus');
  await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Attach', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Attach', exact: true }).click();
  await save();
  await editor.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await capture(page, 'slice-18-authoring', 'desktop', '#main');
  await page
    .getByTestId('flow-outline')
    .getByRole('row')
    .filter({ hasText: 'Image samples' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await addMethodStep(page, 'hedonic-9-v1');
  await page
    .getByLabel('Instructions', { exact: true })
    .fill('Rate overall liking on the reviewed scale.');
  await page.getByLabel('Question text 1', { exact: true }).fill('Overall liking');
  await page.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await save();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Red and blue synthetic stimulus', exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByRole('img', { name: 'Red and blue synthetic stimulus', exact: true })
      .evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
  ).toEqual({ width: 128, height: 64 });
  await capture(page, 'slice-18-preview', 'tablet', '#main');
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Frozen stimulus references' })).toBeVisible();
  await page
    .getByRole('region', { name: 'Frozen stimulus references scroll area', exact: true })
    .evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
  await capture(page, 'slice-18-release-manifest', 'desktop', '#main');
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  await page.getByRole('tab', { name: 'Assessments', exact: true }).click();
  await page.getByRole('button', { name: 'Provision session', exact: true }).click();
  await page.getByLabel('Assessor code', { exact: true }).fill('IMAGE-18');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/sessions',
  );
  await page.getByRole('button', { name: 'Create session', exact: true }).click();
  const session = await (await created).json();
  const local = await offlineLifecycle({
    sessionId: session.id,
    token: session.session_token,
    profile: testInfo.outputPath('images'),
    request,
    origin: testInfo.project.use.baseURL,
    prefix: 'slice-18-tablet',
  });
  expect(local.package.evaluator_version).toBe('assets-v2.10');
  expect(local.package.assets).toHaveLength(1);
  expect(local.package.assets![0].sha256).toBe(sha);
  expect(JSON.stringify(local.package)).not.toContain('Private administrative');
  expect(JSON.stringify(local.package)).not.toContain('Private image sample');
  const proof = await proveCollection(request, headers, local);
  const exported = await (
    await request.get('/studies/' + study + '/export?study_version_id=' + version, { headers })
  ).text();
  proveCsv(csvRecords(exported), proof.ledger);
  await proveWide(request, headers, study, version);
  const frozen = await (
    await request.get('/studies/' + study + '/versions/' + version, { headers })
  ).json();
  const clone = await (
    await request.post('/studies/' + study + '/drafts', { headers, data: {} })
  ).json();
  const assets = await (
    await request.get('/studies/' + study + '/versions/' + clone.id + '/assets', { headers })
  ).json();
  expect(assets[0].id).not.toBe(local.package.assets![0].id);
  expect(assets[0].sha256).toBe(sha);
  expect(
    await (await request.get('/studies/' + study + '/versions/' + version, { headers })).json(),
  ).toEqual(frozen);
  await writeFile(
    evidencePath('slice-18-reconciliation.json'),
    JSON.stringify(
      {
        study_version_id: version,
        session_id: local.id,
        sha256: sha,
        bytes: bytes.length,
        atomic_UUIDs: proof.allIds.length,
        CSV_rows: proof.ledger.length,
        missing_asset_blocks_preparation: true,
        offline_restart_exact_image: true,
      },
      null,
      2,
    ),
  );
}
