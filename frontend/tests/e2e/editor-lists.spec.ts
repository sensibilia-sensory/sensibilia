import { test, expect } from '@playwright/test';

async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
  await page.getByRole('tab', { name: 'Editor', exact: true }).click();
  const region = page.getByRole('region', { name: 'Questions editor' });
  return { region, rows: region.locator('tbody tr[data-row-id]') };
}

test('several rows can be added at once, one per line, and are saved in order', async ({
  page,
}) => {
  const { rows } = await openEditor(page);
  const before = await rows.count();
  const form = page.getByRole('tabpanel', { name: 'Editor', exact: true });
  const box = form.getByLabel('Add several questions at once', { exact: true });
  const add = form.getByRole('button', { name: /^Add \d* ?questions?$/ });
  // Nothing typed: nothing to add.
  await expect(add).toBeDisabled();
  await box.fill('Sweetness\n\n  Bitterness  \nSourness\n');
  await expect(form.getByRole('button', { name: 'Add 3 questions', exact: true })).toBeEnabled();
  await form.getByRole('button', { name: 'Add 3 questions', exact: true }).click();
  await expect(rows).toHaveCount(before + 3);
  // Blank lines are skipped, spaces trimmed, order kept; the box is emptied.
  const prompts = rows.getByRole('textbox', { name: 'Question text' });
  const values = await prompts.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(values.slice(-3)).toEqual(['Sweetness', 'Bitterness', 'Sourness']);
  await expect(box).toHaveValue('');
  // A single line reads in the singular.
  await box.fill('Aroma');
  await expect(form.getByRole('button', { name: 'Add 1 question', exact: true })).toBeVisible();
});

test('bulk add refuses more lines than the list can hold', async ({ page }) => {
  const { rows } = await openEditor(page);
  const form = page.getByRole('tabpanel', { name: 'Editor', exact: true });
  const room = 100 - (await rows.count());
  const box = form.getByLabel('Add several questions at once', { exact: true });
  await box.fill(Array.from({ length: room + 1 }, (_, i) => 'Line ' + i).join('\n'));
  await expect(form.getByText('Too many lines.')).toBeVisible();
  await expect(form.getByRole('button', { name: /^Add \d+ questions$/ })).toBeDisabled();
});

import { dropIndex, moveItem } from '../../src/ui/reorder';

test('moving a row: the final index is the same whichever way it is dragged', () => {
  expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  // Out-of-range moves change nothing and never throw.
  expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  // Released after row 2 / before row 1, from above or from below.
  expect(dropIndex(0, 2, 'after')).toBe(2);
  expect(dropIndex(0, 2, 'before')).toBe(1);
  expect(dropIndex(3, 1, 'before')).toBe(1);
  expect(dropIndex(3, 1, 'after')).toBe(2);
  // Released where it already is: no move.
  expect(dropIndex(2, 2, 'before')).toBe(2);
  expect(dropIndex(2, 2, 'after')).toBe(2);
  expect(dropIndex(2, 1, 'after')).toBe(2);
  expect(dropIndex(2, 3, 'before')).toBe(2);
});

test('rows are reordered by dragging the grip, with the buttons still working', async ({
  page,
}) => {
  const { rows } = await openEditor(page);
  const form = page.getByRole('tabpanel', { name: 'Editor', exact: true });
  await form
    .getByLabel('Add several questions at once', { exact: true })
    .fill('Alpha\nBeta\nGamma');
  await form.getByRole('button', { name: 'Add 3 questions', exact: true }).click();
  const order = async () =>
    (
      await rows
        .getByRole('textbox', { name: 'Question text' })
        .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
    ).slice(-3);
  expect(await order()).toEqual(['Alpha', 'Beta', 'Gamma']);
  const count = await rows.count();
  const grip = (n: number) => rows.nth(count - 3 + n).locator('.ui-row-grip');
  const last = rows.nth(count - 1);
  const box = (await last.boundingBox())!;
  // Drag the first of the three below the last one.
  await grip(0).dragTo(last, { targetPosition: { x: 40, y: box.height - 3 } });
  expect(await order()).toEqual(['Beta', 'Gamma', 'Alpha']);
  // Drag it back above the first of the three.
  const first = rows.nth(count - 3);
  await grip(2).dragTo(first, { targetPosition: { x: 40, y: 3 } });
  expect(await order()).toEqual(['Alpha', 'Beta', 'Gamma']);
  // Dropping a row onto itself changes nothing.
  await grip(1).dragTo(rows.nth(count - 2), { targetPosition: { x: 40, y: 3 } });
  expect(await order()).toEqual(['Alpha', 'Beta', 'Gamma']);
  // The arrow buttons are still the keyboard route.
  await form
    .getByRole('button', { name: /^Move .* up$/ })
    .nth(count - 1)
    .click();
  expect(await order()).toEqual(['Alpha', 'Gamma', 'Beta']);
});

test('a read-only list shows no draggable grips', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Foundation fixture states' });
  await tabs.getByRole('tab', { name: 'Read-only', exact: true }).click();
  const panel = page
    .getByRole('region', { name: 'Flow foundation fixtures' })
    .getByRole('tabpanel', {
      name: 'Read-only',
      exact: true,
    });
  const grips = panel.locator('.ui-row-grip');
  expect(await grips.count()).toBeGreaterThan(0);
  await expect(panel.locator('.ui-row-grip[draggable="true"]')).toHaveCount(0);
});
