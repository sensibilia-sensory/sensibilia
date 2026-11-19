import { test, expect, type Page } from '@playwright/test';
import { axeScan } from './audit';
import { expectFlowSaved } from './save';
import { addStep, startStudy } from './steps';
import { timeoutScale } from '../timeouts';
import { configurationErrors } from '../../src/shared/methods/registry';
import type { Configuration } from '../../src/shared/methods/registry';

const token = 'e2e-researcher-' + 'x'.repeat(32);
const headers = { Authorization: 'Bearer ' + token };

async function signIn(page: Page) {
  await page.getByLabel('Access key', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('scales show as a list, a labelled row or a row naming only its ends, and as a real grid', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Questionnaire blocks', exact: true }).click();
  await page.getByRole('tab', { name: 'layouts', exact: true }).click();
  const shown = page.getByTestId('scale-layouts');
  const scale = (name: string) => shown.getByRole('group', { name, exact: true });
  // Vertical list: one option per line, all labels visible.
  const vertical = scale('Single question, vertical');
  await expect(vertical.getByText('Strongly agree')).toBeVisible();
  const first = await vertical.getByRole('radio').first().boundingBox();
  const last = await vertical.getByRole('radio').last().boundingBox();
  expect(last!.y).toBeGreaterThan(first!.y + 100);
  // Horizontal row: same line, every label visible.
  const row = scale('Single question, horizontal');
  const a = await row.getByRole('radio').first().boundingBox();
  const b = await row.getByRole('radio').last().boundingBox();
  expect(Math.abs(b!.y - a!.y)).toBeLessThan(2);
  await expect(row.getByText('4', { exact: true })).toBeVisible();
  // Ends only: the two end labels above one row of radio buttons numbered 1 to 7. The full
  // option text stays the accessible name.
  const ends = scale('Single question, horizontal_ends');
  await expect(ends.locator('.ui-choice-ends span')).toHaveText([
    'Strongly disagree',
    'Strongly agree',
  ]);
  await expect(ends.locator('label [aria-hidden="true"]')).toHaveText([
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
  ]);
  const endsBox = await ends.locator('.ui-choice-ends').boundingBox();
  const radios = await ends.getByRole('radio').all();
  const rowTop = (await radios[0].boundingBox())!;
  expect(rowTop.y).toBeGreaterThan(endsBox!.y);
  expect(Math.abs((await radios[6].boundingBox())!.y - rowTop.y)).toBeLessThan(2);
  await ends.getByRole('radio', { name: '4', exact: true }).check();
  await expect(ends.getByRole('radio', { name: '4', exact: true })).toBeChecked();
  await ends.getByRole('radio', { name: 'Strongly agree', exact: true }).check();
  await expect(ends.getByRole('radio', { name: '4', exact: true })).not.toBeChecked();
  // Grid with every option named: one table, a row per statement, a column per point.
  const table = shown.getByRole('table', { name: 'Question grid, horizontal' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByRole('columnheader', { name: 'Strongly disagree' })).toBeVisible();
  await table.getByRole('radio', { name: '1. Aroma, 3', exact: true }).check();
  await table.getByRole('radio', { name: '1. Aroma, 6', exact: true }).check();
  await expect(table.getByRole('radio', { name: '1. Aroma, 3', exact: true })).not.toBeChecked();
  await expect(table.getByRole('radio', { name: '2. Texture, 6', exact: true })).not.toBeChecked();
  await table.getByRole('button', { name: 'Skip 2. Texture', exact: true }).click();
  await expect(table.getByText('Explicitly skipped')).toBeVisible();
  // Grid naming only its ends: a block per statement, each like the single question above.
  const aroma = scale('1. Aroma');
  await expect(aroma).toHaveCount(1);
  await expect(aroma.locator('.ui-choice-ends span')).toHaveText([
    'Strongly disagree',
    'Strongly agree',
  ]);
  await aroma.getByRole('radio', { name: '5', exact: true }).check();
  await scale('2. Texture').getByRole('radio', { name: '2', exact: true }).check();
  await expect(aroma.getByRole('radio', { name: '5', exact: true })).toBeChecked();
  await shown.getByRole('button', { name: 'Skip 3. Aftertaste', exact: true }).last().click();
  await expect(shown.getByText('Explicitly skipped')).toHaveCount(2);
});

test('a scale may leave steps unnamed: they show only their number, the ends stay named', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
  await page.getByRole('tab', { name: 'Scale with unnamed steps', exact: true }).click();
  const scale = page.getByTestId('unnamed-steps-fixture').getByRole('group');
  // Named steps show number and name; unnamed steps show the number alone, no dangling dot.
  await expect(scale.getByRole('radio', { name: '1 · Dislike', exact: true })).toBeVisible();
  await expect(scale.getByRole('radio', { name: '5 · Neither', exact: true })).toBeVisible();
  await expect(scale.getByRole('radio', { name: '9 · Like', exact: true })).toBeVisible();
  for (const step of ['2', '3', '4', '6', '7', '8'])
    await expect(scale.getByRole('radio', { name: step, exact: true })).toBeVisible();
  await expect(scale.locator('label', { hasText: '·' })).toHaveCount(3);
  // An unnamed step is an ordinary answer: its number is the value.
  await scale.getByRole('radio', { name: '3', exact: true }).check();
  await expect(scale.getByRole('radio', { name: '3', exact: true })).toBeChecked();
});

test('scale names: only the ends (and a JAR centre) must be named; length is still limited', () => {
  const hedonic = (labels: string[]) =>
    configurationErrors({
      instructions: 'Rate.',
      questions: [{ id: 'q', prompt: 'Liking?', required: true }],
      scale_labels: labels,
      allow_skips: false,
    } as Configuration);
  const nine = (named: number[]) =>
    Array.from({ length: 9 }, (_, i) => (named.includes(i) ? 'Step ' + (i + 1) : ''));
  expect(hedonic(nine([0, 8]))).toEqual({});
  expect(hedonic(nine([0, 4, 8]))).toEqual({});
  expect(hedonic(nine([0, 4]))['scale_labels.8']).toMatch(/first and last/);
  expect(hedonic(nine([4]))['scale_labels.0']).toMatch(/first and last/);
  expect(hedonic([...nine([0, 8]).slice(0, 8), 'x'.repeat(201)])['scale_labels.8']).toBeTruthy();
});

test('a numbered scale with named ends fills a grid scale and sets the row layout', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Questionnaire blocks', exact: true }).click();
  const editor = page
    .getByRole('region', { name: 'Questionnaire block fixtures', exact: true })
    .getByRole('tabpanel', { name: 'ready', exact: true });
  await editor.getByRole('tab', { name: 'Scale options', exact: true }).click();
  await expect(editor.getByLabel('Scale display', { exact: true })).toHaveValue('vertical');
  await editor.getByLabel('Points', { exact: true }).selectOption('7');
  await editor.getByLabel('Low end', { exact: true }).fill('Not at all');
  await editor.getByLabel('High end', { exact: true }).fill('Extremely');
  await editor.getByRole('button', { name: 'Create numbered scale', exact: true }).click();
  const scale = editor.getByRole('table', { name: 'Questionnaire scale', exact: true });
  await expect(scale.locator('tbody tr[data-row-id]')).toHaveCount(7);
  const values = (prefix: string) =>
    scale
      .locator('input[aria-label^="' + prefix + '"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(await values('Scale label')).toEqual(['Not at all', '2', '3', '4', '5', '6', 'Extremely']);
  expect(await values('Scale score')).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  await expect(editor.getByLabel('Scale display', { exact: true })).toHaveValue('horizontal_ends');
  // A standard scale replaces the options without touching the display.
  await editor.getByLabel('Standard scale', { exact: true }).selectOption('agree5');
  await editor.getByRole('button', { name: 'Replace scale', exact: true }).click();
  await expect(scale.locator('tbody tr[data-row-id]')).toHaveCount(5);
  await expect(editor.getByLabel('Scale display', { exact: true })).toHaveValue('horizontal_ends');
});

test('a single question can use standard and numbered scales and keeps its layout', async ({
  page,
  request,
}) => {
  test.setTimeout(120000 * timeoutScale);
  await page.goto('/researcher/studies');
  await signIn(page);
  await startStudy(page);
  await page.getByLabel('Title', { exact: true }).fill('Scale layouts');
  await page.getByLabel('Description', { exact: true }).fill('Single question scales');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/[^/]+\/flow$/);
  const [, , , studyId, , versionId] = new URL(page.url()).pathname.split('/');
  await addStep(page, 'question');
  await page.getByLabel('Step title', { exact: true }).fill('Aroma');
  // Standard scale: seven agreement options, display unchanged.
  await expect(page.getByLabel('Scale display', { exact: true })).toHaveValue('vertical');
  await page.getByLabel('Standard scale', { exact: true }).selectOption('agree7');
  await page.getByRole('button', { name: 'Replace scale', exact: true }).click();
  await expect(page.locator('input[aria-label="Option text"]')).toHaveCount(7);
  await expect(page.getByLabel('Scale display', { exact: true })).toHaveValue('vertical');
  // Numbered scale with named ends: a row naming only its ends.
  await page.getByLabel('Points', { exact: true }).selectOption('7');
  await page.getByLabel('Low end', { exact: true }).fill('Not pleasant');
  await page.getByLabel('High end', { exact: true }).fill('Very pleasant');
  await page.getByRole('button', { name: 'Create numbered scale', exact: true }).click();
  await expect(page.getByLabel('Scale display', { exact: true })).toHaveValue('horizontal_ends');
  await expectFlowSaved(page);
  const saved = async () => {
    const version = await (
      await request.get('/studies/' + studyId + '/versions/' + versionId, { headers })
    ).json();
    return version.form.nodes.find((n: { kind: string }) => n.kind === 'question').data;
  };
  const data = await saved();
  expect(data.layout).toBe('horizontal_ends');
  expect(data.options.map((o: { label: { en: string } }) => o.label.en)).toEqual([
    'Not pleasant',
    '2',
    '3',
    '4',
    '5',
    '6',
    'Very pleasant',
  ]);
  expect(data.options.every((o: { score?: number }) => o.score == null)).toBe(true);
  // The researcher can change the display and it survives a reload.
  await page.getByLabel('Scale display', { exact: true }).selectOption('horizontal');
  await expectFlowSaved(page);
  await page.reload();
  await signIn(page);
  await page
    .getByTestId('flow-outline')
    .locator('tbody tr[data-row-id]')
    .first()
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(page.getByLabel('Scale display', { exact: true })).toHaveValue('horizontal');
  expect((await saved()).layout).toBe('horizontal');
  // Other answer types offer no row layout.
  await page.getByLabel('Answer type', { exact: true }).selectOption('multiple');
  await expect(page.getByLabel('Scale display', { exact: true })).toHaveCount(0);
  await expectFlowSaved(page);
  expect((await saved()).layout).toBe('vertical');
});

test(
  'scale layouts and the scale builder pass the accessibility scan',
  { tag: '@audit' },
  async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Questionnaire blocks', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Questionnaire block fixtures', exact: true });
    await gallery.getByRole('tab', { name: 'Scale options', exact: true }).click();
    await axeScan(page, '[aria-label="Standard scales"]');
    await axeScan(page, '[aria-label="Numbered scale"]');
    await gallery.getByRole('tab', { name: 'layouts', exact: true }).click();
    await axeScan(page, '[data-testid="scale-layouts"]');
  },
);

test('a method rating scale follows the layout set on its step', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Foundation fixture states' });
  await tabs.getByRole('tab', { name: 'Method scale layouts', exact: true }).click();
  const shown = page.getByTestId('method-scale-layouts');
  const radios = (layout: string) =>
    shown.getByRole('region', { name: 'Layout ' + layout, exact: true }).getByRole('radio');
  const vertical = radios('vertical');
  expect((await vertical.last().boundingBox())!.y).toBeGreaterThan(
    (await vertical.first().boundingBox())!.y + 150,
  );
  for (const layout of ['horizontal', 'horizontal_ends']) {
    const row = radios(layout);
    expect(await row.count()).toBe(9);
    expect(
      Math.abs((await row.last().boundingBox())!.y - (await row.first().boundingBox())!.y),
    ).toBeLessThan(2);
  }
  // Only the ends are named when asked; the midpoint keeps its name in the data, not on screen.
  const ends = shown.getByRole('region', { name: 'Layout horizontal_ends' });
  await expect(ends.locator('.ui-choice-ends span')).toHaveText(['Dislike', 'Like']);
  await ends.getByRole('radio').nth(4).check();
  await expect(ends.getByRole('radio').nth(4)).toBeChecked();
});

test('a numbered scale can name its middle step too, and then shows every option', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Questionnaire blocks', exact: true }).click();
  const editor = page
    .getByRole('region', { name: 'Questionnaire block fixtures', exact: true })
    .getByRole('tabpanel', { name: 'ready', exact: true });
  await editor.getByRole('tab', { name: 'Scale options', exact: true }).click();
  // An even number of points has no middle step to name.
  await editor.getByLabel('Points', { exact: true }).selectOption('6');
  await expect(editor.getByLabel('Middle', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Points', { exact: true }).selectOption('5');
  await editor.getByLabel('Low end', { exact: true }).fill('Dislike');
  await editor.getByLabel('High end', { exact: true }).fill('Like');
  await editor.getByLabel('Middle', { exact: true }).fill('Neither');
  await editor.getByRole('button', { name: 'Create numbered scale', exact: true }).click();
  const scale = editor.getByRole('table', { name: 'Questionnaire scale', exact: true });
  const labels = await scale
    .locator('input[aria-label^="Scale label"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(labels).toEqual(['Dislike', '2', 'Neither', '4', 'Like']);
  await expect(editor.getByLabel('Scale display', { exact: true })).toHaveValue('horizontal');
});
