import { test, expect } from '@playwright/test';
import { outline, type Flow, type Node } from '../../src/shared/flow';
import { newNode } from '../../src/shared/nodes/authoring';
import {
  insertNodes,
  questionnaireFromFile,
  questionnaireToFile,
} from '../../src/shared/nodes/questionnaireFile';

const flow = (nodes: Node[], languages = ['en']): Flow => ({
  schema_version: 2,
  text_version: 1,
  languages,
  default_language: languages[0],
  nodes,
});
const titled = (node: Node, text: string, languages = ['en']): Node => ({
  ...node,
  title: Object.fromEntries(languages.map((l) => [l, text])),
});
// A question with real text, so the copy rules (every language needs wording) are satisfied.
function question(text: string, languages = ['en']): Node {
  const q = newNode('question', languages[0]);
  if (q.kind !== 'question') throw new Error('unreachable');
  const say = (v: string) => Object.fromEntries(languages.map((l) => [l, v]));
  return {
    ...q,
    title: say(text),
    data: {
      ...q.data,
      prompt: say(text),
      options: q.data.options!.map((o, i) => ({ ...o, label: say('Option ' + (i + 1)) })),
    },
  };
}
const info = (text: string): Node => {
  const n = newNode('info', 'en');
  if (n.kind !== 'info') throw new Error('unreachable');
  return { ...titled(n, text), data: { ...n.data, body: { en: text } } } as Node;
};

test('a saved questionnaire loads again with fresh ids, in order, and keeps its conditions', () => {
  const a = question('Do you eat nuts?');
  const b = info('Thank you');
  if (a.kind !== 'question') throw new Error('unreachable');
  const guarded: Node = {
    ...b,
    guard: { variable: 'answer.' + a.id, operator: 'eq', value: a.data.options![0].id },
  };
  const source = flow([a, guarded]);
  const file = questionnaireToFile(source, new Date('2026-11-18T12:00:00Z'));
  expect(file).toMatchObject({
    format: 'sensibilia-questionnaire',
    version: 1,
    saved_at: '2026-11-18T12:00:00.000Z',
    languages: ['en'],
    text_version: 1,
  });
  expect(file.nodes.map((n) => n.id)).toEqual([a.id, guarded.id]);
  const target = flow([newNode('end', 'en')]);
  const loaded = questionnaireFromFile(JSON.stringify(file), target);
  expect(loaded.map((n) => n.title.en)).toEqual(['Do you eat nuts?', 'Thank you']);
  // Fresh ids, and the condition follows the copy of the question it was about.
  expect(loaded.every((n) => ![a.id, guarded.id].includes(n.id))).toBe(true);
  expect(loaded[1].guard).toMatchObject({ variable: 'answer.' + loaded[0].id });
});

test('methods and loops stay out of the file; conditions on outside answers are refused', () => {
  const method = {
    id: crypto.randomUUID(),
    kind: 'embedded_method',
    title: { en: 'Method' },
    data: { study_test_id: crypto.randomUUID() },
  } as unknown as Node;
  const loop = newNode('loop_samples', 'en');
  const q = question('Q');
  const saved = questionnaireToFile(flow([q, method, loop]));
  expect(saved.nodes.map((n) => n.id)).toEqual([q.id]);
  const dependent: Node = {
    ...info('Follow-up'),
    guard: { variable: 'answer.' + method.id, operator: 'eq', value: 'x' },
  };
  expect(() => questionnaireToFile(flow([q, method, dependent]))).toThrow(/outside/);
  expect(() => questionnaireToFile(flow([method]))).toThrow(/no questions/);
});

test('files that are not questionnaires, or whose languages do not fit, are refused plainly', () => {
  const target = flow([newNode('end', 'en')], ['en', 'sv']);
  const file = questionnaireToFile(flow([question('Q')]));
  expect(() => questionnaireFromFile('not json', target)).toThrow(/not a Sensibilia/);
  expect(() => questionnaireFromFile('{"format":"other"}', target)).toThrow(/not a Sensibilia/);
  expect(() => questionnaireFromFile(JSON.stringify({ ...file, version: 2 }), target)).toThrow(
    /newer version/,
  );
  expect(() => questionnaireFromFile(JSON.stringify({ ...file, nodes: [] }), target)).toThrow(
    /between 1 and 100/,
  );
  // The study needs Swedish wording the file does not have.
  expect(() => questionnaireFromFile(JSON.stringify(file), target)).toThrow(/target language/);
  // A file with both languages loads into a one-language study, keeping only that language.
  const both = questionnaireToFile(flow([question('Q', ['en', 'sv'])], ['en', 'sv']));
  const loaded = questionnaireFromFile(JSON.stringify(both), flow([newNode('end', 'en')]));
  expect(Object.keys(loaded[0].title)).toEqual(['en']);
});

test('loaded steps go in order after the selected step, before End when nothing is selected', () => {
  const end = newNode('end', 'en');
  const first = question('First');
  const added = [question('A'), info('B'), question('C')];
  const titlesOf = (nodes: Node[]) => outline(nodes).map((e) => e.node.title.en);
  expect(titlesOf(insertNodes([first, end], added))).toEqual(['First', 'A', 'B', 'C', 'End']);
  expect(titlesOf(insertNodes([first, end], added, first.id))).toEqual([
    'First',
    'A',
    'B',
    'C',
    'End',
  ]);
});

test('the panel saves a file and loads one, showing what will be added', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Foundation fixture states' });
  await tabs.getByRole('tab', { name: 'Save or load questions', exact: true }).click();
  const fixture = page.getByTestId('questionnaire-file-fixture');
  const download = page.waitForEvent('download');
  await fixture.getByRole('button', { name: 'Save questions to a file' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^questionnaire-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await saved.path();
  await fixture.getByLabel('Load questions from a file').setInputFiles(path);
  await expect(fixture.getByText(/holds 1 step: Nut allergy/)).toBeVisible();
  await fixture.getByRole('button', { name: 'Add 1 step to this draft' }).click();
  await expect(fixture.getByRole('status')).toHaveText('Added: Nut allergy');
  // A file that is not a questionnaire is refused in plain words.
  await fixture.getByLabel('Load questions from a file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":1}'),
  });
  await expect(fixture.getByRole('alert')).toContainText('not a Sensibilia questionnaire file');
});

test('a step saved to the bank is added to the draft as a copy and can be archived', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Foundation fixture states' });
  await tabs.getByRole('tab', { name: 'Save or load questions', exact: true }).click();
  const bank = page
    .getByTestId('questionnaire-file-fixture')
    .getByRole('region', { name: 'Item bank' });
  await expect(bank.getByText('Nothing saved yet.')).toBeVisible();
  await bank.getByLabel('Name in the bank').fill('Nut allergy question');
  await bank.getByRole('button', { name: 'Save selected step to the bank' }).click();
  const row = bank.getByRole('row', { name: /Nut allergy question/ });
  await expect(row).toContainText('Question');
  await expect(row).toContainText('en');
  await expect(bank.getByLabel('Name in the bank')).toHaveValue('');
  await bank.getByRole('button', { name: 'Add Nut allergy question to this draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added:' })).toHaveText(
    'Added: Nut allergy',
  );
  // Archiving asks first, then hides the row; nothing is deleted.
  await row.getByRole('button', { name: 'Archive' }).click();
  await row.getByRole('button', { name: 'Archive Nut allergy question' }).click();
  await expect(bank.getByText('Nothing saved yet.')).toBeVisible();
});
