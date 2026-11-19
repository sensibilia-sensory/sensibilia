import { test, expect } from '@playwright/test';
import { capture } from './capture';
import { axeScan } from './audit';
import { timeoutScale } from '../timeouts';

// Analysis add-on: each distinct result state once, scanned and captured.
test(
  'gallery: analysis results, settings, add-on notice and calculator',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(90000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Analyses (add-on)', exact: true }).click();
    const fixture = page.getByRole('region', { name: 'Analysis fixtures' });
    const tab = async (name: string) => {
      await fixture.getByRole('tab', { name, exact: true }).click();
      await fixture.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    };
    const panel = fixture.getByRole('tabpanel');
    await fixture.evaluate((el) => el.scrollIntoView({ block: 'start' }));

    await expect(panel.getByLabel('Answer', { exact: true })).toContainText('731 was liked most');
    await expect(panel.getByRole('img', { name: 'Mean liking: Overall liking' })).toBeVisible();
    await capture(page, 'analysis-liking', 'desktop', '#analyses-gallery');

    await tab('Triangle result');
    await expect(panel.getByLabel('Answer', { exact: true })).toContainText('21 of 36 correct');
    await capture(page, 'analysis-triangle', 'desktop');

    await tab('Penalty result');
    await expect(panel.getByRole('img', { name: 'Penalty analysis' })).toBeVisible();
    await capture(page, 'analysis-penalty', 'desktop');

    await tab('CATA result');
    await expect(panel.getByRole('img', { name: 'Samples and attributes' })).toBeVisible();
    await panel.getByText('Details', { exact: true }).click();
    await capture(page, 'analysis-cata', 'desktop', '#analyses-gallery');

    await tab('RATA result');
    await expect(panel.getByRole('img', { name: 'Samples and attributes' })).toBeVisible();
    await expect(panel.getByRole('table', { name: 'Mean ratings' })).toContainText('3.9 a');
    await capture(page, 'analysis-rata', 'desktop', '#analyses-gallery');

    await tab('Failed');
    await expect(panel.getByRole('status')).toContainText('longer than 120 seconds');
    await expect(panel.getByRole('button', { name: 'Download Excel' })).toHaveCount(0);

    await tab('Settings');
    await expect(panel.getByLabel('Liking from', { exact: true })).toHaveValue('test-1');
    await expect(panel.getByRole('button', { name: 'Run analysis' })).toBeEnabled();
    await panel.getByLabel('Your name', { exact: true }).fill('');
    await expect(panel.getByRole('button', { name: 'Run analysis' })).toBeDisabled();
    await axeScan(page, '#analyses-gallery');

    await tab('Add-on missing');
    await expect(panel.getByRole('status')).toContainText('Add analysis (R)');

    await tab('Lists');
    await expect(
      panel.getByRole('region', { name: 'Analyses run' }).locator('tbody tr'),
    ).toHaveCount(6);
    await capture(page, 'analysis-lists', 'desktop', '#analyses-gallery');

    await tab('Assessors needed');
    await expect(panel.getByRole('status')).toContainText('42 assessors');
    await axeScan(page, '#analyses-gallery');
  },
);
