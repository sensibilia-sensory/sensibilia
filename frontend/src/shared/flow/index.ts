import type { components } from '../../api-schema';
export type Flow = components['schemas']['DraftFlowV2-Input'];
export type Node = Flow['nodes'][number];
export type Condition = NonNullable<Node['guard']>;
export type Test = components['schemas']['TestRead'];
export type Scalar = string | number | boolean;
export type Value = Scalar | Scalar[];
export type Answer =
  | { state: 'temporal'; value: import('../methods/temporal').TemporalDraft; ready: boolean }
  | { state: 'answered'; value: Scalar | string[] }
  | {
      state: 'delivery';
      mode: 'served' | 'manual';
      codes: string[];
      reason: string;
      elapsed_ms: number;
      clock_quality: 'monotonic' | 'wall_estimate';
      offline: boolean;
    }
  | { state: 'skipped' }
  | { state: 'continued'; acknowledged: boolean }
  | {
      state: 'matrix';
      answers: Record<
        string,
        { state: 'selected'; option_id: string } | { state: 'skipped'; option_id?: null }
      >;
    }
  | { state: 'code'; normalized_code: string; code_hash: string }
  | { state: 'method'; answers: Record<string, number | 'skipped'> }
  | {
      state: 'method_values';
      answers: Record<string, components['schemas']['EventCreate']['value']>;
      ready: boolean;
    };
export interface Entry {
  node: Node;
  ancestors: string[];
  number: string;
  end: number;
}
export const evaluatorVersion = 'assets-v2.10';
export type Sample = components['schemas']['SampleRead'];
export type LoopAssignment = components['schemas']['LoopAssignment'];
export function assignmentsFor(
  flow: Flow,
  samples: Sample[],
  designs: components['schemas']['DesignRead'][] = [],
  sequenceIndex = 0,
): LoopAssignment[] {
  return outline(flow.nodes).flatMap(({ node }) =>
    node.kind === 'loop_samples' ||
    (node.kind === 'serve_gate' && node.data.sample_binding === 'set')
      ? [
          {
            loop_id: node.id,
            ...(() => {
              const d = designs.find((d) => d.loop_id === node.id);
              return d
                ? {
                    design_id: d.id,
                    design_algorithm: String(d.settings.algorithm),
                    design_seed: Number(d.settings.seed),
                    generator_version: String(d.settings.generator_version),
                    design_block: d.settings.block as 'complete' | 'incomplete',
                    design_block_size:
                      d.settings.block_size == null ? null : Number(d.settings.block_size),
                    sequence_index: sequenceIndex % d.sequences.length,
                  }
                : {};
            })(),
            samples: (() => {
              const design = designs.find((d) => d.loop_id === node.id);
              if (
                design &&
                JSON.stringify(design.settings.sample_ids) !== JSON.stringify(node.data.sample_ids)
              )
                throw new Error('Loop samples changed. Regenerate or remove its design.');
              return design
                ? design.sequences[sequenceIndex % design.sequences.length]
                : (node.data.sample_ids ?? []);
            })().map((id, i) => {
              const sample = samples.find((s) => s.id === id);
              if (!sample || sample.ingredient_tags == null)
                throw new Error('Review ingredient tags for every loop sample.');
              return {
                sample_id: id,
                code: sample.code,
                ingredient_tags: sample.ingredient_tags,
                position: i + 1,
              };
            }),
          },
        ]
      : [],
  );
}
export const occurrenceId = (state: State) =>
  state.loop
    ? state.loop.id +
      ':' +
      state.assignments.find((a) => a.loop_id === state.loop!.id)!.samples[state.loop.position]
        .sample_id
    : 'study';
export const answerKey = (state: State, id: string) => occurrenceId(state) + ':' + id;
export function outline(nodes: Node[], ancestors: string[] = [], prefix = ''): Entry[] {
  const entries: Entry[] = [];
  nodes.forEach((node, i) => {
    const number = prefix + (i + 1);
    const entry: Entry = { node, ancestors, number, end: 0 };
    entries.push(entry);
    if (node.kind === 'group' || node.kind === 'loop_samples')
      entries.push(...outline(node.data.children, [...ancestors, node.id], number + '.'));
  });
  entries.forEach((entry, i) => {
    let end = i + 1;
    while (end < entries.length && entries[end].ancestors.includes(entry.node.id)) end++;
    entry.end = end;
  });
  return entries;
}
export function updateNode(nodes: Node[], id: string, change: (node: Node) => Node): Node[] {
  return nodes.map((node) =>
    node.id === id
      ? change(node)
      : node.kind === 'group' || node.kind === 'loop_samples'
        ? ({
            ...node,
            data: { ...node.data, children: updateNode(node.data.children, id, change) },
          } as Node)
        : node,
  );
}
export function siblingEdit(
  nodes: Node[],
  id: string,
  change: (siblings: Node[], index: number) => Node[],
): Node[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) return change([...nodes], index);
  return nodes.map((node) =>
    node.kind === 'group' || node.kind === 'loop_samples'
      ? ({
          ...node,
          data: { ...node.data, children: siblingEdit(node.data.children, id, change) },
        } as Node)
      : node,
  );
}
export type DropPosition = 'before' | 'after' | 'inside';
const isContainer = (node: Node) => node.kind === 'group' || node.kind === 'loop_samples';
/**
 * Where a newly added step goes: inside the selected group or sample loop (at the end), otherwise
 * right after the selected step in whatever level it sits at, so adding while a step inside a loop
 * is selected stays inside that loop. With nothing selected it goes before the closing End steps.
 */
export function insertNear(nodes: Node[], node: Node, anchorId?: string): Node[] {
  const anchor = anchorId ? outline(nodes).find((e) => e.node.id === anchorId)?.node : undefined;
  if (anchor && isContainer(anchor))
    return updateNode(nodes, anchor.id, (n) =>
      n.kind === 'group' || n.kind === 'loop_samples'
        ? ({ ...n, data: { ...n.data, children: [...n.data.children, node] } } as Node)
        : n,
    );
  if (anchor)
    return siblingEdit(nodes, anchor.id, (siblings, i) => {
      siblings.splice(anchor.kind === 'end' && node.kind !== 'end' ? i : i + 1, 0, node);
      return siblings;
    });
  return [...nodes.filter((n) => n.kind !== 'end'), node, ...nodes.filter((n) => n.kind === 'end')];
}
/** Test ids of the methods in a step's subtree that sit inside a sample loop. */
export function methodTestsInLoops(nodes: Node[], id: string): string[] {
  const entries = outline(nodes);
  const loops = new Set(
    entries.filter((e) => e.node.kind === 'loop_samples').map((e) => e.node.id),
  );
  return entries.flatMap((e) =>
    e.node.kind === 'embedded_method' &&
    (e.node.id === id || e.ancestors.includes(id)) &&
    e.ancestors.some((a) => loops.has(a))
      ? [e.node.data.study_test_id]
      : [],
  );
}
/**
 * Move a step (with everything inside it) next to another step, or into a group or sample loop.
 * Returns undefined when the move is not allowed or changes nothing: onto itself, into its own
 * contents, inside a step that is not a group or loop, or a terminal step into a sample loop.
 * Step ids never change, so guards and "otherwise" targets keep pointing at the same steps.
 */
export function moveNodeTo(
  nodes: Node[],
  id: string,
  targetId: string,
  position: DropPosition,
): Node[] | undefined {
  const entries = outline(nodes),
    source = entries.find((e) => e.node.id === id),
    target = entries.find((e) => e.node.id === targetId);
  if (!source || !target || id === targetId || target.ancestors.includes(id)) return undefined;
  if (position === 'inside' && !isContainer(target.node)) return undefined;
  const parents = position === 'inside' ? [...target.ancestors, targetId] : target.ancestors;
  if (
    parents.some((p) => entries.find((e) => e.node.id === p)?.node.kind === 'loop_samples') &&
    outline([source.node]).some((e) => e.node.kind === 'end')
  )
    return undefined;
  const detach = (list: Node[]): Node[] =>
    list
      .filter((n) => n.id !== id)
      .map((n) =>
        isContainer(n)
          ? ({
              ...n,
              data: { ...n.data, children: detach((n.data as { children: Node[] }).children) },
            } as Node)
          : n,
      );
  const attach = (list: Node[]): Node[] => {
    const i = list.findIndex((n) => n.id === targetId);
    if (i >= 0) {
      const next = [...list];
      if (position === 'inside') {
        const t = next[i] as Node & { data: { children: Node[] } };
        next[i] = {
          ...t,
          data: { ...t.data, children: [...t.data.children, source.node] },
        } as Node;
      } else next.splice(position === 'before' ? i : i + 1, 0, source.node);
      return next;
    }
    return list.map((n) =>
      isContainer(n)
        ? ({
            ...n,
            data: { ...n.data, children: attach((n.data as { children: Node[] }).children) },
          } as Node)
        : n,
    );
  };
  const moved = attach(detach(nodes)),
    place = (list: Node[]) =>
      outline(list)
        .map((e) => e.node.id + '<' + (e.ancestors.at(-1) ?? ''))
        .join();
  return place(moved) === place(nodes) ? undefined : moved;
}
export function legalTargets(flow: Flow, id: string, action?: string) {
  const entries = outline(flow.nodes),
    from = entries.findIndex((e) => e.node.id === id);
  if (from < 0) return [];
  const loopScope = (entry: Entry) =>
    entry.ancestors.find(
      (id) => entries.find((e) => e.node.id === id)?.node.kind === 'loop_samples',
    );
  const nextAction = action ?? entries[from].node.otherwise?.action;
  return entries.filter(
    (entry, i) =>
      i >= entries[from].end &&
      entry.ancestors.every((a, j) => entries[from].ancestors[j] === a) &&
      (nextAction === 'end_study' || loopScope(entry) === loopScope(entries[from])),
  );
}
const equal = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.every((v) => b.some((w) => equal(v, w))) && b.every((v) => a.some((w) => equal(v, w)))
    : typeof a === typeof b && a === b;
/** Closed operators; missing/skipped values are absent, including for neq. */
export function evaluate(condition: Condition, variables: Record<string, Value>): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluate(c, variables));
  if ('any' in condition) return condition.any.some((c) => evaluate(c, variables));
  if (condition.operator === 'is_defined') return Object.hasOwn(variables, condition.variable);
  if (!Object.hasOwn(variables, condition.variable)) return false;
  const actual = variables[condition.variable],
    expected = condition.value;
  switch (condition.operator) {
    case 'eq':
      return equal(actual, expected);
    case 'neq':
      return !equal(actual, expected);
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      return condition.operator === 'lt'
        ? actual < expected
        : condition.operator === 'lte'
          ? actual <= expected
          : condition.operator === 'gt'
            ? actual > expected
            : actual >= expected;
    case 'in':
      return Array.isArray(expected) && expected.some((v) => equal(actual, v));
    case 'contains':
      return Array.isArray(actual) && actual.some((v) => equal(v, expected));
    case 'intersects':
      return (
        Array.isArray(actual) &&
        Array.isArray(expected) &&
        actual.some((v) => expected.some((w) => equal(v, w)))
      );
  }
}
export interface Variable {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'set';
  source?: string;
  required: boolean;
  options?: string[];
}
export function variablesFor(flow: Flow, tests: Test[] = []): Variable[] {
  const result: Variable[] = [
    { key: 'context.language', label: 'Session language', type: 'string', required: true },
    { key: 'context.booth_number', label: 'Booth number', type: 'number', required: false },
    { key: 'context.table_number', label: 'Table number', type: 'number', required: false },
    {
      key: 'context.returning_code_hashes',
      label: 'Returning code hashes',
      type: 'set',
      required: true,
    },
  ];
  for (const { node, number } of outline(flow.nodes)) {
    const key = 'answer.' + node.id,
      label = number + ' ' + node.title[flow.default_language];
    const add = (suffix: string, type: Variable['type'], required: boolean, options?: string[]) =>
      result.push({
        key: key + suffix,
        label: label + suffix,
        type,
        required,
        source: node.id,
        options,
      });
    if (node.kind === 'consent') add('', 'boolean', true);
    if (node.kind === 'question')
      add(
        '',
        node.data.answer_type === 'multiple'
          ? 'set'
          : node.data.answer_type === 'integer'
            ? 'number'
            : 'string',
        node.data.required && !node.data.allow_skip,
        node.data.options?.map((o) => o.id),
      );
    if (node.kind === 'matrix_question')
      node.data.rows.forEach((r) =>
        add(
          '.' + r.id,
          'string',
          r.required && !node.data.allow_skip,
          node.data.options.map((o) => o.id),
        ),
      );
    if (node.kind === 'code_entry') {
      add('', 'string', true);
      add('.matched', 'boolean', true);
    }
    if (node.kind === 'embedded_method') {
      const config = tests.find((t) => t.id === node.data.study_test_id)?.configuration;
      if (config && 'questions' in config && (!('kind' in config) || config.kind === 'jar'))
        config.questions.forEach((q) =>
          add('.' + q.id, 'number', q.required && !('allow_skips' in config && config.allow_skips)),
        );
    }
    if (
      node.id === flow.restriction_source_id &&
      node.kind === 'question' &&
      node.data.answer_type === 'multiple'
    )
      result.push({
        key: 'assessor.restrictions',
        label: 'Declared restrictions',
        type: 'set',
        required: node.data.required && !node.data.allow_skip,
        source: node.id,
        options: node.data.options?.filter((o) => !o.exclusive).map((o) => o.id),
      });
  }
  result.push(
    { key: 'sample.code', label: 'Current sample code', type: 'string', required: true },
    { key: 'sample.position', label: 'Current sample position', type: 'number', required: true },
    {
      key: 'sample.ingredient_tags',
      label: 'Current ingredient tags',
      type: 'set',
      required: true,
    },
    {
      key: 'derived.sample_conflicts_restriction',
      label: 'Sample conflicts with restrictions',
      type: 'boolean',
      source: flow.restriction_source_id ?? undefined,
      required: true,
    },
  );
  return result;
}
export function conditionText(condition: Node['guard'], flow: Flow, tests: Test[] = []): string {
  if (!condition) return 'Always';
  if ('all' in condition || 'any' in condition) {
    const key = 'all' in condition ? 'all' : 'any';
    return (
      '(' +
      ('all' in condition ? condition.all : condition.any)
        .map((c) => conditionText(c, flow, tests))
        .join(key === 'all' ? ' AND ' : ' OR ') +
      ')'
    );
  }
  const label =
    variablesFor(flow, tests).find((v) => v.key === condition.variable)?.label ??
    condition.variable;
  return (
    label +
    ' ' +
    condition.operator +
    ('value' in condition ? ' ' + JSON.stringify(condition.value) : '')
  );
}
export interface PathEntry {
  nodeId: string;
  kind: 'entered' | 'submitted' | 'skipped' | 'reviewed' | 'ended';
  reason?: 'guard_false' | 'jumped' | 'not_shown' | 'restriction';
  occurrenceId?: string;
  sampleId?: string | null;
  /** Rehearsal diagnostics only; older serialized states remain readable. */
  variables?: Record<string, Value>;
  guardResult?: boolean;
  action?: string;
  targetId?: string;
}
export interface State {
  index: number;
  assignments: LoopAssignment[];
  occurrenceAnswers: Record<string, Answer>;
  loop?: {
    id: string;
    start: number;
    exit: number;
    position: number;
    variables: Record<string, Value>;
    answers: Record<string, Answer>;
    visited: string[];
  };
  answers: Record<string, Answer>;
  variables: Record<string, Value>;
  visited: string[];
  path: PathEntry[];
  review?: { nodeId: string; resume: number; settle?: boolean };
  outcome?: 'completed' | 'screened_out';
}
export function initialState(
  flow?: Flow,
  context: Record<string, Value | null | undefined> = {},
  assignments: LoopAssignment[] = [],
  methodAssignments: {
    study_test_id?: string;
    samples: { code: string }[];
    reference?: { code: string } | null;
  }[] = [],
): State {
  const contextValues = Object.fromEntries(
    Object.entries(context)
      .filter((entry): entry is [string, Value] => entry[1] != null)
      .map(([key, value]) => [key.startsWith('context.') ? key : 'context.' + key, value]),
  );
  const state: State = {
    index: 0,
    assignments,
    occurrenceAnswers: {},
    answers: {},
    variables: {
      'context.language': flow?.default_language ?? 'en',
      'context.returning_code_hashes': [],
      ...contextValues,
      ...Object.fromEntries(
        methodAssignments.map((a) => [
          'serving.plan.' + a.study_test_id,
          [...(a.reference ? [a.reference.code] : []), ...a.samples.map((s) => s.code)],
        ]),
      ),
    },
    visited: [],
    path: [],
  };
  return flow ? settle(flow, state) : state;
}
function failingConflict(condition: Condition, variables: Record<string, Value>): boolean {
  if ('all' in condition) return condition.all.some((c) => failingConflict(c, variables));
  if ('any' in condition)
    return (
      condition.any.every((c) => !evaluate(c, variables)) &&
      condition.any.some((c) => failingConflict(c, variables))
    );
  return (
    condition.variable === 'derived.sample_conflicts_restriction' && !evaluate(condition, variables)
  );
}
function settle(flow: Flow, previous: State): State {
  const entries = outline(flow.nodes),
    state = { ...previous, path: [...previous.path] };
  const path = (nodeId: string, kind: PathEntry['kind'], reason?: PathEntry['reason']) =>
    state.path.push({
      nodeId,
      kind,
      reason,
      ...pathDiagnostics(flow, state.variables, nodeId, kind, reason),
      occurrenceId: occurrenceId(state),
      sampleId: state.loop
        ? state.assignments.find((a) => a.loop_id === state.loop!.id)!.samples[state.loop.position]
            .sample_id
        : null,
    });
  const sampleScope = () => {
    const loop = state.loop!;
    const sample = state.assignments.find((a) => a.loop_id === loop.id)!.samples[loop.position];
    state.answers = { ...loop.answers };
    state.visited = [...loop.visited];
    state.variables = {
      ...loop.variables,
      'sample.code': sample.code,
      'sample.position': sample.position,
      'sample.ingredient_tags': sample.ingredient_tags,
    };
    if (Array.isArray(state.variables['assessor.restrictions'])) {
      const tags = (state.variables['assessor.restrictions'] as string[]).flatMap(
        (id) => flow.restriction_tag_map?.[id] ?? [],
      );
      state.variables['derived.sample_conflicts_restriction'] = tags.some((tag) =>
        sample.ingredient_tags.includes(tag),
      );
    }
  };
  while (state.index < entries.length) {
    if (state.loop && state.index >= state.loop.exit) {
      const loop = state.loop;
      if (
        loop.position + 1 <
        state.assignments.find((a) => a.loop_id === loop.id)!.samples.length
      ) {
        state.loop = { ...loop, position: loop.position + 1 };
        state.index = loop.start;
        sampleScope();
      } else {
        state.variables = { ...loop.variables };
        state.answers = { ...loop.answers };
        state.visited = [...loop.visited];
        state.loop = undefined;
      }
    }
    const entry = entries[state.index],
      node = entry.node;
    if (node.guard && !evaluate(node.guard, state.variables)) {
      path(
        node.id,
        'skipped',
        node.otherwise?.action === 'next_sample' &&
          state.variables['derived.sample_conflicts_restriction'] === true &&
          failingConflict(node.guard, state.variables)
          ? 'restriction'
          : 'guard_false',
      );
      for (let i = state.index + 1; i < entry.end; i++)
        path(entries[i].node.id, 'skipped', 'not_shown');
      const action = node.otherwise?.action ?? 'continue';
      let next = entry.end;
      if (action === 'skip_to' || action === 'end_study') {
        const target = node.otherwise;
        next =
          target && 'target_id' in target
            ? entries.findIndex((e) => e.node.id === target.target_id)
            : -1;
        if (!legalTargets(flow, node.id).some((e) => e.node.id === entries[next]?.node.id))
          throw new Error('Illegal forward target');
        for (let i = entry.end; i < next; i++) path(entries[i].node.id, 'skipped', 'jumped');
        if (action === 'end_study' && state.loop) {
          state.variables = { ...state.loop.variables };
          state.answers = { ...state.loop.answers };
          state.visited = [...state.loop.visited];
          state.loop = undefined;
        }
      }
      if (action === 'previous_question') {
        const prior = [...state.visited]
          .reverse()
          .find(
            (id) =>
              reviewable(state.answers[id]) &&
              (!state.loop ||
                entries.find((e) => e.node.id === id)?.ancestors.includes(state.loop.id)),
          );
        if (!prior) throw new Error('No previous answered question');
        return { ...state, index: next, review: { nodeId: prior, resume: next, settle: true } };
      }
      if (action === 'next_sample') {
        if (!state.loop) throw new Error('Next sample requires a loop');
        next = state.loop.exit;
        for (let i = entry.end; i < next; i++) path(entries[i].node.id, 'skipped', 'jumped');
      }
      state.index = next;
      continue;
    }
    path(node.id, 'entered');
    if (node.kind === 'group') {
      state.index++;
      continue;
    }
    if (node.kind === 'loop_samples') {
      const assignment = state.assignments.find((a) => a.loop_id === node.id);
      const designed = !!assignment?.design_id;
      const incomplete = designed && assignment?.design_algorithm === 'incomplete';
      const assignedIds = assignment?.samples.map((s) => s.sample_id) ?? [];
      if (
        !assignment?.samples.length ||
        new Set(assignedIds).size !== assignedIds.length ||
        assignedIds.some((id) => !node.data.sample_ids.includes(id)) ||
        assignment.samples.some(
          (s, i) => s.position !== i + 1 || !Array.isArray(s.ingredient_tags),
        ) ||
        (designed &&
          (assignment.generator_version !== 'orders-sha256-v1' ||
            !['fixed', 'shuffle', 'latin', 'williams', 'incomplete'].includes(
              assignment.design_algorithm ?? '',
            ) ||
            assignment.design_block !== (incomplete ? 'incomplete' : 'complete'))) ||
        (incomplete
          ? !Number.isInteger(assignment.design_block_size) ||
            assignedIds.length !== assignment.design_block_size ||
            assignedIds.length < 2 ||
            assignedIds.length >= node.data.sample_ids.length
          : assignedIds.length !== node.data.sample_ids.length) ||
        ((!designed || assignment.design_algorithm === 'fixed') &&
          assignedIds.some((id, i) => id !== node.data.sample_ids[i]))
      )
        throw new Error(
          'Loop requires valid frozen sample assignments and supported design metadata',
        );
      state.loop = {
        id: node.id,
        start: state.index + 1,
        exit: entry.end,
        position: 0,
        variables: { ...state.variables },
        answers: { ...state.answers },
        visited: [...state.visited],
      };
      state.index++;
      sampleScope();
      continue;
    }
    if (node.kind === 'serve_gate') {
      state.variables['serving.codes'] =
        node.data.sample_binding === 'current'
          ? [String(state.variables['sample.code'])]
          : node.data.study_test_id
            ? (state.variables['serving.plan.' + node.data.study_test_id] ?? [])
            : (state.assignments.find((a) => a.loop_id === node.id)?.samples.map((s) => s.code) ??
              []);
    }
    if (node.kind === 'end') {
      state.outcome = node.data.outcome;
      path(node.id, 'ended');
    }
    return state;
  }
  throw new Error('Flow path has no explicit end');
}
export const reviewable = (answer?: Answer) =>
  !!answer &&
  (answer.state === 'answered' ||
    answer.state === 'code' ||
    (answer.state === 'matrix' &&
      Object.values(answer.answers).some((a) => a.state === 'selected')) ||
    (answer.state === 'method' && Object.values(answer.answers).some((a) => a !== 'skipped')) ||
    (answer.state === 'method_values' &&
      Object.values(answer.answers).some((a) => a.state !== 'skipped')));
export function advance(
  flow: Flow,
  state: State,
  answer: Answer | undefined | Record<string, number | 'skipped'>,
): State {
  if (state.review || state.outcome) return state;
  const node = currentNode(flow, state);
  if (!node) return state;
  const value: Answer | undefined =
    answer === undefined
      ? undefined
      : node.kind === 'embedded_method' &&
          answer.state !== 'method' &&
          answer.state !== 'method_values' &&
          answer.state !== 'temporal'
        ? { state: 'method', answers: answer as Record<string, number | 'skipped'> }
        : (answer as Answer);
  const variables = { ...state.variables },
    key = 'answer.' + node.id;
  if (value?.state === 'answered') variables[key] = value.value;
  if (value?.state === 'matrix')
    Object.entries(value.answers).forEach(([id, a]) => {
      if (a.state === 'selected') variables[key + '.' + id] = a.option_id;
    });
  if (value?.state === 'method')
    Object.entries(value.answers).forEach(([id, a]) => {
      if (a !== 'skipped') variables[key + '.' + id] = a;
    });
  if (value?.state === 'method_values')
    Object.entries(value.answers).forEach(([id, a]) => {
      if ('kind' in a && a.kind === 'jar' && a.state === 'rated')
        variables[key + '.' + id] = a.rating!;
    });
  if (value?.state === 'code') {
    variables[key] = value.normalized_code;
    const normalize = (v: string) =>
      node.kind === 'code_entry' && node.data.normalization === 'trim_upper_ascii'
        ? v.trim().replace(/[a-z]/g, (c) => c.toUpperCase())
        : v.trim();
    variables[key + '.matched'] =
      node.kind === 'code_entry' && node.data.source === 'sample_code'
        ? typeof variables['sample.code'] === 'string' &&
          value.normalized_code === normalize(variables['sample.code'] as string)
        : Array.isArray(variables['context.returning_code_hashes']) &&
          (variables['context.returning_code_hashes'] as Scalar[]).includes(value.code_hash);
  }
  if (
    node.id === flow.restriction_source_id &&
    node.kind === 'question' &&
    value?.state === 'answered' &&
    Array.isArray(value.value)
  )
    variables['assessor.restrictions'] = value.value.filter(
      (id) => !node.data.options?.find((o) => o.id === id)?.exclusive,
    );
  return settle(flow, {
    ...state,
    index: state.index + 1,
    answers: value ? { ...state.answers, [node.id]: value } : state.answers,
    variables,
    occurrenceAnswers: value
      ? { ...state.occurrenceAnswers, [answerKey(state, node.id)]: value }
      : state.occurrenceAnswers,
    visited: [...state.visited, node.id],
    path: [
      ...state.path,
      {
        nodeId: node.id,
        kind: 'submitted',
        ...pathDiagnostics(flow, variables, node.id, 'submitted'),
        occurrenceId: occurrenceId(state),
        sampleId: state.loop
          ? state.assignments.find((a) => a.loop_id === state.loop!.id)!.samples[
              state.loop.position
            ].sample_id
          : null,
      },
    ],
  });
}
export function returnFromReview(flow: Flow, state: State): State {
  if (!state.review) return state;
  const { review, ...rest } = state;
  const next: State = {
    ...rest,
    index: review.resume,
    path: [
      ...rest.path,
      {
        nodeId: review.nodeId,
        kind: 'reviewed',
        ...pathDiagnostics(flow, state.variables, review.nodeId, 'reviewed'),
        occurrenceId: occurrenceId(state),
        sampleId: state.loop
          ? state.assignments.find((a) => a.loop_id === state.loop!.id)!.samples[
              state.loop.position
            ].sample_id
          : null,
      },
    ],
  };
  return review.settle ? settle(flow, next) : next;
}
export function currentNode(flow: Flow, state: State) {
  return (
    outline(flow.nodes).find((e) => e.node.id === state.review?.nodeId)?.node ??
    outline(flow.nodes)[state.index]?.node
  );
}
function pathDiagnostics(
  flow: Flow,
  variables: Record<string, Value>,
  nodeId: string,
  kind: PathEntry['kind'],
  reason?: PathEntry['reason'],
) {
  const node = outline(flow.nodes).find((entry) => entry.node.id === nodeId)?.node;
  const tested = kind === 'entered' || reason === 'guard_false' || reason === 'restriction';
  const failed = tested && kind === 'skipped';
  return {
    variables: Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
    guardResult: tested ? (node?.guard ? evaluate(node.guard, variables) : true) : undefined,
    action: failed ? (node?.otherwise?.action ?? 'continue') : undefined,
    targetId:
      failed && node?.otherwise && 'target_id' in node.otherwise
        ? node.otherwise.target_id
        : undefined,
  };
}
export { flowIssues, flowIssues as linearIssues } from './validation';
