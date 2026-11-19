import { configurationErrors, methodValuesValid } from '../../src/shared/methods/registry';
import { defaultConfiguration } from '../../src/methods';
import { test, expect } from '@playwright/test';
import { capture } from './capture';
import { timeoutScale } from '../timeouts';
test('SampleMap primitive retains precise keyboard boundaries and read-only state', async ({
  page,
}) => {
  await page.goto('/dev/ui#v2-methods');
  const section = page.getByRole('region', { name: 'Registered methods gallery' });
  await section.scrollIntoViewIfNeeded();
  const map = section.locator('.ui-preview');
  await map.getByRole('button', { name: '317', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(map.getByRole('button', { name: 'Move sample 317' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(map.getByRole('button', { name: 'Move sample 317' })).toHaveAttribute(
    'style',
    /50.833/,
  );
  await expect(section.getByRole('button', { name: 'Move sample 582' })).toBeDisabled();
  await capture(page, 'slice-15-map-gallery', 'desktop', '#v2-methods');
});

test(
  'registered method editors expose conventions, sample table and lifecycle states',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(120000 * timeoutScale);
    await page.goto('/dev/ui#v2-methods');
    const section = page.getByRole('region', {
      name: 'Registered method editor fixtures',
      exact: true,
    });
    await section.scrollIntoViewIfNeeded();
    const ready = section.getByRole('tabpanel', { name: 'ready', exact: true });
    for (const id of [
      'cata-v1',
      'rata-v1',
      'jar-v1',
      'triangle-v1',
      'duo-trio-v1',
      'flash-profile-v1',
      'napping-v1',
    ]) {
      await section.getByLabel('Gallery method', { exact: true }).selectOption(id);
      await expect(
        section.getByTestId('gallery-method-ready-samples').locator('tbody tr[data-row-id]'),
      ).toHaveCount(2);
      await expect(section.getByText(/Unsupported schema/)).toHaveCount(0);
      await expect(ready.getByRole('checkbox', { name: /Select all Configured/ })).toHaveCount(0);
      if (id === 'rata-v1') {
        await ready.getByLabel('First scale value', { exact: true }).fill('0');
        await ready.getByLabel('Require ratings', { exact: true }).uncheck();
      }
      if (id === 'duo-trio-v1') {
        await ready.getByLabel('Reference technique', { exact: true }).selectOption('constant');
        await expect(ready.getByLabel('Reference product', { exact: true })).toBeVisible();
      }
      await capture(page, 'slice-15-gallery-editor-' + id, 'desktop', '#v2-methods');
    }
    await section.getByRole('tab', { name: 'readonly', exact: true }).click();
    await expect(
      section
        .getByRole('tabpanel', { name: 'readonly', exact: true })
        .getByLabel('Instructions', { exact: true }),
    ).toBeDisabled();
    await section.getByRole('tab', { name: 'empty', exact: true }).click();
    await expect(section.getByTestId('gallery-method-empty-samples')).toContainText('No records');
    await section.getByRole('tab', { name: 'loading', exact: true }).click();
    await expect(section.getByRole('status')).toContainText('Loading');
    await section.getByRole('tab', { name: 'error', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('Cannot load');
  },
);

test('shared method validity preserves tagged states and rejects invalid set answers', () => {
  const samples = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      study_version_id: '20000000-0000-4000-8000-000000000001',
      code: '317',
      label: 'A',
      ingredient_tags: [],
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      study_version_id: '20000000-0000-4000-8000-000000000001',
      code: '582',
      label: 'B',
      ingredient_tags: [],
    },
  ];
  const rata = defaultConfiguration('rata-v1', samples);
  if (rata.kind !== 'rata') throw new Error('RATA configuration missing');
  rata.rating_min = 0;
  rata.require_ratings = false;
  for (const rating of [null, 0])
    expect(
      methodValuesValid(rata, { attribute_1: { kind: 'rata', state: 'selected', rating } }),
    ).toBe(true);
  expect(
    methodValuesValid(
      { ...rata, require_ratings: true },
      { attribute_1: { kind: 'rata', state: 'selected', rating: null } },
    ),
  ).toBe(false);
  expect(
    methodValuesValid(rata, { attribute_1: { kind: 'rata', state: 'selected', rating: 4 } }),
  ).toBe(false);
  const cata = defaultConfiguration('cata-v1', samples);
  expect(methodValuesValid(cata, { attribute_1: { kind: 'cata', state: 'unselected' } })).toBe(
    true,
  );
  expect(methodValuesValid(cata, {})).toBe(false);
  expect(
    methodValuesValid(defaultConfiguration('duo-trio-v1', samples), {
      choice: { kind: 'duo_trio', state: 'chosen', selected_slot_id: 's3' },
    }),
  ).toBe(false);
  const afc = defaultConfiguration('two-afc-v1', samples);
  if (afc.kind !== 'two_afc') throw new Error('2-AFC configuration missing');
  const choice = (slot: 's1' | 's2' | 's3') => ({
    choice: { kind: 'two_afc' as const, state: 'chosen' as const, selected_slot_id: slot },
  });
  expect(methodValuesValid(afc, choice('s2'))).toBe(true);
  expect(methodValuesValid(afc, choice('s3'))).toBe(false);
  expect(configurationErrors(afc).question).toBeTruthy();
  expect(configurationErrors({ ...afc, question: 'Which is sweeter?' })).toEqual({});
  expect(
    configurationErrors({ ...afc, question: 'Q', expected_sample_id: null }).expected_sample_id,
  ).toBeTruthy();
  expect(
    configurationErrors({ ...afc, question: 'Q', task: 'preference' }).expected_sample_id,
  ).toBeTruthy();
  expect(
    configurationErrors({ ...afc, question: 'Q', task: 'preference', expected_sample_id: null }),
  ).toEqual({});
  const flash = defaultConfiguration('flash-profile-v1', samples);
  expect(
    methodValuesValid(flash, {
      profile: {
        kind: 'flash_profile',
        state: 'profile',
        attributes: [{ id: 'a', term: 'Aroma', ranks: { [samples[0].id]: 1, [samples[1].id]: 3 } }],
      },
    }),
  ).toBe(false);
  const map = defaultConfiguration('napping-v1', samples);
  expect(
    methodValuesValid(map, {
      map: {
        kind: 'napping',
        state: 'mapped',
        points: {
          [samples[0].id]: { x: 0, y: 0, description: '' },
          [samples[1].id]: { x: 60, y: 40, description: '' },
        },
      },
    }),
  ).toBe(true);
  expect(
    methodValuesValid(map, {
      map: {
        kind: 'napping',
        state: 'mapped',
        points: {
          [samples[0].id]: { x: 61, y: 0, description: '' },
          [samples[1].id]: { x: 60, y: 40, description: '' },
        },
      },
    }),
  ).toBe(false);
});
