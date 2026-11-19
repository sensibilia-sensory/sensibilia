import { test, expect } from '@playwright/test';
import { capture } from './capture';
import { timeoutScale } from '../timeouts';
test(
  'asset primitives gallery states, density and accessibility',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(120000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Assets', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Assets gallery' });
    await expect(gallery.getByRole('img', { name: 'Reviewed red square' })).toBeVisible();
    await gallery
      .getByLabel('Stimulus file ready')
      .setInputFiles({ name: 'stimulus.png', mimeType: 'image/png', buffer: Buffer.from('test') });
    await expect(gallery.getByRole('button', { name: 'Upload image' })).toBeEnabled();
    await gallery.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await capture(page, 'slice-18-gallery-ready', 'desktop', '#assets-gallery');
    await gallery.getByRole('tab', { name: 'editor', exact: true }).click();
    await expect(gallery.getByRole('table', { name: 'Version images' })).toBeVisible();
    await gallery
      .getByRole('row')
      .filter({ hasText: 'Stimulus 1' })
      .first()
      .getByRole('button', { name: 'Attach', exact: true })
      .click();
    await expect(
      gallery
        .getByRole('row')
        .filter({ hasText: 'Stimulus 1' })
        .first()
        .getByRole('button', { name: 'Detach', exact: true }),
    ).toBeVisible();
    await gallery.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await gallery
      .getByRole('region', { name: 'Version images scroll area', exact: true })
      .evaluate((el) => {
        el.scrollLeft = 0;
      });
    await capture(page, 'slice-18-gallery-editor', 'desktop', '#assets-gallery');
    await gallery
      .getByRole('region', { name: 'Version images scroll area', exact: true })
      .evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
    await capture(page, 'slice-18-gallery-editor-right');
    await gallery.getByRole('tab', { name: 'manifest', exact: true }).click();
    await gallery.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect(gallery.getByRole('table', { name: 'Frozen stimulus references' })).toBeVisible();
    await capture(page, 'slice-18-gallery-manifest', 'desktop', '#assets-gallery');
    await gallery.getByRole('tab', { name: 'readonly', exact: true }).click();
    await expect(gallery.getByLabel('Stimulus file readonly')).toBeDisabled();
    await capture(page, 'slice-18-gallery-readonly', 'desktop', '#assets-gallery');
    await gallery.getByRole('tab', { name: 'empty', exact: true }).click();
    await expect(gallery.getByText('No images attached.')).toBeVisible();
    await gallery.getByRole('tab', { name: 'loading', exact: true }).click();
    await expect(gallery.getByText('Verifying frozen stimuli…')).toBeVisible();
    await gallery.getByRole('tab', { name: 'error', exact: true }).click();
    await expect(gallery.getByRole('alert')).toContainText('Stimulus could not be displayed');
    await expect(gallery.getByRole('button', { name: 'Retry image' })).toBeEnabled();
    await capture(page, 'slice-18-gallery-error', 'desktop', '#assets-gallery');
  },
);
