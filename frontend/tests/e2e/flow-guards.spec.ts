import { test, expect } from '@playwright/test';
import vectors from '../../../docs/contracts/flow-condition-vectors.json' with { type: 'json' };
import {
  advance,
  currentNode,
  evaluate,
  initialState,
  returnFromReview,
  flowIssues,
  type Condition,
  type Flow,
} from '../../src/shared/flow';
import { answerValid, codeAnswer } from '../../src/shared/nodes/answers';
import { capture } from './capture';
import {
  appendBatteryRows,
  translateBatteryRows,
  questionnaireBlock,
  newNode,
  type MatrixNode,
} from '../../src/shared/nodes/authoring';
import { insertNear, methodTestsInLoops, moveNodeTo, outline } from '../../src/shared/flow';
import { scalePresets } from '../../src/shared/nodes/scalePresets';
import { timeoutScale } from '../timeouts';

test('battery bulk editing preserves IDs, translations and explicit scale zero', () => {
  const matrix = newNode('matrix_question', 'en') as MatrixNode;
  matrix.data.rows[0].prompt = { en: 'First', sv: 'Första' };
  matrix.data.options[0].score = 0;
  const result = appendBatteryRows(
    matrix,
    Array.from({ length: 16 }, (_, i) => 'Item ' + (i + 2)).join('\n'),
    'en',
    false,
  );
  expect(result.data.rows).toHaveLength(17);
  expect(result.data.rows[0]).toEqual(matrix.data.rows[0]);
  const translated = translateBatteryRows(
    result,
    'row_1\tNy första\n' + result.data.rows[1].id + '\tAndra',
    'sv',
  );
  expect(translated.data.rows[0].prompt).toEqual({ en: 'First', sv: 'Ny första' });
  expect(translated.data.rows.map((r) => r.id)).toEqual(result.data.rows.map((r) => r.id));
  expect(translated.data.options[0].score).toBe(0);
  expect(() => translateBatteryRows(result, 'foreign\tText', 'sv')).toThrow(/existing row IDs/);
  expect(() => translateBatteryRows(result, 'row_1\tText\nrow_1\tAgain', 'sv')).toThrow(/unique/);
  expect(() => appendBatteryRows(result, 'A\n\nB', 'en', true)).toThrow(/nonblank/);
  expect(() => appendBatteryRows(result, Array(100).fill('A').join('\n'), 'en', true)).toThrow(
    /100/,
  );
  expect(result.data.rows[0].prompt.sv).toBe('Första');
});

test('reviewed blocks remap internal guards and reject external or untranslated dependencies', () => {
  const q = newNode('question', 'en'),
    follow = newNode('info', 'en'),
    group = newNode('group', 'en');
  if (q.kind !== 'question' || follow.kind !== 'info' || group.kind !== 'group')
    throw new Error('fixture');
  q.data.prompt.en = 'Choose';
  q.data.options!.forEach((o, i) => (o.label.en = String(i)));
  follow.data.body.en = 'Follow';
  follow.guard = { variable: 'answer.' + q.id, operator: 'eq', value: q.data.options![0].id };
  group.data.children = [q, follow];
  const source: Flow = {
    schema_version: 2,
    text_version: 1,
    languages: ['en'],
    default_language: 'en',
    nodes: [group],
  };
  const copied = questionnaireBlock(source, group.id, source);
  const nodes = outline([copied]).map((e) => e.node);
  expect(
    nodes.map((n) => n.id).some((id) => outline(source.nodes).some((e) => e.node.id === id)),
  ).toBe(false);
  expect(nodes[2].guard).toEqual({
    variable: 'answer.' + nodes[1].id,
    operator: 'eq',
    value: q.data.options![0].id,
  });
  expect((nodes[1] as typeof q).data.options).toEqual(q.data.options);
  expect(() => questionnaireBlock(source, follow.id, source)).toThrow(/outside/);
  expect(() =>
    questionnaireBlock(source, group.id, { ...source, languages: ['en', 'sv'] }),
  ).toThrow(/reviewed text/);
  expect(() =>
    questionnaireBlock({ ...source, restriction_source_id: q.id }, q.id, source),
  ).toThrow(/Restriction/);
  expect(() => questionnaireBlock(source, group.id, { ...source, text_version: null })).toThrow(
    /text convention/,
  );
});
for (const vector of vectors)
  test('predicate parity: ' + vector.name, () => {
    expect(
      evaluate(
        vector.condition as Condition,
        vector.variables as Record<string, string | number | boolean | string[]>,
      ),
    ).toBe(vector.expected);
  });
const id = (i: number) => '20000000-0000-4000-8000-' + String(i).padStart(12, '0');
const flow: Flow = {
  schema_version: 2,
  languages: ['en'],
  default_language: 'en',
  nodes: [
    {
      id: id(1),
      kind: 'question',
      title: { en: 'Zero' },
      data: {
        prompt: { en: 'Value' },
        answer_type: 'integer',
        required: true,
        allow_skip: false,
        layout: 'vertical',
        min: 0,
      },
    },
    {
      id: id(2),
      kind: 'group',
      title: { en: 'Skipped group' },
      guard: { variable: 'answer.' + id(1), operator: 'neq', value: 0 },
      data: {
        children: [
          {
            id: id(3),
            kind: 'info',
            title: { en: 'Child' },
            data: { body: { en: 'Never shown' }, continue_label: { en: 'Continue' } },
          },
        ],
      },
    },
    {
      id: id(4),
      kind: 'info',
      title: { en: 'Jump' },
      guard: { variable: 'context.language', operator: 'eq', value: 'sv' },
      otherwise: { action: 'skip_to', target_id: id(6) },
      data: { body: { en: 'Never shown' }, continue_label: { en: 'Continue' } },
    },
    {
      id: id(5),
      kind: 'info',
      title: { en: 'Bypassed' },
      data: { body: { en: 'Bypassed' }, continue_label: { en: 'Continue' } },
    },
    {
      id: id(6),
      kind: 'confirm',
      title: { en: 'Review detour' },
      guard: { variable: 'context.language', operator: 'eq', value: 'sv' },
      otherwise: { action: 'previous_question' },
      data: { body: { en: 'Never shown' }, ack_label: { en: 'Confirm' } },
    },
    {
      id: id(7),
      kind: 'end',
      title: { en: 'Done' },
      data: { body: { en: 'Done' }, outcome: 'completed' },
    },
  ],
};
test('pure entry guards jump omissions and review resume preserve zero and lock answers', () => {
  expect(flowIssues(flow)).toEqual([]);
  const initial = initialState(flow);
  const context = initialState(flow, { booth_number: 0, table_number: null });
  expect(context.variables['context.booth_number']).toBe(0);
  expect(context.variables).not.toHaveProperty('context.table_number');
  const answer = { state: 'answered' as const, value: 0 };
  expect(answerValid(flow.nodes[0], answer, initial.variables)).toBe(true);
  const reviewed = advance(flow, initial, answer);
  expect(reviewed.review?.nodeId).toBe(id(1));
  expect(reviewed.answers[id(1)]).toEqual(answer);
  expect(advance(flow, reviewed, { state: 'answered', value: 1 })).toBe(reviewed);
  const resumed = returnFromReview(flow, reviewed);
  expect(resumed.outcome).toBe('completed');
  expect(resumed.variables['answer.' + id(1)]).toBe(0);
  expect(resumed.path.filter((p) => p.kind === 'skipped').map((p) => [p.nodeId, p.reason])).toEqual(
    [
      [id(2), 'guard_false'],
      [id(3), 'not_shown'],
      [id(4), 'guard_false'],
      [id(5), 'jumped'],
      [id(6), 'guard_false'],
    ],
  );
  expect(currentNode(flow, resumed)?.id).toBe(id(7));
  expect(returnFromReview(flow, advance(flow, initialState(flow), answer))).toEqual(resumed);
});
test('ordinary tagged states validate missing skipped unselected zero and exclusive options', () => {
  const methodId = id(11);
  const methodFlow: Flow = {
    schema_version: 2,
    languages: ['en'],
    default_language: 'en',
    nodes: [
      {
        id: methodId,
        kind: 'embedded_method',
        title: { en: 'Method' },
        data: { study_test_id: id(12), sample_binding: 'none' },
      },
      flow.nodes.at(-1)!,
    ],
  };
  const methodState = advance(methodFlow, initialState(methodFlow), { state: 7 });
  expect(methodState.answers[methodId]).toEqual({ state: 'method', answers: { state: 7 } });
  expect(methodState.variables['answer.' + methodId + '.state']).toBe(7);
  const integer = flow.nodes[0];
  expect(answerValid(integer, undefined, {})).toBe(false);
  expect(answerValid(integer, { state: 'answered', value: 0 }, {})).toBe(true);
  expect(answerValid(integer, { state: 'answered', value: false }, {})).toBe(false);
  const question: Flow['nodes'][number] = {
    id: id(8),
    kind: 'question',
    title: { en: 'Choice' },
    data: {
      prompt: { en: 'Choice' },
      answer_type: 'multiple',
      required: false,
      allow_skip: true,
      layout: 'vertical',
      options: [
        { id: 'nuts', label: { en: 'Nuts' }, exclusive: false },
        { id: 'none', label: { en: 'None' }, exclusive: true },
      ],
    },
  };
  expect(answerValid(question, undefined, {})).toBe(true);
  expect(answerValid(question, { state: 'skipped' }, {})).toBe(true);
  expect(answerValid(question, { state: 'answered', value: [] }, {})).toBe(true);
  expect(answerValid(question, { state: 'answered', value: ['nuts', 'none'] }, {})).toBe(false);
  const matrix: Flow['nodes'][number] = {
    id: id(9),
    kind: 'matrix_question',
    title: { en: 'Matrix' },
    data: {
      instructions: { en: 'Rate' },
      rows: [
        { id: 'required', prompt: { en: 'Required' }, required: true },
        { id: 'optional', prompt: { en: 'Optional' }, required: false },
      ],
      options: [
        { id: 'zero', label: { en: 'Zero' }, score: 0, exclusive: false },
        { id: 'one', label: { en: 'One' }, score: 1, exclusive: false },
      ],
      allow_skip: true,
      layout: 'vertical',
    },
  };
  expect(
    answerValid(
      matrix,
      { state: 'matrix', answers: { required: { state: 'selected', option_id: 'zero' } } },
      {},
    ),
  ).toBe(true);
  expect(
    answerValid(matrix, { state: 'matrix', answers: { required: { state: 'skipped' } } }, {}),
  ).toBe(true);
  expect(answerValid(matrix, { state: 'matrix', answers: {} }, {})).toBe(false);
});
test('returning membership uses normalized frozen hashes and no client matched flag', async () => {
  const code = await codeAnswer(' abc ', 'trim_upper_ascii');
  expect(code.normalized_code).toBe('ABC');
  expect(code).not.toHaveProperty('matched');
  const node: Flow['nodes'][number] = {
    id: id(10),
    kind: 'code_entry',
    title: { en: 'Code' },
    data: {
      prompt: { en: 'Code' },
      source: 'returning_codes',
      allow_unknown: false,
      normalization: 'trim_upper_ascii',
    },
  };
  expect(answerValid(node, code, { 'context.returning_code_hashes': [code.code_hash] })).toBe(true);
  expect(answerValid(node, code, { 'context.returning_code_hashes': [] })).toBe(false);
});
test(
  'guards gallery popover focus typed nested conditions and read-only states',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(90000 * timeoutScale); // Multiple full-gallery axe scans; retain all assertions.
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Guards and Otherwise', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Guard fixtures', exact: true });
    const trigger = gallery.getByRole('button', { name: 'Show only if', exact: true });
    await trigger.click();
    await gallery.getByLabel('Show if', { exact: true }).selectOption('condition');
    await expect(gallery.getByLabel('Answer or setting 1', { exact: true })).toHaveValue(
      'context.language',
    );
    await gallery.getByRole('button', { name: 'AND 1', exact: true }).click();
    await gallery.getByLabel('Comparison 1.1', { exact: true }).selectOption('is_defined');
    await gallery
      .getByLabel('Answer or setting 1.2', { exact: true })
      .selectOption('context.booth_number');
    await gallery.getByLabel('Compare with 1.2', { exact: true }).fill('');
    await expect(gallery.getByLabel('Compare with 1.2', { exact: true })).toHaveValue('');
    await expect(gallery.getByLabel('Compare with 1.2', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await gallery.getByLabel('Compare with 1.2', { exact: true }).fill('0');
    await capture(page, 'slice-2-guard-popover', 'desktop', '#guards');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(gallery.getByRole('region', { name: 'Show only if', exact: true })).toHaveCount(0);
    const group = gallery.getByTestId('flow-outline').locator('tbody tr[data-row-id]').nth(1);
    await group.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(group.getByRole('button', { name: /Expand/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('button', { name: /Collapse/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await gallery.getByRole('tab', { name: 'Read-only', exact: true }).click();
    await expect(trigger).toBeDisabled();
    await gallery.getByRole('tab', { name: 'Loading', exact: true }).click();
    await expect(gallery.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await gallery.getByRole('tab', { name: 'Error', exact: true }).click();
    await expect(gallery.getByRole('alert')).toContainText('buffer retained');
    await gallery.getByRole('tab', { name: 'Empty', exact: true }).click();
    await expect(gallery.getByText('No condition. Always / Continue.')).toBeVisible();
    await gallery.getByRole('tab', { name: 'Edit', exact: true }).click();
    await gallery.getByLabel('Fixture node kind', { exact: true }).selectOption('matrix_question');
    await gallery.getByLabel('instructions', { exact: true }).fill('Matrix fixture');
    await gallery.getByLabel('Question text', { exact: true }).fill('Matrix row');
    await gallery.getByLabel('Option text', { exact: true }).nth(0).fill('Low');
    await gallery.getByLabel('Option text', { exact: true }).nth(1).fill('High');
    await gallery.getByLabel('Allow skipping', { exact: true }).check();
    await gallery.getByRole('tab', { name: 'Renderers', exact: true }).click();
    await expect(
      gallery.getByRole('button', { name: 'Fixture Continue', exact: true }),
    ).toBeDisabled();
    await gallery.getByRole('radio', { name: 'Low', exact: true }).check();
    await expect(
      gallery.getByRole('button', { name: 'Fixture Continue', exact: true }),
    ).toBeEnabled();
    await gallery.getByRole('button', { name: 'Fixture Continue', exact: true }).click();
    await expect(gallery.getByRole('status')).toHaveText('Accepted matrix fixture answer.');
    await gallery.getByRole('button', { name: 'Skip Matrix row', exact: true }).click();
    await expect(gallery.getByLabel('Renderer state', { exact: true })).toHaveValue(/skipped/);
    await gallery.getByLabel('Read-only renderer', { exact: true }).check();
    await expect(gallery.getByRole('radio', { name: 'High', exact: true })).toBeDisabled();
    await capture(page, 'slice-2-matrix-renderer', 'desktop', '#guards');
    await gallery.getByLabel('Read-only renderer', { exact: true }).uncheck();
    await gallery.getByRole('tab', { name: 'Edit', exact: true }).click();
    await gallery.getByLabel('Fixture node kind', { exact: true }).selectOption('question');
    await gallery.getByLabel('Answer type', { exact: true }).selectOption('text');
    await gallery.getByLabel('Question text', { exact: true }).fill('Text fixture');
    await gallery.getByLabel('Allow skipping', { exact: true }).check();
    await gallery.getByRole('tab', { name: 'Renderers', exact: true }).click();
    await gallery.getByRole('button', { name: 'Reset fixture answer', exact: true }).click();
    await expect(
      gallery.getByRole('button', { name: 'Fixture Continue', exact: true }),
    ).toBeDisabled();
    await gallery.getByLabel('Text fixture', { exact: true }).fill('Unicode åäö');
    await expect(
      gallery.getByRole('button', { name: 'Fixture Continue', exact: true }),
    ).toBeEnabled();
    await gallery.getByRole('button', { name: 'Skip question', exact: true }).click();
    await expect(gallery.getByLabel('Renderer state', { exact: true })).toHaveValue(/skipped/);
    await gallery.getByRole('tab', { name: 'Code reset', exact: true }).click();
    await gallery.getByText('Rehearsal context', { exact: true }).click();
    await gallery.getByLabel('Returning codes', { exact: true }).fill('ABC');
    await gallery
      .getByRole('button', { name: 'Apply rehearsal context and reset', exact: true })
      .click();
    await gallery.getByLabel('First code input', { exact: true }).fill('abc');
    await expect(gallery.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
    await gallery.getByRole('button', { name: 'Reset rehearsal', exact: true }).click();
    await expect(gallery.getByLabel('First code input', { exact: true })).toHaveValue('');
    await expect(gallery.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    // capture() asserts no serious or critical axe violations in the audit tier.
    await capture(page, 'slice-2-code-reset', 'desktop', '#guards');
  },
);

test('standard scale presets are well formed', () => {
  expect(new Set(scalePresets.map((p) => p.id)).size).toBe(scalePresets.length);
  for (const preset of scalePresets) {
    expect(preset.labels.length).toBeGreaterThanOrEqual(5);
    expect(new Set(preset.labels).size).toBe(preset.labels.length);
  }
});

test('drag and drop moves keep ids, refuse impossible drops and detect no-ops', () => {
  const [a, b, c, group, loop, end] = [
    newNode('consent', 'en'),
    newNode('consent', 'en'),
    newNode('consent', 'en'),
    newNode('group', 'en'),
    newNode('loop_samples', 'en'),
    newNode('end', 'en'),
  ];
  const nodes = [a, b, c, group, loop, end];
  const layout = (list: typeof nodes) =>
    outline(list).map((e) => e.number + ':' + e.node.id.slice(0, 4));
  const label = (n: (typeof nodes)[number]) => n.id.slice(0, 4);
  const moved = moveNodeTo(nodes, a.id, c.id, 'after')!;
  expect(outline(moved).map((e) => label(e.node))).toEqual([b, c, a, group, loop, end].map(label));
  const into = moveNodeTo(nodes, a.id, group.id, 'inside')!;
  expect(outline(into).find((e) => e.node.id === a.id)!.number).toBe('3.1');
  const out = moveNodeTo(into, a.id, end.id, 'before')!;
  expect(outline(out).find((e) => e.node.id === a.id)!.ancestors).toEqual([]);
  expect(layout(moveNodeTo(nodes, group.id, a.id, 'before')!)[0]).toContain(group.id.slice(0, 4));
  // Refused: onto itself, into its own contents, inside a plain step, no change.
  expect(moveNodeTo(nodes, a.id, a.id, 'after')).toBeUndefined();
  expect(moveNodeTo(into, group.id, a.id, 'after')).toBeUndefined();
  expect(moveNodeTo(nodes, a.id, b.id, 'inside')).toBeUndefined();
  expect(moveNodeTo(nodes, a.id, b.id, 'before')).toBeUndefined();
  expect(moveNodeTo(nodes, b.id, a.id, 'after')).toBeUndefined();
  // A terminal step may not enter a sample loop, other steps may.
  expect(moveNodeTo(nodes, end.id, loop.id, 'inside')).toBeUndefined();
  expect(moveNodeTo(nodes, a.id, loop.id, 'inside')).toBeDefined();
  expect(moveNodeTo(nodes, group.id, loop.id, 'inside')).toBeDefined();
  // The input is never mutated.
  expect(nodes.map(label)).toEqual([a, b, c, group, loop, end].map(label));
});

test('a new step goes next to the selected step, staying inside its loop', () => {
  const method = (n: number): ReturnType<typeof newNode> => ({
    id: 'method_' + n,
    kind: 'embedded_method',
    title: { en: 'Method ' + n },
    data: { study_test_id: 'test_' + n, sample_binding: 'none' },
  });
  const loop = newNode('loop_samples', 'en');
  if (loop.kind !== 'loop_samples') throw new Error('loop');
  const first = method(1);
  loop.data.children = [first];
  const end = newNode('end', 'en');
  const nodes = [loop, end];
  const place = (list: typeof nodes, anchor?: string) =>
    outline(insertNear(list, method(2), anchor)).map((e) => e.number + ':' + e.node.id);
  // A step inside the loop is selected: the new one stays in the loop, right after it.
  expect(place(nodes, first.id)).toEqual([
    '1:' + loop.id,
    '1.1:method_1',
    '1.2:method_2',
    '2:' + end.id,
  ]);
  // The loop itself is selected: at the end of its contents.
  expect(place(nodes, loop.id)).toContain('1.2:method_2');
  // The End is selected, or nothing is: before the End, outside the loop.
  expect(place(nodes, end.id).at(-2)).toBe('2:method_2');
  expect(place(nodes).at(-2)).toBe('2:method_2');
  // The input is never mutated.
  expect(outline(nodes)).toHaveLength(3);
});

test('methods inside a sample loop are found for a moved step', () => {
  const method = (n: number): ReturnType<typeof newNode> => ({
    id: 'method_' + n,
    kind: 'embedded_method',
    title: { en: 'Method ' + n },
    data: { study_test_id: 'test_' + n, sample_binding: 'none' },
  });
  const loop = newNode('loop_samples', 'en');
  const group = newNode('group', 'en');
  if (loop.kind !== 'loop_samples' || group.kind !== 'group') throw new Error('containers');
  loop.data.children = [method(1), group];
  group.data.children = [method(2)];
  const outside = method(3);
  const nodes = [loop, outside];
  expect(methodTestsInLoops(nodes, 'method_1')).toEqual(['test_1']);
  expect(methodTestsInLoops(nodes, group.id)).toEqual(['test_2']);
  expect(methodTestsInLoops(nodes, loop.id)).toEqual(['test_1', 'test_2']);
  expect(methodTestsInLoops(nodes, 'method_3')).toEqual([]);
});

test('dragging a sequence step into a group and out again', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Guards and Otherwise', exact: true }).click();
  const outlineTable = page
    .getByRole('region', { name: 'Guard fixtures', exact: true })
    .getByTestId('flow-outline');
  const rows = outlineTable.locator('tbody tr[data-row-id]');
  const consent = rows.nth(0);
  const id = (await consent.getAttribute('data-row-id'))!;
  const group = rows.nth(1);
  await expect(consent.locator('td').first()).toHaveText('1');
  // Middle of a group row drops inside it.
  await consent.dragTo(group);
  await expect(outlineTable.locator('tr[data-row-id="' + id + '"] td').first()).toHaveText('1.1');
  // Dropping on the top edge of the last row (End) moves it back out, before End.
  const end = outlineTable.locator('tbody tr[data-row-id]').last();
  await outlineTable.locator('tr[data-row-id="' + id + '"]').dragTo(end, {
    targetPosition: { x: 40, y: 2 },
  });
  await expect(outlineTable.locator('tr[data-row-id="' + id + '"] td').first()).toHaveText('2');
});
