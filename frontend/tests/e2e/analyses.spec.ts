import { test, expect } from '@playwright/test';
import { publishSmallStudy, researcherHeaders } from './seed';

// Analysis add-on on a real published study. Without the add-on the screen says
// how to add it and refuses to run; with it, the analysis runs by itself and shows its answer.
test('analyses: suggested from the study, runs or explains the add-on, calculator works', async ({
  page,
  request,
}) => {
  const { studyId, versionId } = await publishSmallStudy(request, 'Analyses ' + Date.now());
  const addOn = await (
    await request.get('/analysis/status', { headers: researcherHeaders })
  ).json();
  await page.goto(`/researcher/studies/${studyId}/versions/${versionId}/analyses`);
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  const screen = page.getByRole('region', { name: 'Analyses', exact: true });
  const suggestions = screen.getByRole('region', {
    name: 'Analyses for this version',
    exact: true,
  });
  await expect(suggestions.locator('tbody tr')).toHaveCount(1);
  await expect(suggestions).toContainText('Compare liking between samples');
  await suggestions.getByRole('button', { name: 'Set up', exact: true }).click();
  const detail = screen.getByRole('complementary', { name: 'Analysis detail', exact: true });
  await expect(detail.getByLabel('Compare samples with', { exact: true })).toHaveValue('tukey');
  await detail.getByLabel('Your name', { exact: true }).fill('E2E scientist');
  const run = detail.getByRole('button', { name: 'Run analysis', exact: true });

  if (addOn.state !== 'ready') {
    await expect(screen.getByRole('status').first()).toContainText('Add analysis (R)');
    await expect(run).toBeDisabled();
  } else {
    await run.click();
    await expect(detail.getByRole('status')).toBeHidden({ timeout: 60000 });
    await expect(detail.getByLabel('Answer', { exact: true })).toBeVisible();
  }

  await screen.getByRole('button', { name: 'Assessors needed…', exact: true }).click();
  const calculator = page.getByRole('complementary', { name: 'Assessors needed', exact: true });
  await calculator.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(calculator.getByRole('status')).toContainText('assessors');
});
