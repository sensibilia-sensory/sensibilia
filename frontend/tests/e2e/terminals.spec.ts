import { test, expect, type Page } from '@playwright/test';
import { capture } from './capture';
import { issuePairing, publishSmallStudy, researcherHeaders } from './seed';

async function signIn(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test(
  'terminal gallery density, audit and loading empty error read-only states',
  { tag: '@audit' },
  async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Laboratory terminals', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Terminal fixtures', exact: true });
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'List', exact: true })
        .getByTestId('terminals-table')
        .locator('tbody tr[data-row-id]'),
    ).toHaveCount(20);
    await capture(page, 'slice-11-gallery-terminals', 'desktop', '#terminals');
    await gallery.getByRole('tab', { name: 'Empty', exact: true }).click();
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'Empty', exact: true })
        .getByText('No registered terminals.', { exact: true }),
    ).toBeVisible();
    await gallery.getByRole('tab', { name: 'Loading', exact: true }).click();
    await expect(gallery.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await gallery.getByRole('tab', { name: 'Error', exact: true }).click();
    await expect(gallery.getByRole('alert')).toContainText('Cannot reach');
    await gallery.getByRole('button', { name: 'Retry terminals' }).click();
    await expect(gallery.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await gallery.getByRole('tab', { name: 'Read-only', exact: true }).click();
    await expect(gallery.getByLabel('Registered terminal ID', { exact: true })).toBeDisabled();
    await expect(gallery.getByRole('button', { name: 'Prepare this tablet' })).toBeDisabled();
    await gallery.getByRole('tab', { name: 'Audit', exact: true }).click();
    await expect(gallery.getByTestId('terminal-audit')).toContainText('researcher:fixture');
    await capture(page, 'slice-11-gallery-audit', 'desktop', '#terminals');
  },
);

test('unprepared assessor has no administrative controls or study selection', async ({ page }) => {
  await page.goto('/assessor/');
  await expect(page.getByRole('heading', { name: 'Waiting for staff preparation' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/assessor/manifest.webmanifest',
  );
  await page.goto('/assessor/sessions/10000000-0000-4000-8000-000000000001');
  await expect(page.getByRole('alert')).toContainText('not the task prepared');
  await capture(page, 'slice-11-unprepared-tablet', 'desktop', 'page');
});

test('a tablet is removed from the list from its row, and nothing is deleted', async ({
  page,
  request,
}) => {
  const code = await issuePairing(request);
  const paired = await (await request.post('/terminal-pairings/redeem', { data: { code } })).json();
  await signIn(page, '/researcher/terminals');
  const table = page.getByTestId('terminals-table');
  const row = table
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: paired.name, exact: true }) });
  await row.getByRole('button', { name: 'Remove tablet…', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Terminal assignment', exact: true });
  await expect(panel).toContainText('Records still waiting on the tablet cannot be sent');
  // The staff name is required; no separate reason has to be typed.
  const confirm = panel.getByRole('button', { name: 'Remove ' + paired.name, exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Staff name', { exact: true }).fill('Anna');
  await confirm.click();
  await expect(
    page.getByRole('status').filter({ hasText: paired.name + ' removed' }),
  ).toBeVisible();
  // A removed tablet is not shown, and its name goes to the next tablet that is set up.
  await expect(row).toHaveCount(0);
  const again = await (
    await request.post('/terminal-pairings/redeem', { data: { code: await issuePairing(request) } })
  ).json();
  expect(again.name).toBe(paired.name);
  // Nothing is deleted: the removed tablet is still in the records, marked as removed.
  const listed = await (
    await request.get('/terminals?limit=200', { headers: researcherHeaders })
  ).json();
  const old = listed.find((t: { id: string }) => t.id === paired.terminal_id);
  expect(old.retired_at).not.toBeNull();
  expect(old.name).toContain('(removed');
});

test('a tablet with an assessment in progress cannot be removed', async ({ page, request }) => {
  const study = await publishSmallStudy(request, 'Remove guard study');
  const code = await issuePairing(request);
  const paired = await (await request.post('/terminal-pairings/redeem', { data: { code } })).json();
  const all = await (
    await request.get('/terminals?limit=200', { headers: researcherHeaders })
  ).json();
  const mine = all.find((t: { id: string }) => t.id === paired.terminal_id);
  expect(
    (
      await request.post('/terminals/' + mine.id + '/next-assessment', {
        headers: researcherHeaders,
        data: {
          expected_revision: mine.revision,
          staff_name: 'Anna',
          reason: 'First assessment',
          study_version_id: study.versionId,
        },
      })
    ).status(),
  ).toBe(200);
  await signIn(page, '/researcher/terminals');
  const row = page
    .getByTestId('terminals-table')
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: paired.name, exact: true }) });
  await row.getByRole('button', { name: 'Remove tablet…', exact: true }).click();
  await page.getByLabel('Staff name', { exact: true }).fill('Anna');
  const panel = page.getByRole('complementary', { name: 'Terminal assignment', exact: true });
  await expect(panel).toContainText('An assessment is still in progress on this tablet');
  await expect(
    panel.getByRole('button', { name: 'Remove ' + paired.name, exact: true }),
  ).toBeDisabled();
});
