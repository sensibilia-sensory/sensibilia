import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { timeoutScale } from '../timeouts';
test(
  'Snapshot gallery read-only states job status density and axe',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(90000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Snapshots and analysis', exact: true }).click();
    const fixture = page.getByRole('region', { name: 'Snapshot fixtures' });
    await fixture.getByLabel('Snapshot label', { exact: true }).fill('Reviewed gallery cut');
    await fixture.getByRole('button', { name: 'Freeze dataset snapshot', exact: true }).click();
    await expect(fixture.getByRole('status')).toContainText('Reviewed gallery cut');
    const table = fixture.getByRole('region', { name: 'Dataset snapshots', exact: true });
    await expect(table.locator('tbody tr[data-row-id]')).toHaveCount(17);
    await fixture.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const proof = await capture(
      page,
      'slice-20-gallery-snapshots',
      'desktop',
      '#snapshots-gallery',
    );
    expect(
      proof.metrics.tables.find((t) => t.name === 'Dataset snapshots')?.rowsVisible,
    ).toBeGreaterThanOrEqual(15);
    expect(proof.metrics.fieldsVisible).toBeGreaterThanOrEqual(2);
    for (const state of ['Empty', 'Loading', 'Error']) {
      await fixture.getByRole('tab', { name: state, exact: true }).click();
      await expect(table.locator('thead')).toBeVisible();
      await capture(
        page,
        'slice-20-gallery-' + state.toLowerCase(),
        'desktop',
        '#snapshots-gallery',
      );
    }
    await fixture.getByRole('button', { name: 'Retry snapshots', exact: true }).click();
    await expect(table.locator('tbody tr[data-row-id]')).toHaveCount(17);
    await fixture.getByRole('tab', { name: 'Jobs', exact: true }).click();
    const jobs = fixture.getByRole('region', { name: 'Snapshot analysis jobs' });
    await expect(jobs.locator('tbody tr[data-row-id]')).toHaveCount(17);
    await fixture.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const jobProof = await capture(page, 'slice-20-gallery-jobs', 'desktop', '#snapshots-gallery');
    expect(
      jobProof.metrics.tables.find((t) => t.name === 'Snapshot analysis jobs')?.rowsVisible,
    ).toBeGreaterThanOrEqual(15);
  },
);
