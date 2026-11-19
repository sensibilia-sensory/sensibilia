import { test, expect } from '@playwright/test';
import { axeScan } from './audit';

test(
  'gallery: study lifecycle, sample battery and theme menu states',
  { tag: '@audit' },
  async ({ page }) => {
    await page.goto('/dev/ui');
    const gallery = page.locator('#study-lifecycle');
    await gallery.scrollIntoViewIfNeeded();

    await expect(gallery.getByTestId('lifecycle-studies')).toContainText('In progress');
    await expect(gallery.getByTestId('lifecycle-studies')).toContainText('Closed');
    await axeScan(page, '#study-lifecycle');

    await gallery.getByRole('tab', { name: 'Close panel', exact: true }).click();
    await expect(gallery.getByLabel(/End the 2 assessments/)).toBeVisible();
    await axeScan(page, '#study-lifecycle');

    await gallery.getByRole('tab', { name: 'Archive blocked', exact: true }).click();
    await expect(gallery.getByRole('button', { name: 'Archive study' })).toBeDisabled();

    await gallery.getByRole('tab', { name: 'Archive panel', exact: true }).click();
    await expect(gallery.getByRole('button', { name: 'Archive study' })).toBeEnabled();

    await gallery.getByRole('tab', { name: 'Archive view', exact: true }).click();
    await expect(gallery.getByTestId('archived-studies')).toContainText('Cider tasting 2025');
    await expect(gallery.getByRole('button', { name: 'Restore' })).toBeVisible();

    await gallery.getByRole('tab', { name: 'End assessment', exact: true }).click();
    await gallery.getByRole('button', { name: 'End assessment', exact: true }).click();
    await expect(gallery.getByRole('button', { name: 'End now', exact: true })).toBeVisible();
    await gallery.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      gallery.getByRole('button', { name: 'End assessment', exact: true }),
    ).toBeVisible();

    await gallery.getByRole('tab', { name: 'Sample battery', exact: true }).click();
    await expect(gallery.getByTestId('battery-samples').first().locator('tbody tr')).toHaveCount(4);
    await axeScan(page, '#study-lifecycle');

    await gallery.getByRole('tab', { name: 'Theme menu', exact: true }).click();
    await expect(gallery.getByLabel('Theme', { exact: true })).toBeVisible();
    await axeScan(page, '#study-lifecycle');
  },
);
