import {
  outline,
  legalTargets,
  variablesFor,
  type Flow,
  type Test,
  type Condition,
  type Variable,
} from './index';
import { textIssues } from './text';
export function flowIssues(flow: Flow, tests: Test[] = []): string[] {
  const out: string[] = [],
    entries = outline(flow.nodes),
    catalog = variablesFor(flow, tests);
  if (!entries.length) return ['Add a method and end node.'];
  out.push(...textIssues(flow, tests));
  const positions = new Map(entries.map((e, i) => [e.node.id, i]));
  const loops = new Set(
    entries.filter((e) => e.node.kind === 'loop_samples').map((e) => e.node.id),
  );
  const scope = new Map(entries.map((e) => [e.node.id, e.ancestors.find((a) => loops.has(a))]));
  const servingGates = new Map<string | undefined, string[]>();
  for (const { node } of entries)
    if (node.kind === 'serve_gate') {
      const loop = scope.get(node.id);
      servingGates.set(loop, [...(servingGates.get(loop) ?? []), node.id]);
    }
  for (const [loop, gates] of servingGates)
    if (loop && gates.length > 1)
      out.push('Use separate sample loops for repeated serving rounds.');
  const incoming = new Map<number, { defined: Set<string>; review: boolean }[]>([
    [
      0,
      [
        {
          defined: new Set(
            catalog
              .filter(
                (v) =>
                  !v.source &&
                  v.required &&
                  !v.key.startsWith('sample.') &&
                  !v.key.startsWith('derived.'),
              )
              .map((v) => v.key),
          ),
          review: false,
        },
      ],
    ],
  ]);
  const type = (value: unknown) =>
    Array.isArray(value) && value.every((v) => typeof v === 'string')
      ? 'set'
      : typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : typeof value === 'string'
            ? 'string'
            : 'invalid';
  entries.forEach((entry, i) => {
    const node = entry.node,
      label = entry.number + ' ' + (node.title[flow.default_language] ?? '');
    const error = (s: string) => out.push(label + ': ' + s);
    if (!node.title[flow.default_language]?.trim()) error('Title needs reviewed text.');
    const loopId = scope.get(node.id);
    if (
      !loopId &&
      ((node.kind === 'code_entry' && node.data.source === 'sample_code') ||
        node.otherwise?.action === 'next_sample')
    )
      error('Sample code/next sample requires a containing loop.');
    if (
      node.kind === 'loop_samples' &&
      (!node.data.sample_ids.length || !node.data.children.length)
    )
      error('Loop needs samples and children.');
    if (node.kind === 'embedded_method' && (node.data.sample_binding === 'current') !== !!loopId)
      error('Current sample binding is required only within loops.');
    if (node.kind === 'serve_gate' && (node.data.sample_binding === 'current') !== !!loopId)
      error('Current serving requires a loop; set serving must be outside loops.');
    if (
      node.kind === 'serve_gate' &&
      node.data.sample_binding === 'set' &&
      flow.restriction_source_id
    )
      error(
        'Restriction-aware set serving awaits the set-method capability; use guarded sample loops.',
      );
    if (node.kind === 'serve_gate' && loopId && flow.restriction_source_id) {
      const safe = (condition: Condition | null | undefined): boolean =>
        !condition
          ? false
          : 'all' in condition
            ? condition.all.some(safe)
            : 'any' in condition
              ? condition.any.every(safe)
              : condition.variable === 'derived.sample_conflicts_restriction' &&
                condition.operator === 'eq' &&
                'value' in condition &&
                condition.value === false;
      if (
        ![node, ...entry.ancestors.map((id) => entries.find((e) => e.node.id === id)!.node)].some(
          (n) => safe(n.guard) && n.otherwise?.action === 'next_sample',
        )
      )
        error('Guard serving against declared sample restrictions, with Next sample.');
    }
    if (node.kind === 'end' && loopId) error('Terminal nodes must be outside loops.');
    if (
      node.kind === 'info' &&
      new Set(node.data.asset_ids ?? []).size !== (node.data.asset_ids ?? []).length
    )
      error('Info image references must be unique.');
    const texts = node.data as unknown as Record<string, unknown>;
    for (const key of [
      'body',
      'prompt',
      'instructions',
      'continue_label',
      'ack_label',
      'accept_label',
      'decline_label',
    ]) {
      const text = texts[key] as Record<string, string> | undefined;
      if (text && !text[flow.default_language]?.trim()) error(key + ' needs reviewed text.');
    }
    if (node.kind === 'group' && !node.data.children.length) error('Group needs children.');
    if (node.kind === 'question') {
      if (node.data.options?.some((o) => !o.label[flow.default_language]?.trim()))
        error('Option labels need text.');
    }
    if (
      node.kind === 'matrix_question' &&
      (node.data.rows.some((r) => !r.prompt[flow.default_language]?.trim()) ||
        node.data.options.some((o) => !o.label[flow.default_language]?.trim()))
    )
      error('Matrix labels need text.');
    const paths = incoming.get(i) ?? [];
    const before = new Set(paths[0]?.defined ?? []);
    for (const path of paths)
      for (const key of before) if (!path.defined.has(key)) before.delete(key);
    for (const key of before) {
      const source = catalog.find((v) => v.key === key)?.source;
      if (
        (key.startsWith('sample.') ||
          key.startsWith('derived.') ||
          (source && scope.get(source))) &&
        (!loopId || (source && scope.get(source) && scope.get(source) !== loopId))
      )
        before.delete(key);
    }
    if (loopId) {
      ['sample.code', 'sample.position', 'sample.ingredient_tags'].forEach((k) => before.add(k));
      if (before.has('assessor.restrictions')) before.add('derived.sample_conflicts_restriction');
    }
    const review =
      paths.length > 0 &&
      paths.every((p) => p.review) &&
      (!loopId ||
        catalog.some(
          (v) => v.source && scope.get(v.source) === loopId && v.required && before.has(v.key),
        ));
    const check = (condition: Condition, available: Set<string>): Set<string> => {
      if ('all' in condition) {
        const current = new Set(available);
        for (const c of condition.all) for (const k of check(c, current)) current.add(k);
        return new Set([...current].filter((k) => !available.has(k)));
      }
      if ('any' in condition) {
        const sets = condition.any.map((c) => check(c, new Set(available)));
        return new Set([...(sets[0] ?? [])].filter((k) => sets.every((s) => s.has(k))));
      }
      const variable = catalog.find((v) => v.key === condition.variable);
      if (!variable) {
        error('Unknown variable ' + condition.variable);
        return new Set();
      }
      if (
        ((variable.key.startsWith('sample.') || variable.key.startsWith('derived.')) && !loopId) ||
        (variable.source && scope.get(variable.source) && scope.get(variable.source) !== loopId)
      )
        error('Sample variables/answers cannot escape their loop.');
      if (variable.key === 'derived.sample_conflicts_restriction' && !flow.restriction_source_id)
        error('Conflict checks require declared restrictions.');
      if (variable.source && (positions.get(variable.source) ?? Infinity) >= i)
        error('Entry guard must read an earlier answer, never its own.');
      if (condition.operator === 'is_defined') return new Set([variable.key]);
      if (!available.has(variable.key))
        error('Variable may be missing/skipped; use is_defined AND: ' + variable.key);
      const op = condition.operator,
        kind = type(condition.value);
      const valid =
        (['eq', 'neq'].includes(op) && kind === variable.type) ||
        (['lt', 'lte', 'gt', 'gte'].includes(op) && kind === variable.type && kind === 'number') ||
        (op === 'contains' && variable.type === 'set' && kind === 'string') ||
        (op === 'intersects' && kind === variable.type && kind === 'set') ||
        (op === 'in' &&
          variable.type !== 'set' &&
          Array.isArray(condition.value) &&
          condition.value.every((v) => type(v) === variable.type));
      if (!valid) error('Operator/literal type is incompatible.');
      return new Set();
    };
    if (node.kind === 'embedded_method') {
      const test = tests.find((t) => t.id === node.data.study_test_id);
      const setMethod =
        test &&
        ['triangle-v1', 'duo-trio-v1', 'two-afc-v1', 'flash-profile-v1', 'napping-v1'].includes(
          test.test_type_id,
        );
      if (!!setMethod !== (node.data.sample_binding === 'set'))
        error('Set methods require set binding; attributes use none/current.');
      if (setMethod && flow.restriction_source_id)
        error(
          'Restriction-aware set tasks require a reviewed exclusion protocol; use a separate eligible assessment.',
        );
      if (
        test &&
        !setMethod &&
        'sample_ids' in test.configuration &&
        test.configuration.sample_ids?.length
      ) {
        const loop = entries.find((e) => e.node.id === loopId)?.node;
        if (
          loop?.kind !== 'loop_samples' ||
          loop.data.sample_ids.some(
            (id) =>
              !('sample_ids' in test.configuration && test.configuration.sample_ids?.includes(id)),
          )
        )
          error('Configured attribute samples must cover the containing sample loop.');
      }
    }
    if (node.kind === 'embedded_method' && paths.length) {
      const gates =
        node.data.sample_binding === 'set'
          ? entries
              .filter(
                (e) =>
                  e.node.kind === 'serve_gate' &&
                  e.node.data.study_test_id === node.data.study_test_id,
              )
              .map((e) => e.node.id)
          : (servingGates.get(loopId) ?? []);
      if (
        node.data.sample_binding === 'set' &&
        !gates.length &&
        entries.some(
          (e) =>
            e.node.kind === 'serve_gate' &&
            e.node.data.sample_binding === 'set' &&
            !e.node.data.study_test_id,
        )
      )
        error('Set tasks with gates must explicitly use their frozen method plan.');
      if (gates.length && !gates.some((id) => before.has('served:' + id)))
        error('Place serving before tasting on every permitted path.');
    }
    const proof = node.guard ? check(node.guard, before) : new Set<string>();
    const action = node.otherwise;
    let target =
      node.otherwise?.action === 'next_sample' && loopId
        ? entries.find((e) => e.node.id === loopId)!.end
        : entry.end;
    if (action && 'target_id' in action) {
      target = positions.get(action.target_id) ?? entries.length;
      if (action.action === 'skip_to' && scope.get(action.target_id) !== loopId)
        error('Skip to cannot cross a sample loop boundary.');
      if (!legalTargets(flow, node.id).some((e) => e.node.id === action.target_id))
        error('Target must be a later sibling or ancestor-sibling.');
      if (
        action.action === 'end_study' &&
        (entries[target]?.node.kind !== 'end' ||
          (entries[target].node as Extract<Flow['nodes'][number], { kind: 'end' }>).data.outcome !==
            'screened_out' ||
          !!entries[target].node.guard)
      )
        error('End study needs an unguarded screened-out end.');
    }
    if (action?.action === 'previous_question' && !review)
      error('Previous question needs a guaranteed earlier answered question.');
    const definedHere = catalog.filter((v) => v.source === node.id && v.required);
    const after = new Set([...before, ...proof, ...definedHere.map((v) => v.key)]);
    if (node.kind === 'serve_gate') after.add('served:' + node.id);
    const afterReview = review || definedHere.some((v) => v.key.startsWith('answer.'));
    if (paths.length) {
      if (node.kind !== 'end') {
        if (i + 1 >= entries.length) error('Every path needs an explicit end.');
        else
          incoming.set(i + 1, [
            ...(incoming.get(i + 1) ?? []),
            { defined: after, review: afterReview },
          ]);
      }
      if (node.guard) {
        if (target > i && target < entries.length)
          incoming.set(target, [...(incoming.get(target) ?? []), { defined: before, review }]);
        else error('Guard-false path needs an explicit end.');
      }
    }
  });
  if (flow.restriction_source_id) {
    const source = entries.find((e) => e.node.id === flow.restriction_source_id)?.node;
    if (
      source?.kind !== 'question' ||
      source.data.answer_type !== 'multiple' ||
      !source.data.required ||
      source.data.allow_skip ||
      source.data.options?.filter((o) => o.exclusive).length !== 1
    )
      out.push(
        'Restrictions need a required multiple question, no skips, and one exclusive none option.',
      );
  }
  if (loops.size && flow.restriction_source_id) {
    const source = entries.find((e) => e.node.id === flow.restriction_source_id)?.node;
    if (source?.kind === 'question') {
      const ids = source.data.options?.filter((o) => !o.exclusive).map((o) => o.id) ?? [];
      const mapping = flow.restriction_tag_map ?? {};
      if (
        Object.keys(mapping).length !== ids.length ||
        ids.some((id) => !mapping[id]?.length || mapping[id].some((tag) => !tag.trim()))
      )
        out.push('Map every restriction option to explicit ingredient tags.');
      if (scope.get(source.id)) out.push('Restrictions must be declared before the sample loop.');
    }
  }
  return [...new Set(out)];
}
export const operatorsFor = (variable?: Variable) =>
  variable?.type === 'number'
    ? ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is_defined']
    : variable?.type === 'set'
      ? ['eq', 'neq', 'contains', 'intersects', 'is_defined']
      : ['eq', 'neq', 'in', 'is_defined'];
