import type { TemporalDraft } from '../shared/methods/temporal';
import { STORAGE_TIMEOUT_MS, withTimeout } from '../shared/timeout';
import { Client } from '../researcher/client';
import type { components } from '../api-schema';
import {
  type State,
  type Flow,
  type Answer,
  type PathEntry,
  type Value,
  advance,
  occurrenceId,
  currentNode,
  returnFromReview,
  initialState,
} from '../shared/flow';
export type Package = components['schemas']['PackageRead'];
type MethodEvent = components['schemas']['EventCreate'];
type TemporalEvent = components['schemas']['TemporalCreate'];
type FormEvent = components['schemas']['FormEventCreate'];
type PathEvent = components['schemas']['PathEventCreate'];
export type Operation =
  | {
      id: string;
      endpoint: 'responses' | 'form-events' | 'path-events' | 'temporal-runs';
      events: (MethodEvent | FormEvent | PathEvent | TemporalEvent)[];
    }
  | { id: string; endpoint: 'complete'; events: [] };
export interface LocalSession {
  id: string;
  token: string;
  temporalDrafts?: Record<string, TemporalDraft>;
  package: Package;
  state: State;
  outbox: Operation[];
  acknowledged: Operation[];
  finished: boolean;
  serving?: {
    pending: components['schemas']['SignalCommand'][];
    acknowledged: components['schemas']['OperationAck'][];
    suppressed: components['schemas']['SignalCommand'][];
    signals: components['schemas']['SignalRead'][];
    waits: Record<string, string>;
    assignment_history?: components['schemas']['ServingAssignmentRead'][];
  };
  storageVersion: 1;
  shellVersion: 1;
}
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= withTimeout(
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sensibilia-assessor', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Tablet storage is in use by another window. Close it and retry.'));
    }),
    STORAGE_TIMEOUT_MS,
    'Tablet storage did not respond. Saved answers are retained; restart the browser and retry.',
  ).catch((error) => {
    // Allow a later retry to open storage again instead of reusing the failure.
    connection = undefined;
    throw error;
  }));
}
export async function readSession(id: string): Promise<LocalSession | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('sessions').objectStore('sessions').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readSessions(): Promise<LocalSession[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('sessions').objectStore('sessions').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function updateSession(
  id: string,
  change: (old: LocalSession | undefined) => LocalSession,
): Promise<LocalSession> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite', { durability: 'strict' }),
      store = tx.objectStore('sessions');
    let result: LocalSession;
    const get = store.get(id);
    get.onsuccess = () => {
      try {
        result = change(get.result);
        store.put(result);
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Local save failed.'));
  });
}
const operation = (endpoint: Operation['endpoint'], events: Operation['events']): Operation =>
  ({ id: crypto.randomUUID(), endpoint, events }) as Operation;
function paths(
  entries: PathEntry[],
  start: number,
  ids: string[] = [],
  recorded_at = new Date().toISOString(),
): Operation[] {
  const events: PathEvent[] = entries.map((p, i) => ({
    client_event_id: crypto.randomUUID(),
    seq: start + i + 1,
    step_id: p.nodeId,
    occurrence_id: p.occurrenceId ?? 'study',
    sample_id: p.sampleId ?? null,
    kind: p.kind,
    reason: p.reason ?? null,
    target_id: p.targetId ?? null,
    answer_event_ids: p.kind === 'submitted' ? ids : [],
    recorded_at,
  }));
  const batches: Operation[] = [];
  for (let offset = 0; offset < events.length; offset += 500)
    batches.push(operation('path-events', events.slice(offset, offset + 500)));
  return batches;
}
export async function savePackage(id: string, token: string, pkg: Package) {
  const flow = pkg.flow as Flow;
  const context = Object.fromEntries(
    Object.entries(pkg.context ?? {})
      .filter(([, v]) => v !== null)
      .map(([k, v]) => ['context.' + k, v]),
  );
  const state = initialState(
    flow,
    context as Record<string, Value>,
    pkg.loop_assignments ?? [],
    pkg.assignments ?? [],
  );
  return updateSession(id, (old) => {
    if (old) throw new Error('This session is already cached. Resume it.');
    return {
      id,
      token,
      package: pkg,
      state,
      outbox: paths(state.path, 0),
      acknowledged: [],
      finished: false,
      storageVersion: 1,
      shellVersion: 1,
    };
  });
}
export function nextSubmission(local: LocalSession, answer: Answer | undefined): LocalSession {
  const flow = local.package.flow as Flow,
    node = currentNode(flow, local.state);
  if (!node) throw new Error('No current node');
  const recorded_at = new Date().toISOString(),
    occurrence_id = occurrenceId(local.state);
  const sample_id = local.state.loop
    ? (local.package.loop_assignments ?? []).find((a) => a.loop_id === local.state.loop!.id)!
        .samples[local.state.loop.position].sample_id
    : null;
  const outbox = [...local.outbox];
  let ids: string[] = [];
  if (!local.state.review) {
    if (node.kind === 'embedded_method' && answer?.state === 'temporal') {
      if (answer.value.state === 'running' || !answer.ready)
        throw new Error('Finish or retain the interrupted trace first.');
      const saved = local.temporalDrafts?.[occurrence_id + ':' + node.id];
      if (!saved || JSON.stringify(saved) !== JSON.stringify(answer.value))
        throw new Error('Temporal answer must equal its durable tablet trace.');
      const { client_event_id, ...value } = answer.value;
      const event: TemporalEvent = {
        client_event_id,
        study_test_id: node.data.study_test_id,
        step_id: node.id,
        occurrence_id,
        sample_id,
        value: { ...value, state: answer.value.state },
        recorded_at,
      };
      ids = [client_event_id];
      outbox.push(operation('temporal-runs', [event]));
    } else if (node.kind === 'embedded_method') {
      const answers =
        answer?.state === 'method' || answer?.state === 'method_values' ? answer.answers : {};
      const events: MethodEvent[] = Object.entries(answers).map(([question_id, a]) => ({
        client_event_id: crypto.randomUUID(),
        study_test_id: node.data.study_test_id,
        step_id: node.id,
        occurrence_id,
        sample_id,
        question_id,
        value:
          typeof a === 'object'
            ? a
            : a === 'skipped'
              ? { state: 'skipped', rating: null }
              : { state: 'rated', rating: a },
        recorded_at,
      }));
      ids = events.map((e) => e.client_event_id).sort();
      if (events.length) outbox.push(operation('responses', events));
    } else {
      if (
        answer?.state === 'method' ||
        answer?.state === 'method_values' ||
        answer?.state === 'temporal'
      )
        throw new Error('Ordinary node cannot receive method answers');
      const event: FormEvent = {
        client_event_id: crypto.randomUUID(),
        step_id: node.id,
        occurrence_id,
        sample_id,
        value:
          node.kind === 'info'
            ? { state: 'continued', acknowledged: true }
            : (answer ?? { state: 'missing' }),
        recorded_at,
      };
      ids = [event.client_event_id];
      outbox.push(operation('form-events', [event]));
    }
  }
  const state = local.state.review
    ? returnFromReview(flow, local.state)
    : advance(
        flow,
        local.state,
        node.kind === 'info' ? { state: 'continued', acknowledged: true } : answer,
      );
  const added = state.path.slice(local.state.path.length);
  if (added.length) outbox.push(...paths(added, local.state.path.length, ids, recorded_at));
  let serving = local.serving;
  // Queue the delivery so staff stop seeing a request for this gate: "received" when the
  // assessor's confirmation is the delivery, "manual" for a staff-verified fallback. It syncs
  // like any serving command and never blocks the answer itself.
  if (node.kind === 'serve_gate' && answer?.state === 'delivery') {
    const assignment = local.package.serving_assignment;
    if (assignment) {
      const key = assignment.id + ':' + occurrence_id + ':' + node.id;
      const signal = serving?.signals.find(
        (s) =>
          s.assignment_id === assignment.id &&
          s.step_id === node.id &&
          s.occurrence_id === occurrence_id,
      );
      const pending = serving?.pending ?? [];
      const obsolete = pending.filter(
        (p) => p.step_id === node.id && p.occurrence_id === occurrence_id && p.action === 'ready',
      );
      serving = {
        pending: [
          ...pending.filter((p) => !obsolete.includes(p)),
          {
            client_event_id: crypto.randomUUID(),
            assignment_id: assignment.id,
            step_id: node.id,
            occurrence_id,
            sample_id,
            expected_revision: signal?.revision ?? 0,
            action: answer.mode === 'manual' ? 'manual' : 'received',
            actor: local.package.session.assessor_code,
            codes: answer.codes,
            reason: answer.reason,
            elapsed_ms: answer.elapsed_ms,
            clock_quality: answer.clock_quality,
            offline: answer.offline,
            recorded_at,
          },
        ],
        acknowledged: serving?.acknowledged ?? [],
        suppressed: [...(serving?.suppressed ?? []), ...obsolete],
        signals: serving?.signals ?? [],
        waits: serving?.waits ?? { [key]: recorded_at },
      };
    }
  }
  return { ...local, state, outbox, serving };
}
export async function submitLocal(
  id: string,
  answer: Answer | undefined,
  expectedPathLength: number,
) {
  return updateSession(id, (old) => {
    if (!old) throw new Error('Session missing');
    if (old.state.path.length !== expectedPathLength)
      throw new Error('This session advanced in another tab. Reload to resume its saved task.');
    return nextSubmission(old, answer);
  });
}
export async function queueCompletion(id: string) {
  return updateSession(id, (old) => {
    if (!old?.state.outcome) throw new Error('Finish the assigned flow first');
    return old.finished || old.outbox.some((o) => o.endpoint === 'complete')
      ? old
      : { ...old, outbox: [...old.outbox, operation('complete', [])] };
  });
}
export async function synchronise(id: string, onUpdate: (s: LocalSession) => void) {
  return navigator.locks.request('sensibilia-sync:' + id, async () => {
    let local = await readSession(id);
    if (!local) throw new Error('No local session');
    while (local.outbox.length) {
      const op = local.outbox[0];
      const client = new Client('', local.token);
      if (op.endpoint === 'complete') {
        const closed = await client.request<components['schemas']['SessionRead']>(
          '/sessions/' + id + '/complete',
          { method: 'POST' },
          'session',
        );
        if (closed.id !== id || closed.status !== local.state.outcome)
          throw new Error('Completion acknowledgement does not match the assigned session.');
      } else {
        const ack = await client.request<
          | components['schemas']['BatchAcknowledgement']
          | components['schemas']['PathBatchAcknowledgement']
        >(
          '/sessions/' + id + '/' + op.endpoint,
          { method: 'POST', body: JSON.stringify({ events: op.events }) },
          'session',
        );
        if (
          ack.events.length !== op.events.length ||
          op.events.some(
            (e) =>
              !ack.events.some(
                (a) =>
                  a.client_event_id === e.client_event_id &&
                  ['accepted', 'duplicate'].includes(a.status),
              ),
          )
        )
          throw new Error('Incomplete acknowledgement; events retained.');
      }
      local = await updateSession(id, (latest) => {
        if (!latest) throw new Error('Local session missing');
        return {
          ...latest,
          outbox: latest.outbox.filter((o) => o.id !== op.id),
          acknowledged: [...latest.acknowledged, op],
          finished: latest.finished || op.endpoint === 'complete',
        };
      });
      onUpdate(local);
    }
    return local;
  });
}

/** Same session transaction and occurrence precondition as ordinary submission. */
export async function saveTemporalDraft(
  id: string,
  draft: TemporalDraft,
  expectedPathLength: number,
) {
  return updateSession(id, (old) => {
    if (!old || old.state.path.length !== expectedPathLength || old.state.review)
      throw new Error('Temporal task advanced in another tab. Reload.');
    const node = currentNode(old.package.flow as Flow, old.state);
    if (
      node?.kind !== 'embedded_method' ||
      old.package.tests.find((t) => t.id === node.data.study_test_id)?.test_type_id !== 'tcata-v1'
    )
      throw new Error('No assigned temporal task.');
    const key = occurrenceId(old.state) + ':' + node.id,
      previous = old.temporalDrafts?.[key];
    if (
      previous &&
      (previous.client_event_id !== draft.client_event_id ||
        previous.state !== 'running' ||
        draft.transitions.length < previous.transitions.length ||
        JSON.stringify(draft.transitions.slice(0, previous.transitions.length)) !==
          JSON.stringify(previous.transitions))
    )
      throw new Error('Temporal history changed in another tab. Retain trace and reload.');
    return { ...old, temporalDrafts: { ...old.temporalDrafts, [key]: draft } };
  });
}
