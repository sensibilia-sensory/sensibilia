import { test, expect, type Page } from '@playwright/test';

const signIn = async (page: Page) => {
  await page.goto('/researcher/studies');
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
};
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Researcher sections' });

test('the shell has a source-list sidebar with grouped, current-aware navigation', async ({
  page,
}) => {
  await signIn(page);
  const nav = sidebar(page);
  await expect(page.locator('.ui-brand')).toHaveText('Sensibilia');
  await expect(nav.getByRole('button', { name: 'Studies', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('button', { name: 'Run study', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await nav.locator('.ui-nav-label').allTextContents()).toEqual(['Laboratory', 'Reference']);
  // Compact rows and a toolbar of 44px, as in the design direction.
  const row = await nav.getByRole('button', { name: 'Run study', exact: true }).boundingBox();
  expect(row?.height).toBe(30);
  const bar = await page.locator('.ui-topbar').boundingBox();
  expect(bar?.height).toBe(44);

  await nav.getByRole('button', { name: 'Run study', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run study' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Run study', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('button', { name: 'Studies', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('the sidebar toggle hides and restores navigation', async ({ page }) => {
  await signIn(page);
  const toggle = page.getByRole('button', { name: 'Hide navigation' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(sidebar(page)).toBeHidden();
  await page.getByRole('button', { name: 'Show navigation' }).click();
  await expect(sidebar(page)).toBeVisible();
});

test('on a narrow screen the sidebar starts as a drawer and the page does not overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await signIn(page);
  await expect(sidebar(page)).toBeHidden();
  await page.getByRole('button', { name: 'Show navigation' }).click();
  await expect(sidebar(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the dark theme is a flat charcoal surface, neither black nor light', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sensibilia.researcher.theme', 'dark'));
  await signIn(page);
  const channels = await page.evaluate(() => {
    const bg = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!)
        .backgroundColor.match(/\d+/g)!
        .slice(0, 3)
        .map(Number);
    return [bg('.ui-nav'), bg('.ui-main'), bg('.ui-topbar')];
  });
  for (const [r, g, b] of channels) {
    expect(Math.max(r, g, b)).toBeGreaterThan(16);
    expect(Math.max(r, g, b)).toBeLessThan(64);
  }
});
