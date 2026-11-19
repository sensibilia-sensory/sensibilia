import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { timeoutScale } from '../timeouts';
test(
  'Wide export gallery options dictionary states density and axe',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(90000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Wide export', exact: true }).click();
    const fixture = page.getByRole('region', { name: 'Wide export fixtures' });
    const table = fixture.getByRole('region', { name: 'Wide columns', exact: true });
    await expect(table.locator('tbody tr[data-row-id]')).toHaveCount(17);
    await fixture.getByLabel('Export history', { exact: true }).selectOption('current');
    await expect(fixture).toContainText('History: current');
    await fixture.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const proof = await capture(
      page,
      'slice-19-gallery-dictionary',
      'desktop',
      '#wide-export-gallery',
    );
    expect(
      proof.metrics.tables.find((t) => t.name === 'Wide columns')?.rowsVisible,
    ).toBeGreaterThanOrEqual(15);
    expect(proof.metrics.fieldsVisible).toBeGreaterThanOrEqual(2);
    for (const state of ['Empty', 'Loading', 'Error']) {
      await fixture.getByRole('tab', { name: state, exact: true }).click();
      await expect(table.locator('thead')).toBeVisible();
      if (state === 'Loading')
        await expect(fixture.getByLabel('Export format', { exact: true })).toBeDisabled();
      await fixture.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await capture(
        page,
        'slice-19-gallery-' + state.toLowerCase(),
        'desktop',
        '#wide-export-gallery',
      );
    }
    await fixture.getByRole('button', { name: 'Retry dictionary', exact: true }).click();
    await expect(table.locator('tbody tr[data-row-id]')).toHaveCount(17);
  },
);
