import { test, expect } from '@playwright/test';
import {
  advance,
  currentNode,
  initialState,
  assignmentsFor,
  flowIssues,
  type Flow,
  type Sample,
} from '../../src/shared/flow';
import { codeAnswer, answerValid } from '../../src/shared/nodes/answers';
import { capture } from './capture';
const id = (n: number) => '40000000-0000-4000-8000-' + String(n).padStart(12, '0');
const samples: Sample[] = Array.from({ length: 4 }, (_, i) => ({
  id: id(20 + i),
  study_version_id: id(30),
  code: 'S' + i,
  label: 'Private ' + i,
  ingredient_tags: i === 1 ? ['nut'] : [],
}));
const flow: Flow = {
  schema_version: 2,
  languages: ['en'],
  default_language: 'en',
  restriction_source_id: id(1),
  restriction_tag_map: { nuts: ['nut'] },
  nodes: [
    {
      id: id(1),
      kind: 'question',
      title: { en: 'Restrictions' },
      data: {
        prompt: { en: 'Restrictions' },
        answer_type: 'multiple',
        required: true,
        allow_skip: false,
        layout: 'vertical',
        options: [
          { id: 'nuts', label: { en: 'Nuts' }, exclusive: false },
          { id: 'none', label: { en: 'None' }, exclusive: true },
        ],
      },
    },
    {
      id: id(2),
      kind: 'loop_samples',
      title: { en: 'Samples' },
      data: {
        sample_ids: samples.map((s) => s.id),
        children: [
          {
            id: id(3),
            kind: 'info',
            title: { en: 'Rinse' },
            data: { body: { en: 'Researcher rinse wording' }, continue_label: { en: 'Continue' } },
          },
          {
            id: id(4),
            kind: 'code_entry',
            title: { en: 'Code' },
            data: {
              prompt: { en: 'Presented code' },
              source: 'sample_code',
              allow_unknown: false,
              normalization: 'trim_upper_ascii',
            },
          },
          {
            id: id(5),
            kind: 'info',
            title: { en: 'Do not taste' },
            guard: {
              variable: 'derived.sample_conflicts_restriction',
              operator: 'eq',
              value: true,
            },
            data: { body: { en: 'Do not taste this sample' }, continue_label: { en: 'Continue' } },
          },
          {
            id: id(6),
            kind: 'question',
            title: { en: 'Rating fixture' },
            guard: {
              variable: 'derived.sample_conflicts_restriction',
              operator: 'eq',
              value: false,
            },
            otherwise: { action: 'next_sample' },
            data: {
              prompt: { en: 'Integer' },
              answer_type: 'integer',
              required: true,
              allow_skip: false,
              layout: 'vertical',
              min: 0,
              max: 9,
            },
          },
        ],
      },
    },
    {
      id: id(7),
      kind: 'end',
      title: { en: 'Done' },
      data: { body: { en: 'Done' }, outcome: 'completed' },
    },
  ],
};
test('fixed sample loop scopes answers and path; serialized reload resumes exact occurrence', async () => {
  expect(flowIssues(flow)).toEqual([]);
  let state = advance(flow, initialState(flow, {}, assignmentsFor(flow, samples)), {
    state: 'answered',
    value: ['nuts'],
  });
  for (let i = 0; i < 4; i++) {
    expect(state.variables['sample.position']).toBe(i + 1);
    expect(state.answers).not.toHaveProperty(id(6));
    state = advance(flow, state, { state: 'continued', acknowledged: true });
    const code = await codeAnswer(' s' + i + ' ', 'trim_upper_ascii');
    expect(
      answerValid(
        currentNode(flow, state)!,
        await codeAnswer('WRONG', 'trim_upper_ascii'),
        state.variables,
      ),
    ).toBe(false);
    expect(answerValid(currentNode(flow, state)!, code, state.variables)).toBe(true);
    state = advance(flow, state, code);
    expect(state.variables['answer.' + id(4) + '.matched']).toBe(true);
    if (i === 1) {
      expect(currentNode(flow, state)?.title.en).toBe('Do not taste');
      state = advance(flow, state, { state: 'continued', acknowledged: true });
    } else {
      expect(currentNode(flow, state)?.title.en).toBe('Rating fixture');
      state = advance(flow, state, { state: 'answered', value: i });
    }
    state = JSON.parse(JSON.stringify(state));
  }
  expect(state.outcome).toBe('completed');
  expect(Object.keys(state.occurrenceAnswers).filter((k) => k.endsWith(id(6)))).toHaveLength(3);
  expect(state.path.filter((p) => p.nodeId === id(6) && p.kind === 'skipped')).toMatchObject([
    { sampleId: id(21), reason: 'restriction' },
  ]);
  expect(state.variables).not.toHaveProperty('sample.code');
  expect(state.variables).not.toHaveProperty('answer.' + id(4) + '.matched');
  expect(state.occurrenceAnswers[id(2) + ':' + id(20) + ':' + id(6)]).toEqual({
    state: 'answered',
    value: 0,
  });
});
test('missing tags and illegal sample scopes block start', () => {
  const design = {
    id: id(40),
    study_version_id: id(30),
    loop_id: id(2),
    settings: {
      sample_ids: samples.map((s) => s.id),
      algorithm: 'incomplete',
      block: 'incomplete',
      block_size: 2,
      seed: 42,
      generator_version: 'orders-sha256-v1',
    },
    sequences: [[samples[3].id, samples[0].id]],
  };
  const designed = assignmentsFor(flow, samples, [design]);
  expect(
    initialState({ ...flow, nodes: flow.nodes.slice(1) }, {}, designed).variables['sample.code'],
  ).toBe(samples[3].code);
  expect(() =>
    initialState({ ...flow, nodes: flow.nodes.slice(1) }, {}, [
      { ...designed[0], design_id: null },
    ]),
  ).toThrow('assignments');
  expect(() =>
    initialState({ ...flow, nodes: flow.nodes.slice(1) }, {}, [
      {
        ...designed[0],
        samples: [designed[0].samples[0], { ...designed[0].samples[0], position: 2 }],
      },
    ]),
  ).toThrow('assignments');

  expect(() =>
    assignmentsFor(
      flow,
      samples.map((s, i) => (i === 0 ? { ...s, ingredient_tags: null } : s)),
    ),
  ).toThrow('ingredient tags');
  expect(() => initialState({ ...flow, nodes: flow.nodes.slice(1) }, {}, [])).toThrow(
    'assignments',
  );
  const invalid = structuredClone(flow);
  invalid.nodes[2].guard = { variable: 'sample.code', operator: 'eq', value: 'S0' };
  expect(flowIssues(invalid).some((s) => s.includes('escape'))).toBe(true);
});
test(
  'sample loop gallery uses existing table controls and read-only state',
  { tag: '@audit' },
  async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Fixed sample loop', exact: true }).click();
    const section = page.getByRole('region', { name: 'Sample loop fixtures' });
    await expect(section.getByTestId('loop-samples').locator('tbody tr')).toHaveCount(4);
    await section.getByRole('button', { name: 'Move S1 up', exact: true }).click();
    await expect(
      section
        .getByTestId('loop-samples')
        .locator('tbody tr')
        .filter({ hasText: 'S1' })
        .locator('td')
        .nth(0),
    ).toHaveText('1');
    await capture(page, 'slice-3-gallery-loop', 'desktop', '#sample-loop');
    await section.getByLabel('Published loop fixture').check();
    await expect(section.getByRole('button', { name: 'Create and include sample' })).toBeDisabled();
    await capture(page, 'slice-3-gallery-loop-readonly', 'desktop', '#sample-loop');
  },
);

test('loop End study exits immediately without entering a subsequent sample', async () => {
  const local = structuredClone(flow);
  const loop = local.nodes[1];
  if (loop.kind !== 'loop_samples') throw new Error('fixture');
  const code = loop.data.children[1];
  if (code.kind !== 'code_entry') throw new Error('fixture');
  code.data.allow_unknown = true;
  const screened = {
    id: id(8),
    kind: 'end' as const,
    title: { en: 'Screened' },
    data: { body: { en: 'Screened' }, outcome: 'screened_out' as const },
  };
  local.nodes.push(screened);
  loop.data.children.splice(2, 0, {
    id: id(9),
    kind: 'confirm',
    title: { en: 'Code checked' },
    data: { body: { en: 'Matched' }, ack_label: { en: 'Confirm' } },
    guard: { variable: 'answer.' + id(4) + '.matched', operator: 'eq', value: true },
    otherwise: { action: 'end_study', target_id: id(8) },
  });
  expect(flowIssues(local)).toEqual([]);
  let state = advance(local, initialState(local, {}, assignmentsFor(local, samples)), {
    state: 'answered',
    value: ['none'],
  });
  state = advance(local, state, { state: 'continued', acknowledged: true });
  state = advance(local, state, await codeAnswer('WRONG', 'trim_upper_ascii'));
  expect(state.outcome).toBe('screened_out');
  expect(state.loop).toBeUndefined();
  expect(
    state.path.filter((p) => p.kind === 'submitted' && p.sampleId).map((p) => p.sampleId),
  ).toEqual([id(20), id(20)]);
});

test('unrelated next-sample guards retain guard_false reason on incompatible samples', async () => {
  const local = structuredClone(flow);
  const loop = local.nodes[1];
  if (loop.kind !== 'loop_samples') throw new Error('fixture');
  const rating = loop.data.children[3];
  rating.guard = { variable: 'context.language', operator: 'eq', value: 'sv' };
  let state = advance(local, initialState(local, {}, assignmentsFor(local, samples)), {
    state: 'answered',
    value: ['nuts'],
  });
  for (let i = 0; i < 4; i++) {
    state = advance(local, state, { state: 'continued', acknowledged: true });
    state = advance(local, state, await codeAnswer('S' + i, 'trim_upper_ascii'));
    if (currentNode(local, state)?.id === id(5))
      state = advance(local, state, { state: 'continued', acknowledged: true });
  }
  expect(state.outcome).toBe('completed');
  expect(
    state.path.filter((p) => p.nodeId === id(6) && p.kind === 'skipped').map((p) => p.reason),
  ).toEqual(Array(4).fill('guard_false'));
});
