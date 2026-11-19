import { test, expect } from '@playwright/test';
import { capture } from './capture';
import { timeoutScale } from '../timeouts';

test(
  'usability gallery templates checklist glossary and all states',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(120000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Study usability', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Study usability fixtures', exact: true });
    await expect(
      gallery.locator('[data-testid="study-templates"]:visible').locator('tbody tr[data-row-id]'),
    ).toHaveCount(20);
    await capture(page, 'slice-12-gallery-templates', 'desktop', '#usability');
    await gallery.getByRole('tab', { name: 'loading', exact: true }).click();
    await expect(
      gallery.locator('[role="status"]').filter({ hasText: 'Loading templates' }),
    ).toBeVisible();
    await gallery.getByRole('tab', { name: 'empty', exact: true }).click();
    await expect(gallery.getByText(/No templates registered/)).toBeVisible();
    await gallery.getByRole('tab', { name: 'error', exact: true }).click();
    await expect(gallery.getByRole('alert')).toContainText('Cannot reach');
    await gallery.getByRole('tab', { name: 'readonly', exact: true }).click();
    await expect(
      gallery.getByRole('button', { name: 'Use template', exact: true }).first(),
    ).toBeDisabled();
    await gallery.getByRole('tab', { name: 'checklist', exact: true }).click();
    await expect(
      gallery.getByTestId('study-checklist').locator('tbody tr[data-row-id]'),
    ).toHaveCount(6);
    await expect(gallery.getByTestId('study-checklist')).toContainText('Blocked');
    await gallery.getByText('Help and glossary', { exact: true }).click();
    await expect(gallery.getByTestId('study-glossary')).toContainText('Undo / redo');
    await capture(page, 'slice-12-gallery-checklist-help', 'desktop', '#usability');
  },
);
