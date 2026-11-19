import { nodeFields } from '../../src/shared/nodes/authoring';
import type { Node } from '../../src/shared/flow';
import { test, expect } from '@playwright/test';
import { capture } from './capture';
import {
  localizedConfiguration,
  methodTextFields,
  textIssues,
  displayText,
  reconcileMethodText,
  removeLanguage,
} from '../../src/shared/flow/text';
import { runFlow, runTests, runSamples } from '../../src/dev/flowFixtures';
import { initialState } from '../../src/shared/flow';
import type { Configuration } from '../../src/shared/methods/hedonic_acceptance_9/validation';
import { timeoutScale } from '../timeouts';

test('shared localized method text preserves IDs, scale values, and scoped escaped tokens', () => {
  const config = runTests[0].configuration as Configuration;
  const overlays = Object.fromEntries(
    Object.entries(methodTextFields(config)).map(([pointer, value]) => [
      pointer,
      { en: value, sv: 'Sv ' + value },
    ]),
  );
  overlays['/instructions'].sv = '<b>{{sample_code}}</b> · {{sample_position}}';
  const translated = localizedConfiguration(config, overlays, 'sv', {
    'sample.code': '<X>',
    'sample.position': 0,
  });
  expect(translated.instructions).toBe('<b><X></b> · 0');
  expect(translated.questions[0].id).toBe(config.questions[0].id);
  expect(translated.questions[0].required).toBe(config.questions[0].required);
  expect(translated.scale_labels).toHaveLength(9);
  expect(config.instructions).toBe('Researcher rating instructions');
  const oldText = {
    ...config,
    instructions: '{{sample_code}}',
    questions: [{ ...config.questions[0], prompt: '{{sample_position}}' }],
    scale_labels: config.scale_labels.map(() => '{{sample_code}}'),
  };
  expect(
    localizedConfiguration(oldText, {}, 'en', { 'sample.code': 'X', 'sample.position': 1 }, false),
  ).toEqual(oldText);
  expect(displayText('{{sample_position}}', { 'sample.position': 0 })).toBe('0');
  expect(displayText('{{sample_code}}', { 'sample.code': 'X' }, false)).toBe('{{sample_code}}');
  expect(initialState(runFlow, { 'context.language': 'sv' }).variables['context.language']).toBe(
    'sv',
  );
  const invalid = structuredClone(runFlow);
  invalid.text_version = 1;
  invalid.languages.push('sv');
  expect(textIssues(invalid, runTests).join(' ')).toContain('nonblank sv');
  invalid.nodes[0].title.en = '{{unknown}}';
  expect(textIssues(invalid, runTests).join(' ')).toContain('unknown token');
  invalid.nodes[0].title.en = '{{sample_code}}';
  expect(textIssues(invalid, runTests).join(' ')).toContain('sample scope');
  const previous = {
    ...config,
    questions: [...config.questions, { id: 'aroma', prompt: 'Aroma', required: true }],
  };
  const next = { ...previous, questions: [previous.questions[1], previous.questions[0]] };
  const promptOverlays = {
    '/questions/0/prompt': { en: 'Overall liking', sv: 'Helhet' },
    '/questions/1/prompt': { en: 'Aroma', sv: 'Arom' },
  };
  expect(reconcileMethodText(previous, next, promptOverlays, 'en')['/questions/0/prompt'].sv).toBe(
    'Arom',
  );
  expect(reconcileMethodText(previous, next, promptOverlays, 'en')['/questions/1/prompt'].sv).toBe(
    'Helhet',
  );
  const integer: Node = {
    id: 'integer',
    kind: 'question',
    title: { en: 'Integer', sv: 'Heltal' },
    data: {
      prompt: { en: 'Age', sv: 'Ålder' },
      answer_type: 'integer',
      required: true,
      allow_skip: false,
      layout: 'vertical',
      options: null,
      min: 0,
    },
  };
  const adapter = nodeFields(integer, 'sv');
  expect(
    (adapter.restore({ ...(adapter.value as object), prompt: 'Ny ålder' }) as typeof integer.data)
      .options,
  ).toBeNull();
  const choice: Node = {
    id: 'choice',
    kind: 'question',
    title: { en: 'Choice', sv: 'Val' },
    data: {
      prompt: { en: 'Choose', sv: 'Välj' },
      answer_type: 'single',
      required: true,
      allow_skip: false,
      layout: 'vertical',
      options: [
        { id: 'a', label: { en: 'A', sv: 'Ett' }, exclusive: false },
        { id: 'b', label: { en: 'B', sv: 'Två' }, exclusive: false },
      ],
    },
  };
  const editor = nodeFields(choice, 'sv');
  const value = editor.value as { options: unknown[] };
  const restored = editor.restore({
    ...value,
    options: [value.options[1], value.options[0]],
  }) as typeof choice.data;
  expect(restored.options![0].label.en).toBe('B');
  expect(restored.options![1].label.en).toBe('A');
  const removed = removeLanguage(
    { ...runFlow, languages: ['en', 'sv'], restriction_tag_map: { sv: ['nut'] } },
    'sv',
  );
  expect(removed.restriction_tag_map).toEqual({ sv: ['nut'] });
  expect(removed.languages).toEqual(['en']);
  expect(runSamples).toHaveLength(4);
});

test(
  'Check study gallery issues, field actions, loading/empty/error/published, density and axe',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(120000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Check study', exact: true }).click();
    const gallery = page.locator('#flow-check');
    await expect(
      gallery.getByTestId('flow-check-issues').locator('tbody tr[data-row-id]'),
    ).toHaveCount(2);
    await gallery.getByRole('button', { name: 'Go to problem', exact: true }).first().click();
    await expect(gallery.getByRole('status')).toContainText('sv');
    await capture(page, 'slice-5-gallery-check', 'desktop', '#flow-check');
    for (const state of ['loading', 'empty', 'error', 'published']) {
      await gallery.getByRole('button', { name: 'Check ' + state, exact: true }).click();
      if (state === 'loading')
        await expect(gallery.getByText('Checking saved snapshot…')).toBeVisible();
      if (state === 'empty')
        await expect(gallery.getByTestId('flow-check-issues')).toContainText('No issues');
      if (state === 'error') await expect(gallery.getByRole('alert')).toContainText('Read failed');
      if (state === 'published')
        await expect(gallery.getByLabel('Snapshot state', { exact: true })).toBeDisabled();
      await gallery.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await capture(page, 'slice-5-gallery-' + state, 'desktop', '#flow-check');
    }
    await gallery.getByRole('button', { name: 'Check translations', exact: true }).click();
    await gallery
      .getByRole('tabpanel', { name: 'sv', exact: true })
      .getByLabel('/instructions', { exact: true })
      .fill('Svenska instruktioner');
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'sv', exact: true })
        .getByLabel('/instructions', { exact: true }),
    ).toHaveValue('Svenska instruktioner');
    await capture(page, 'slice-5-gallery-translations', 'desktop', '#flow-check');
    await gallery.getByRole('tab', { name: 'en', exact: true }).click();
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'en', exact: true })
        .getByLabel('/instructions', { exact: true }),
    ).toBeDisabled();
    await gallery.getByRole('button', { name: 'Check tokens', exact: true }).click();
    await expect(gallery.getByText('<b><X></b> · 0', { exact: true })).toBeVisible();
    await expect(gallery.locator('b')).toHaveCount(0);
    await expect(gallery.getByRole('radio')).toHaveCount(9);
    await capture(page, 'slice-5-gallery-tokens', 'desktop', '#flow-check');
  },
);
