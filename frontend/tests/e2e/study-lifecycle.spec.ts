import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { publishSmallStudy, researcherHeaders } from './seed';

const signIn = async (page: Page, path: string) => {
  await page.goto(path);
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
};
const startAssessment = (request: APIRequestContext, versionId: string, code: string) =>
  request.post('/sessions', {
    headers: researcherHeaders,
    data: { study_version_id: versionId, assessor_code: code },
  });
const row = (page: Page, title: string) =>
  page.getByTestId('studies-table').locator('tbody tr', { hasText: title });

test('closing a study can end the open assessments, and archiving moves it to the Archive', async ({
  page,
  request,
}) => {
  const title = 'Lifecycle ' + Date.now();
  const { versionId } = await publishSmallStudy(request, title);
  expect((await startAssessment(request, versionId, 'A001')).status()).toBe(201);
  await signIn(page, '/researcher/studies');

  // Open assessments are visible in the list and block archiving, with the way out explained.
  await expect(row(page, title)).toContainText('Open');
  await expect(row(page, title)).toContainText('1');
  await row(page, title).getByRole('button', { name: 'Archive', exact: true }).click();
  const panel = page.getByRole('complementary');
  await expect(panel).toContainText('still in progress');
  await expect(panel.getByRole('button', { name: 'Archive study', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Close and end the open assessment in one step.
  await row(page, title).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel(/End the 1 assessment/).check();
  await panel.getByRole('button', { name: 'Close study', exact: true }).click();
  await expect(row(page, title)).toContainText('Closed');
  await expect(row(page, title).getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  expect((await startAssessment(request, versionId, 'A002')).status()).toBe(409);

  // Archive: leaves the Studies list, appears under Archive, comes back with Restore.
  await row(page, title).getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Archive study', exact: true }).click();
  await expect(row(page, title)).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive', exact: true }).first().click();
  const archived = page.getByTestId('archived-studies').locator('tbody tr', { hasText: title });
  await expect(archived).toContainText('Archived');
  await archived.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(archived).toHaveCount(0);

  await page.getByRole('button', { name: 'Studies', exact: true }).click();
  await expect(row(page, title)).toContainText('Closed');
  await row(page, title).getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(row(page, title)).toContainText('Open');
  expect((await startAssessment(request, versionId, 'A003')).status()).toBe(201);
});

test('staff can end a single assessment from the Sessions tab', async ({ page, request }) => {
  const title = 'Sessions ' + Date.now();
  const { studyId, versionId } = await publishSmallStudy(request, title);
  expect((await startAssessment(request, versionId, 'A001')).status()).toBe(201);
  await signIn(page, `/researcher/studies/${studyId}/versions/${versionId}/sessions`);
  const sessions = page.getByTestId('sessions-table');
  await expect(sessions).toContainText('In progress');
  await sessions.getByRole('button', { name: 'End assessment', exact: true }).click();
  await sessions.getByRole('button', { name: 'End now', exact: true }).click();
  await expect(sessions).toContainText('Ended by staff');
  await expect(sessions.getByRole('button', { name: 'End assessment' })).toHaveCount(0);
});
