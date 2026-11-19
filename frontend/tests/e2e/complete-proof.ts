import { expect, type APIRequestContext } from '@playwright/test';
import type { components } from '../../src/api-schema';
import type { LocalSession } from '../../src/assessor/storage';
import { initialState, type Flow, type Test, type Value } from '../../src/shared/flow';
import { runScenario, scenarioSteps, type Scenario } from './scenario';

type DataRow = components['schemas']['DataRowRead'];
const instant = (value: string) => new Date(value).toISOString();

/** Reconcile the real ledgers with locally committed operations, without another evaluator. */
export async function proveCollection(
  request: APIRequestContext,
  headers: Record<string, string>,
  local: LocalSession,
) {
  const pkg = local.package;
  const base = '/studies/' + pkg.study_version.study_id;
  const scope = '?study_version_id=' + pkg.study_version.id + '&limit=1000';
  async function read<T>(endpoint: string): Promise<T> {
    const response = await request.get(base + '/' + endpoint + scope, { headers });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  }
  const [observations, form, paths, data] = await Promise.all([
    read<components['schemas']['ObservationRead'][]>('responses'),
    read<components['schemas']['FormEventRead'][]>('form-responses'),
    read<components['schemas']['PathEventRead'][]>('path-events'),
    read<DataRow[]>('data'),
  ]);
  const temporal = data
    .filter((r) => r.session_id === local.id && r.row_kind === 'temporal_run')
    .map((r) => ({
      ...r,
      sample_id: JSON.parse(r.sample_id_json) as string | null,
      value: JSON.parse(r.value_json),
      supersedes_event_id: null,
    }));
  const ledgers = [observations, form, paths, temporal].map((rows) =>
    rows.filter((r) => r.session_id === local.id),
  );
  const endpoints = ['responses', 'form-events', 'path-events', 'temporal-runs'] as const;
  const expected = endpoints.map((endpoint) =>
    local.acknowledged.flatMap((op) => (op.endpoint === endpoint ? op.events : [])),
  );
  for (const [index, rows] of ledgers.entries()) {
    expect(rows).toHaveLength(expected[index].length);
    expect(new Set(rows.map((r) => r.client_event_id)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.client_event_id))).toEqual(
      new Set(expected[index].map((e) => e.client_event_id)),
    );
    for (const event of expected[index]) {
      const row = rows.find((r) => r.client_event_id === event.client_event_id)!;
      expect(row.study_version_id).toBe(pkg.study_version.id);
      expect(row.version_number).toBe(pkg.study_version.version_number);
      expect(row.assessor_code).toBe(pkg.session.assessor_code);
      expect(row.step_id).toBe(event.step_id);
      expect(row.occurrence_id).toBe(event.occurrence_id);
      expect(row.sample_id).toBe(event.sample_id ?? null);
      expect(instant(row.recorded_at!)).toBe(instant(event.recorded_at));
      expect(Number.isFinite(Date.parse(row.received_at!))).toBe(true);
      if ('value' in event) {
        if ('value' in row && !('transitions' in event.value))
          expect(row.value).toEqual(event.value);
        else if ('value' in row) {
          const normalize = (v: unknown): unknown =>
            Array.isArray(v)
              ? v.map(normalize)
              : v && typeof v === 'object'
                ? Object.fromEntries(
                    Object.entries(v).map(([k, x]) => [
                      k,
                      k.endsWith('_at') && typeof x === 'string' ? instant(x) : normalize(x),
                    ]),
                  )
                : v;
          expect(normalize(row.value)).toEqual(normalize(event.value));
        }
        expect('supersedes_event_id' in row && row.supersedes_event_id).toBeNull();
      }
      if ('study_test_id' in event) {
        expect('study_test_id' in row && row.study_test_id).toBe(event.study_test_id);
        if ('question_id' in event)
          expect('question_id' in row && row.question_id).toBe(event.question_id);
        expect('is_current' in row && row.is_current).toBe(true);
      }
      if ('seq' in event) {
        expect('seq' in row && row.seq).toBe(event.seq);
        expect('kind' in row && row.kind).toBe(event.kind);
        expect('reason' in row && row.reason).toBe(event.reason);
        expect('target_id' in row && row.target_id).toBe(event.target_id);
        expect('answer_event_ids' in row && row.answer_event_ids).toEqual(event.answer_event_ids);
      }
    }
  }
  const serverPaths = paths.filter((r) => r.session_id === local.id);
  expect(serverPaths.map((p) => p.seq)).toEqual(local.state.path.map((_, i) => i + 1));
  expect(
    serverPaths.map((p) => ({
      nodeId: p.step_id,
      kind: p.kind,
      occurrence: p.occurrence_id,
      sample: p.sample_id,
      reason: p.reason,
      target: p.target_id,
    })),
  ).toEqual(
    local.state.path.map((p) => ({
      nodeId: p.nodeId,
      kind: p.kind,
      occurrence: p.occurrenceId ?? 'study',
      sample: p.sampleId ?? null,
      reason: p.reason ?? null,
      target: p.targetId ?? null,
    })),
  );
  const answerIds = [ledgers[0], ledgers[1], ledgers[3]].flatMap((rows) =>
    rows.map((r) => r.client_event_id),
  );
  const linkedIds = serverPaths.flatMap((p) => p.answer_event_ids);
  expect(linkedIds).toHaveLength(answerIds.length);
  expect(new Set(linkedIds)).toEqual(new Set(answerIds));
  for (const op of local.acknowledged.filter((o) => o.endpoint === 'temporal-runs'))
    for (const e of op.events)
      if ('value' in e && 'transitions' in e.value) {
        const runs = temporal.filter((r) => r.client_event_id === e.client_event_id);
        expect(runs).toHaveLength(1);
        const rows = data.filter(
          (r) =>
            r.session_id === local.id &&
            r.temporal_run_id === runs[0].id &&
            r.row_kind === 'temporal_transition',
        );
        expect(rows).toHaveLength(e.value.transitions.length);
        for (const t of e.value.transitions) {
          const row = rows.find((r) => r.client_event_id === t.client_event_id)!;
          expect(row).toBeDefined();
          expect(row.temporal_seq).toBe(t.seq);
          expect(row.temporal_elapsed_milliseconds).toBe(t.elapsed_ms);
          expect(row.question_id).toBe(t.attribute_id);
          expect(row.state).toBe(t.selected ? 'selected' : 'unselected');
          expect(instant(row.recorded_at!)).toBe(instant(t.recorded_at));
        }
      }
  const allIds = [
    ...ledgers.flatMap((rows) => rows.map((r) => r.client_event_id)),
    ...local.acknowledged.flatMap((op) =>
      op.endpoint === 'temporal-runs'
        ? op.events.flatMap((e) =>
            'value' in e && 'transitions' in e.value
              ? e.value.transitions.map((t) => t.client_event_id)
              : [],
          )
        : [],
    ),
  ];
  expect(new Set(allIds).size).toBe(allIds.length);
  const ledger = data.filter((r) => r.session_id === local.id);
  const collected = ledger.filter((r) => r.row_kind !== 'expected_missing');
  expect(new Set(collected.map((r) => r.client_event_id)).size).toBe(allIds.length);
  expect(new Set(collected.map((r) => r.client_event_id))).toEqual(new Set(allIds));
  for (const row of ledger.filter((r) => r.row_kind === 'expected_missing')) {
    expect(row.state).toBe('missing');
    expect(row.value_json).toBe('null');
    expect(row.client_event_id).toBeNull();
    expect(row.recorded_at).toBeNull();
    expect(row.received_at).toBeNull();
    expect(row.is_current).toBeNull();
  }
  // The same saved package and committed answers replay through Run path's shared module.
  const flow = pkg.flow as Flow;
  const scenario: Scenario = { ...local.state.occurrenceAnswers };
  const slots = scenarioSteps(flow, pkg.loop_assignments ?? []);
  // Execution omits undefined optional answers from its answer map. An actual
  // persisted missing event supplies Run path's existing explicit-omission input.
  for (const row of ledgers[1]) {
    if ('value' in row && row.value.state === 'missing') {
      const slot = slots.find(
        (s) => s.node.id === row.step_id && s.occurrence === row.occurrence_id,
      );
      expect(slot).toBeDefined();
      scenario[slot!.key] = null;
    }
  }
  const context = Object.fromEntries(
    Object.entries(pkg.context ?? {})
      .filter(([, v]) => v !== null)
      .map(([k, v]) => ['context.' + k, v]),
  );
  const rehearsal = runScenario(
    flow,
    initialState(
      flow,
      context as Record<string, Value>,
      pkg.loop_assignments ?? [],
      pkg.assignments ?? [],
    ),
    scenario,
    pkg.tests as Test[],
  );
  expect(rehearsal.error).toBe('');
  expect(rehearsal.state).toEqual(local.state);
  return { observations: ledgers[0], form: ledgers[1], paths: serverPaths, ledger, allIds };
}

/** Compare every projected field, including nulls, timestamps and current/history flags. */
export function proveCsv(csv: Record<string, string>[], ledger: DataRow[]) {
  expect(csv).toHaveLength(ledger.length);
  expect(new Set(csv.map((r) => r.row_id)).size).toBe(csv.length);
  for (const row of ledger) {
    const exported = csv.find((r) => r.row_id === row.row_id)!;
    expect(exported).toBeDefined();
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') {
        expect(exported[key]).not.toBe('');
        expect(Number(exported[key]), row.row_id + ': ' + key).toBe(value);
        continue;
      }
      expect(exported[key], row.row_id + ': ' + key).toBe(
        value == null
          ? ''
          : typeof value === 'boolean'
            ? value
              ? 'True'
              : 'False'
            : String(value),
      );
    }
  }
}
