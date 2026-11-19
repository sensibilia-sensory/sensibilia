import { test, expect } from '@playwright/test';
import { addMethodStep, addStep } from './steps';
import { researcherHeaders } from './seed';

test('a study can be built before its samples exist, and products can be created in place', async ({
  page,
  request,
}) => {
  const study = await (
    await request.post('/studies', {
      headers: researcherHeaders,
      data: { title: 'Build before samples' },
    })
  ).json();
  const flow = '/researcher/studies/' + study.id + '/versions/' + study.versions[0].id + '/flow';
  await page.goto(flow);
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const rows = page.getByTestId('flow-outline').locator('tbody tr[data-row-id]');

  // An attribute test needs no samples: it uses those of its loop, added later.
  await addMethodStep(page, 'rata-v1');
  await expect(page.getByText(/No samples are fixed here/)).toBeVisible();
  await page.getByLabel('Question text 1', { exact: true }).fill('Sweet');
  await page.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await expect(rows).toHaveCount(2);

  // A test that compares chosen products can create them without leaving the panel.
  await page.getByRole('button', { name: 'Save flow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save flow', exact: true })).toBeDisabled();
  await addMethodStep(page, 'triangle-v1');
  await expect(page.getByText('This test compares specific products.')).toBeVisible();
  for (const code of ['311', '312']) {
    await page.getByLabel('Sample code', { exact: true }).fill(code);
    await page.getByLabel('Private label', { exact: true }).fill('Product ' + code);
    await page.getByLabel('Tags reviewed', { exact: true }).check();
    await page.getByRole('button', { name: 'Create and include sample', exact: true }).click();
    await expect(page.getByLabel('Sample code', { exact: true })).toHaveValue('');
  }
  await expect(page.getByText('2 products chosen.')).toBeVisible();
  await page.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await expect(rows).toHaveCount(3);
});

test('a method added while a step in a loop is selected stays in the loop and previews', async ({
  page,
  request,
}) => {
  const study = await (
    await request.post('/studies', {
      headers: researcherHeaders,
      data: { title: 'Methods in a loop' },
    })
  ).json();
  await request.post('/studies/' + study.id + '/samples', {
    headers: researcherHeaders,
    data: { code: '311', label: 'Product 311', ingredient_tags: [] },
  });
  await page.goto(
    '/researcher/studies/' + study.id + '/versions/' + study.versions[0].id + '/flow',
  );
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const outline = page.getByTestId('flow-outline');
  const rows = outline.locator('tbody tr[data-row-id]');
  const numbers = () => rows.locator('td:first-child').allTextContents();
  const save = async () => {
    await page.getByRole('button', { name: 'Save flow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save flow', exact: true })).toBeDisabled();
  };

  // A RATA that keeps its own sample, outside any loop.
  await addMethodStep(page, 'rata-v1');
  await page.getByLabel('Question text 1', { exact: true }).fill('Sweet');
  await page.getByRole('button', { name: 'Include', exact: true }).click();
  await expect(page.getByText('1 samples fixed for this test.')).toBeVisible();
  await page.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await addStep(page, 'sample loop');
  await expect(rows).toHaveCount(3);
  await save();

  // With the loop selected, a hedonic test goes inside it.
  await addMethodStep(page, 'hedonic-9-v1');
  await page.getByLabel('Instructions', { exact: true }).fill('Taste and rate.');
  await page.getByLabel('Question text 1', { exact: true }).fill('Overall liking');
  await page.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await expect(rows).toHaveCount(4);
  expect((await numbers()).map((n) => n.trim())).toContain('2.1');
  await save();

  // With that hedonic test selected, a CATA also goes inside the loop, after it, and previews.
  await addMethodStep(page, 'cata-v1');
  await page.getByLabel('Question text 1', { exact: true }).fill('Fruity');
  await page.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await expect(rows).toHaveCount(5);
  expect((await numbers()).map((n) => n.trim())).toEqual(['1', '2', '2.1', '2.2', '3']);
  await expect(page.getByText('Preview unavailable')).toHaveCount(0);
  await expect(page.getByText('Open the Preview tab to see this kind of step')).toHaveCount(0);
  await expect(page.getByText('Fruity').first()).toBeVisible();
  await save();

  // Dragging the RATA into the loop releases its own sample: the loop supplies them.
  await rows.nth(0).dragTo(rows.nth(1));
  await expect(
    page.getByText('This test now uses the samples of the loop it is in.'),
  ).toBeVisible();
  await expect(rows.locator('td:first-child').nth(3)).toHaveText(/1\.3/);
  await rows.nth(3).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByText('No samples are fixed here.')).toBeVisible();
});

test('the study list is the landing page and the method list is reference only', async ({
  page,
}) => {
  await page.goto('/researcher/');
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/researcher\/studies$/);
  await expect(page.getByRole('heading', { name: 'Studies' })).toBeVisible();
  await page.getByRole('button', { name: 'Method reference', exact: true }).click();
  const methods = page.getByTestId('methods-table');
  await expect(methods.locator('tbody tr[data-row-id]')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Create study' })).toHaveCount(0);
  await expect(methods.getByRole('checkbox')).toHaveCount(0);
});
