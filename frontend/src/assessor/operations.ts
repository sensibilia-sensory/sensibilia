import { Client } from '../researcher/client';
import type { components } from '../api-schema';
import { currentNode, occurrenceId, type Flow } from '../shared/flow';
import { readSession, updateSession, type LocalSession } from './storage';
export async function prepareGate(id: string) {
  return updateSession(id, (old) => {
    if (!old) throw new Error('Session missing');
    const node = currentNode(old.package.flow as Flow, old.state);
    if (node?.kind !== 'serve_gate') return old;
    const occurrence = occurrenceId(old.state),
      key = old.package.serving_assignment!.id + ':' + occurrence + ':' + node.id;
    const serving = old.serving ?? {
      pending: [],
      acknowledged: [],
      suppressed: [],
      signals: [],
      waits: {},
    };
    if (serving.waits[key]) return old;
    const assignment = old.package.serving_assignment;
    if (!assignment) throw new Error('Ask staff to assign this assessment to a booth.');
    const sample = old.state.loop
      ? old.state.assignments.find((a) => a.loop_id === old.state.loop!.id)!.samples[
          old.state.loop.position
        ].sample_id
      : null;
    return {
      ...old,
      serving: {
        ...serving,
        waits: { ...serving.waits, [key]: new Date().toISOString() },
        pending: [
          ...serving.pending,
          {
            client_event_id: crypto.randomUUID(),
            assignment_id: assignment.id,
            step_id: node.id,
            occurrence_id: occurrence,
            sample_id: sample,
            expected_revision: 0,
            action: 'ready',
            actor: old.package.session.assessor_code,
            recorded_at: new Date().toISOString(),
            codes: [],
            reason: '',
            elapsed_ms: 0,
            clock_quality: 'monotonic',
            offline: false,
          },
        ],
      },
    };
  });
}
/** Queue a help request for the current serving gate; it syncs like any other serving command. */
export async function requestHelp(id: string) {
  return updateSession(id, (old) => {
    if (!old?.serving || !old.package.serving_assignment) throw new Error('No booth assigned');
    const node = currentNode(old.package.flow as Flow, old.state);
    if (node?.kind !== 'serve_gate') return old;
    const occurrence = occurrenceId(old.state);
    const sample = old.state.loop
      ? old.state.assignments.find((a) => a.loop_id === old.state.loop!.id)!.samples[
          old.state.loop.position
        ].sample_id
      : null;
    return {
      ...old,
      serving: {
        ...old.serving,
        pending: [
          ...old.serving.pending,
          {
            client_event_id: crypto.randomUUID(),
            assignment_id: old.package.serving_assignment.id,
            step_id: node.id,
            occurrence_id: occurrence,
            sample_id: sample,
            expected_revision: 0,
            action: 'help',
            actor: old.package.session.assessor_code,
            recorded_at: new Date().toISOString(),
            codes: [],
            reason: 'Assessor does not have the samples',
            elapsed_ms: 0,
            clock_quality: 'monotonic',
            offline: false,
          },
        ],
      },
    };
  });
}
export async function syncOperations(id: string, onUpdate: (s: LocalSession) => void) {
  return navigator.locks.request('sensibilia-operations:' + id, async () => {
    let local = await readSession(id);
    if (!local) throw new Error('Session missing');
    const client = new Client('', local.token);
    for (const command of local.serving?.pending ?? []) {
      const result = await client.request<components['schemas']['OperationAck']>(
        '/sessions/' + id + '/operations',
        { method: 'POST', body: JSON.stringify(command) },
        'session',
      );
      if (result.client_event_id !== command.client_event_id)
        throw new Error('Serving acknowledgement does not match its UUID.');
      local = await updateSession(id, (latest) => {
        if (!latest?.serving) throw new Error('Serving queue missing');
        return {
          ...latest,
          serving: {
            ...latest.serving,
            pending: latest.serving.pending.filter(
              (c) => c.client_event_id !== command.client_event_id,
            ),
            acknowledged: [...latest.serving.acknowledged, result],
          },
        };
      });
      onUpdate(local);
    }
    const view = await client.request<components['schemas']['TabletOperations']>(
      '/sessions/' + id + '/operations',
      {},
      'session',
    );
    if (
      local.package.serving_assignment &&
      view.assignment?.id !== local.package.serving_assignment.id
    )
      throw new Error(
        'Booth assignment changed. Ask staff to review this tablet; queues are retained.',
      );
    if (local.serving) {
      local = await updateSession(id, (latest) => {
        if (!latest?.serving) throw new Error('Serving state missing');
        return { ...latest, serving: { ...latest.serving, signals: view.signals } };
      });
      onUpdate(local);
    }
    return local;
  });
}
export async function heartbeat(local: LocalSession) {
  await new Client('', local.token).request(
    '/sessions/' + local.id + '/presence',
    { method: 'POST' },
    'session',
  );
}
