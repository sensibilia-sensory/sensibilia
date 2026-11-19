import { test, expect } from '@playwright/test';

test('SPA deep links, root redirect, History API and unknown routes', async ({ page, request }) => {
  const deepLink = await request.get('/dev/ui');
  expect(deepLink.status()).toBe(200);
  expect(await deepLink.text()).toContain('/src/main.tsx');
  await page.goto('/');
  await expect(page).toHaveURL(/\/dev\/ui$/);
  await page.getByRole('link', { name: 'Development', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'UI gallery', exact: true })).toBeVisible();
  await page.goto('/unknown-gallery-route');
  await expect(page.getByText('Not found.', { exact: true })).toBeVisible();
});

test('table filtering, sorting, selection, truncation and keyboard activation', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  const table = page.getByTestId('test-types-table');
  await expect(table.locator('tbody tr')).toHaveCount(30);
  await expect(table.locator('tr[data-row-id="cata"]')).toHaveAttribute('data-selected', 'true');
  await table.getByRole('button', { name: 'Key', exact: true }).click();
  await expect(table.getByRole('columnheader', { name: 'Key', exact: true })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(table.locator('tbody tr').first()).toHaveAttribute('data-row-id', 'a_not_a');
  await table.getByRole('checkbox', { name: 'Select all Test types', exact: true }).check();
  await expect(table.locator('tbody tr[data-selected]')).toHaveCount(30);
  await table.getByRole('searchbox').fill('hedonic_acceptance_9');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await table.getByRole('searchbox').fill('not-a-method');
  await expect(table.getByText('No records.', { exact: true })).toBeVisible();
  await table.getByRole('searchbox').fill('');
  const scrollArea = table.getByRole('region', { name: 'Test types scroll area', exact: true });
  await scrollArea.evaluate((element) => {
    element.scrollTop = 200;
  });
  expect(
    await table
      .locator('th')
      .first()
      .evaluate((header) => {
        const scroller = header.closest('.ui-table-scroll')!;
        return (
          Math.abs(header.getBoundingClientRect().top - scroller.getBoundingClientRect().top) <= 1
        );
      }),
  ).toBe(true);
  await scrollArea.evaluate((element) => {
    element.scrollTop = 0;
  });
  await table.locator('tbody tr').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(table.locator('tbody tr').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Properties', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Properties', exact: true }).click();
  const longCell = table
    .locator('td.ui-col-name .ui-cell')
    .filter({ hasText: 'Polarized sensory positioning' });
  expect(
    await longCell.evaluate(
      (cell) => cell.scrollWidth > cell.clientWidth && Boolean(cell.getAttribute('title')),
    ),
  ).toBe(true);
});

test('property sections, zero values, errors, tabs and docked panel', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Fields & property grid', exact: true }).click();
  const properties = page.locator('#properties');
  await expect(properties.getByLabel('Left value', { exact: true })).toHaveValue('0');
  await properties.getByLabel('Default', { exact: true }).fill('0');
  await expect(properties.getByLabel('Default', { exact: true })).toHaveValue('0');
  await properties.getByRole('switch', { name: 'Mandatory', exact: true }).uncheck();
  await properties.getByText('Advanced settings', { exact: true }).click();
  await expect(properties.getByLabel('Error example', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(properties.getByLabel('Published key', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Status text & tabs', exact: true }).click();
  await page.getByRole('tab', { name: 'Configuration', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Preview', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Show properties', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Properties', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('native dialogs trap focus, dismiss with Escape and return focus', async ({ page }) => {
  await page.goto('/dev/ui');
  const trigger = page.getByRole('button', { name: 'Generate codes…', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Generate fixture codes', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Generate', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Close Generate fixture codes', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Delete fixture…', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete fixture', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Demonstration fixture deleted');
});

test('design sets retain all 180 records and virtual rows remain keyboard reachable', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Design sets', exact: true }).click();
  const design = page.getByTestId('design-sets-table');
  await expect(design.locator('tbody tr')).toHaveCount(180);
  await page.getByRole('button', { name: 'Empty & virtual tables', exact: true }).click();
  const virtual = page.getByTestId('virtual-table');
  await expect(virtual.locator('tbody tr[data-row-id]').first()).toBeVisible();
  expect(await virtual.locator('tbody tr[data-row-id]').count()).toBeLessThan(50);
  await virtual.locator('tbody tr[data-row-id]').first().focus();
  await page.keyboard.press('End');
  await expect(virtual.locator('tr[data-row-id="virtual-600"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('virtual-600');
  await page.keyboard.press('Home');
  await expect(virtual.locator('tr[data-row-id="virtual-1"]')).toBeFocused();
  await virtual.getByRole('searchbox').fill('SET-200');
  await expect(virtual.locator('tbody tr[data-row-id]')).toHaveCount(3);
});
