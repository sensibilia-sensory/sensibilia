import { test, expect, type Page } from '@playwright/test';
import { axeScan } from './audit';
import { openStaff } from './offline-helpers';

// The tablet shell frames the screen, keeps one pinned action and uses touch sizes.
const frame = 4;
const openSample = async (page: Page) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Sessions and offline', exact: true }).click();
  const gallery = page.getByRole('region', { name: 'Session fixtures', exact: true });
  await gallery.getByRole('tab', { name: 'Sample question', exact: true }).click();
  return gallery.getByRole('tabpanel', { name: 'Sample question', exact: true });
};

test('tablet shell: frame, top bar, touch targets and one pinned primary action', async ({
  page,
}) => {
  const panel = await openSample(page);
  const shell = panel.locator('.ui-assessor');
  const outer = (await shell.boundingBox())!;
  const surface = (await shell.locator('.ui-assessor-surface').boundingBox())!;
  expect(surface.x - outer.x).toBeGreaterThanOrEqual(frame);
  expect(surface.y - outer.y).toBeGreaterThanOrEqual(frame);
  expect(outer.x + outer.width - (surface.x + surface.width)).toBeGreaterThanOrEqual(frame);
  expect(outer.y + outer.height - (surface.y + surface.height)).toBeGreaterThanOrEqual(frame);

  expect((await panel.locator('.ui-assessor-bar').boundingBox())?.height).toBe(56);
  await expect(panel.getByText('Sample 1 of 3')).toBeVisible();
  await expect(panel.locator('.ui-sample-code')).toHaveText('417');
  const progress = panel.getByRole('progressbar', { name: 'Sample progress' });
  await expect(progress).toHaveAttribute('aria-valuenow', '1');
  await expect(progress).toHaveAttribute('aria-valuemax', '3');

  // The pinned action is the only primary button, tall enough for a thumb, in the accent colour.
  const primary = panel.locator('.ui-assessor-actions .ui-button--primary');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText('Save and continue');
  expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await expect(primary).toHaveCSS('background-color', 'rgb(10, 90, 208)');
  const actions = (await panel.locator('.ui-assessor-actions').boundingBox())!;
  expect(Math.round(actions.y + actions.height)).toBe(Math.round(surface.y + surface.height) - 1);

  // Every choice row and button is at least 48px tall.
  for (const target of await panel.locator('.ui-choice-scale label, .ui-button').all())
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(48);

  // Staff information stays off the participant's screen until the corner is held.
  await expect(panel.getByRole('region', { name: 'Staff status' })).toHaveCount(0);
  const staff = await openStaff(panel);
  await expect(staff.getByRole('status')).toContainText('Synchronised');
  await staff.getByRole('button', { name: 'Close staff status' }).click();
  await expect(staff).toHaveCount(0);
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 800, height: 1280 },
]) {
  test(`no assessor content touches the screen edge at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/assessor/');
    await expect(
      page.getByRole('heading', { name: 'Waiting for staff preparation' }),
    ).toBeVisible();
    const edges = await page.evaluate((inset) => {
      const bad: string[] = [];
      for (const el of document.body.querySelectorAll('*')) {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (
          box.left < inset ||
          box.top < inset ||
          box.right > innerWidth - inset ||
          box.bottom > innerHeight - inset
        )
          if (!el.matches('#root, .ui-assessor')) bad.push(el.tagName + '.' + el.className);
      }
      return {
        bad,
        scrolls: document.documentElement.scrollHeight > innerHeight,
        theme: document.documentElement.getAttribute('data-theme'),
      };
    }, frame);
    // The frame and surface are the outermost boxes; everything inside sits inside the frame.
    expect(edges.bad).toEqual([]);
    expect(edges.scrolls).toBe(false);
    expect(edges.theme).toBeNull();
    const action = page.getByRole('button', { name: 'Retry assigned assessment' });
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  });
}

test('tablet shell passes the accessibility scan', { tag: '@audit' }, async ({ page }) => {
  await openSample(page);
  await axeScan(page, '.ui-assessor');
  await page.goto('/assessor/');
  await expect(page.getByRole('heading', { name: 'Waiting for staff preparation' })).toBeVisible();
  await axeScan(page, 'page');
});
