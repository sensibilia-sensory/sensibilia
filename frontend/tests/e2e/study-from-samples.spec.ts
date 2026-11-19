import { test, expect } from '@playwright/test';

test('a sample battery becomes a draft that repeats its methods for every sample', async ({
  page,
}) => {
  await page.goto('/researcher/studies/new');
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Four cheeses');

  await page
    .getByLabel('Samples', { exact: true })
    .fill(['C1, Cheddar', 'C2, Gouda', 'C3, Brie', 'C4, Edam'].join('\n'));
  await expect(page.getByTestId('battery-samples').locator('tbody tr')).toHaveCount(4);

  // An empty method text is refused before anything is created.
  await page.getByLabel('Method for each sample', { exact: true }).selectOption('hedonic-9-v1');
  await page.getByRole('button', { name: 'Add method', exact: true }).click();
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('enter the question');

  await page.getByLabel(/hedonic acceptance 1 text/i).fill('Overall liking');
  await page.getByLabel('Method for each sample', { exact: true }).selectOption('cata-v1');
  await page.getByRole('button', { name: 'Add method', exact: true }).click();
  // Typed key by key: the box must keep focus between keystrokes.
  const attributes = page.getByLabel(/CATA.* 2 text/);
  await attributes.click();
  await page.keyboard.type('Salty');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Creamy');
  await expect(attributes).toBeFocused();
  await expect(attributes).toHaveValue('Salty\nCreamy');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();

  await expect(page).toHaveURL(/\/versions\/.+\/flow/);
  const rows = page.getByTestId('flow-outline').locator('tbody tr[data-row-id]');
  // Loop, its two methods, and the closing step.
  await expect(rows).toHaveCount(4);
});
