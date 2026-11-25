import { AssetScope } from '../shared/nodes/AssetScope';
import { readCachedImage } from '../shared/assets';
import type { TemporalDraft } from '../shared/methods/temporal';
import { ServingGate } from '../shared/nodes/ServingGate';
import { prepareGate, requestHelp, syncOperations, heartbeat } from './operations';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StaffButton, StaffPanel } from './StaffCorner';
import { AssessorShell, Button } from '../ui';
import { TabletUpdate } from './TabletUpdate';
import { currentNode, occurrenceId, type State, type Flow, type Answer } from '../shared/flow';
import { displayText } from '../shared/flow/text';
import { NodeAnswerRenderer } from '../shared/nodes/NodeAnswerRenderer';
import { rehearsalAnswerValid } from '../shared/nodes/rehearsal';
import type { components } from '../api-schema';
import { Client } from '../researcher/client';
import { prepareTerminal, readTerminal, type LocalTerminal } from './terminal';
import {
  readSession,
  saveTemporalDraft,
  submitLocal,
  queueCompletion,
  synchronise,
  type LocalSession,
  type Package,
} from './storage';

export function AssessorView({
  pkg,
  state,
  answer,
  busy = false,
  pending = 0,
  finished = false,
  error = '',
  servingStatus,
  servingActor,
  elapsed = 0,
  servingOffline = false,
  clockQuality = 'monotonic',
  onAnswer,
  temporalDraft,
  persistTemporal,
  onNext,
  onCallStaff,
  onSync,
  staffExtra,
  embedded = false,
}: {
  embedded?: boolean;
  pkg: Package;
  staffExtra?: ReactNode;
  temporalDraft?: TemporalDraft;
  persistTemporal?: (draft: TemporalDraft) => Promise<void>;
  state: State;
  answer?: Answer;
  busy?: boolean;
  pending?: number;
  finished?: boolean;
  error?: string;
  servingStatus?: string;
  servingActor?: string;
  elapsed?: number;
  servingOffline?: boolean;
  clockQuality?: 'monotonic' | 'wall_estimate';
  onAnswer: (a: Answer | undefined) => void;
  onNext: (a?: Answer) => void;
  onCallStaff?: () => void;
  onSync: () => void;
}) {
  const flow = pkg.flow as Flow,
    node = currentNode(flow, state),
    language = String(pkg.context?.language ?? flow.default_language);
  const valid = node && rehearsalAnswerValid(node, answer, state.variables, pkg.tests);
  const total = state.loop
    ? pkg.loop_assignments?.find((a) => a.loop_id === state.loop!.id)?.samples.length
    : undefined;
  const [staffOpen, setStaffOpen] = useState(false);
  const position = Number(state.variables['sample.position']);
  const note = 'Save and continue stores your answer on this tablet.';
  // The end screen has no button: the tablet reports completion by itself (see `Assessor`).
  const actions =
    node && node.kind !== 'end' && (node.kind !== 'serve_gate' || state.review) ? (
      <>
        <p className="ui-assessor-note">{note}</p>
        <Button
          variant="primary"
          className="ui-assessor-action"
          disabled={busy || (!state.review && !valid)}
          onClick={() => onNext()}
        >
          {state.review ? 'Return to flow' : 'Save and continue'}
        </Button>
      </>
    ) : undefined;
  return (
    <AssessorShell
      embedded={embedded}
      label={embedded ? undefined : 'Restricted assessor'}
      screenKey={occurrenceId(state) + ':' + node?.id + ':' + !!state.review}
      centre={
        state.loop && (
          <p className="ui-sample-progress">
            <span>
              Sample {String(state.variables['sample.position'])}
              {total ? ' of ' + total : ''}
            </span>
            <span>
              Sample code{' '}
              <strong className="ui-sample-code">{String(state.variables['sample.code'])}</strong>
            </span>
          </p>
        )
      }
      progress={
        state.loop && total && Number.isFinite(position)
          ? { value: position, max: total }
          : undefined
      }
      end={<StaffButton onOpen={() => setStaffOpen(true)} />}
      actions={actions}
    >
      <section className="ui-stack" aria-label="Assigned sensory session">
        {staffOpen && (
          <StaffPanel onClose={() => setStaffOpen(false)}>
            <p>
              Version {pkg.study_version.version_number} · {language} · {pkg.session.assessor_code}
            </p>
            {pkg.serving_assignment && (
              <p>
                {pkg.serving_assignment.room_name} · booth {pkg.serving_assignment.booth_label} ·
                layout {pkg.serving_assignment.room_revision}
              </p>
            )}
            <p role="status">
              {pending ? pending + ' pending operations' : 'Synchronised'}
              {finished ? ' · Session complete' : ''}
            </p>
            <Button disabled={busy || !pending} onClick={onSync}>
              Synchronise saved events
            </Button>
            {staffExtra}
          </StaffPanel>
        )}
        {error && <p role="alert">{error}</p>}
        {node ? (
          <>
            <h1>
              {displayText(node.title[language] ?? '', state.variables, flow.text_version === 1)}
            </h1>
            {node.kind === 'end' ? (
              <p>
                {displayText(
                  node.data.body[language] ?? '',
                  state.variables,
                  flow.text_version === 1,
                )}
              </p>
            ) : (
              <>
                {state.review && <p role="status">Review only · answers are locked</p>}
                {node.kind === 'serve_gate' ? (
                  <ServingGate
                    key={pkg.serving_assignment?.id + ':' + occurrenceId(state) + ':' + node.id}
                    node={node}
                    language={language}
                    variables={state.variables}
                    onChange={onAnswer}
                    onConfirm={(a) => onNext(a)}
                    onCallStaff={onCallStaff}
                    disabled={busy}
                    status={servingStatus ?? 'ready'}
                    actor={servingActor}
                    elapsed={elapsed}
                    offline={servingOffline}
                    clockQuality={clockQuality}
                  />
                ) : (
                  <NodeAnswerRenderer
                    key={occurrenceId(state) + ':' + node.id + ':' + !!state.review}
                    node={node}
                    tests={pkg.tests}
                    assignments={pkg.assignments}
                    flow={flow}
                    language={language}
                    variables={state.variables}
                    answer={state.review ? state.answers[node.id] : answer}
                    temporalDraft={temporalDraft}
                    persistTemporal={persistTemporal}
                    disabled={!!state.review || (busy && temporalDraft?.state !== 'running')}
                    onChange={onAnswer}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <p>No assigned task.</p>
        )}
      </section>
    </AssessorShell>
  );
}
export function Assessor({ id }: { id: string }) {
  const [local, setLocal] = useState<LocalSession>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [answer, setAnswer] = useState<Answer>(),
    [now, setNow] = useState({ mono: performance.now(), wall: Date.now() }),
    [gateClock, setGateClock] = useState<{
      key: string;
      initial: number;
      mono: number;
      restored: boolean;
    }>(),
    [servingError, setServingError] = useState('');
  const lastHeartbeat = useRef(0);
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const stored = await readSession(id);
      if (stored) {
        if (stored.storageVersion !== 1 || stored.shellVersion !== 1)
          throw new Error(
            'Unsupported local session format; retain this tablet and contact the operator.',
          );
        setLocal(stored);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local read failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [id]);
  const sync = async () => {
    setBusy(true);
    setError('');
    try {
      await synchronise(id, setLocal);
      if (local?.package.serving_assignment) {
        try {
          await syncOperations(id, setLocal);
          setServingError('');
        } catch (e) {
          setServingError(e instanceof Error ? e.message : 'Serving audit retained for retry');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync interrupted; saved events retained.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const online = () => void sync();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [id]);
  const flow = local?.package.flow as Flow | undefined;
  const node = flow && local ? currentNode(flow, local.state) : undefined;
  const gateKey =
    local && node?.kind === 'serve_gate'
      ? local.package.serving_assignment?.id + ':' + occurrenceId(local.state) + ':' + node.id
      : '';
  useEffect(() => {
    if (!gateKey) return;
    const restored = !!local?.serving?.waits[gateKey];
    void prepareGate(id)
      .then((saved) => {
        setLocal(saved);
        setGateClock({
          key: gateKey,
          initial: Math.max(0, Date.now() - Date.parse(saved.serving!.waits[gateKey])),
          mono: performance.now(),
          restored,
        });
      })
      .catch((e) => setServingError(String(e)));
  }, [id, gateKey]);
  useEffect(() => {
    const tick = async () => {
      setNow({ mono: performance.now(), wall: Date.now() });
      if (document.visibilityState !== 'visible') return;
      const current = await readSession(id);
      if (!current?.package.serving_assignment) return;
      try {
        if (Date.now() - lastHeartbeat.current >= 15000) {
          await heartbeat(current);
          lastHeartbeat.current = Date.now();
        }
        if (gateKey) await synchronise(id, setLocal);
        await syncOperations(id, setLocal);
        setServingError('');
      } catch (e) {
        setServingError(e instanceof Error ? e.message : 'Staff connection unavailable');
      }
    };
    void tick();
    const clock = window.setInterval(
      () => setNow({ mono: performance.now(), wall: Date.now() }),
      1000,
    );
    const timer = window.setInterval(() => void tick(), 5000);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(clock);
      clearInterval(timer);
      window.removeEventListener('online', tick);
    };
  }, [id, gateKey]);
  const signal = local?.serving?.signals.find(
    (s) =>
      s.assignment_id === local.package.serving_assignment?.id &&
      s.step_id === node?.id &&
      s.occurrence_id === occurrenceId(local.state),
  );
  const elapsed =
    gateKey && gateClock?.key === gateKey
      ? Math.max(0, Math.floor(gateClock.initial + now.mono - gateClock.mono))
      : 0;
  const next = async (confirmed?: Answer) => {
    setBusy(true);
    setError('');
    try {
      setLocal(await submitLocal(id, confirmed ?? answer, local!.state.path.length));
      setAnswer(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local save failed; retry before continuing');
    } finally {
      setBusy(false);
    }
  };
  const callStaff = async () => {
    try {
      await requestHelp(id);
      await syncOperations(id, setLocal);
      setServingError('');
    } catch (e) {
      setServingError(
        e instanceof Error ? e.message : 'Could not reach staff; the request is saved',
      );
    }
  };
  // Reaching the end of the flow queues the completion, so staff see the assessment as finished
  // without the participant pressing anything. The completion joins the outbox behind the answers,
  // is saved before the end screen settles, and is retried like any other event when offline.
  const completionTried = useRef('');
  useEffect(() => {
    if (
      !local?.state.outcome ||
      local.finished ||
      local.outbox.some((o) => o.endpoint === 'complete') ||
      completionTried.current === id
    )
      return;
    completionTried.current = id;
    void finish();
  }, [id, local]);
  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      setLocal(await queueCompletion(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Completion could not be saved');
    } finally {
      setBusy(false);
    }
    if (navigator.onLine) await sync();
  };
  return (
    <>
      {loading ? (
        <AssessorShell label="Restricted assessor">
          <p role="status" aria-busy="true">
            Loading cached session…
          </p>
        </AssessorShell>
      ) : local ? (
        <AssetScope
          assets={local.package.assets ?? []}
          flow={local.package.flow as Flow}
          load={readCachedImage}
        >
          <AssessorView
            staffExtra={
              <>
                {local.serving && (
                  <p role="status">{local.serving.pending.length} pending serving operations</p>
                )}
                {!!local.serving?.pending.length && (
                  <Button disabled={busy} onClick={() => void sync()}>
                    Synchronise serving audit
                  </Button>
                )}
                {servingError && (
                  <p role="status">
                    Serving connection: {servingError}. Saved answers are retained.
                  </p>
                )}
                {!!local.package.assets?.length && !!local.outbox.length && (
                  <Button disabled={busy} onClick={() => void sync()}>
                    Synchronise retained events
                  </Button>
                )}
              </>
            }
            pkg={local.package}
            state={local.state}
            answer={answer}
            pending={local.outbox.length}
            finished={local.finished}
            busy={busy}
            error={error}
            servingStatus={signal?.state ?? 'ready'}
            servingActor={signal?.actor}
            elapsed={elapsed}
            servingOffline={!!servingError}
            clockQuality={gateClock?.restored ? 'wall_estimate' : 'monotonic'}
            temporalDraft={
              node ? local.temporalDrafts?.[occurrenceId(local.state) + ':' + node.id] : undefined
            }
            persistTemporal={async (draft) => {
              const saved = await saveTemporalDraft(id, draft, local.state.path.length);
              setLocal(saved);
            }}
            onAnswer={setAnswer}
            onNext={(a) => void next(a)}
            onCallStaff={() => void callStaff()}
            onSync={() => void sync()}
          />
        </AssetScope>
      ) : (
        <AssessorShell
          label="Restricted assessor"
          actions={
            <Button
              variant="primary"
              className="ui-assessor-action"
              disabled={busy}
              onClick={() => void load()}
            >
              Retry local read
            </Button>
          }
        >
          <h1>Waiting for staff preparation</h1>
          <p>Ask laboratory staff to prepare the assigned assessment on this tablet.</p>
          {error && <p role="alert">{error}</p>}
          <TabletUpdate />
        </AssessorShell>
      )}
    </>
  );
}

const awaitKey = 'sensibilia-await-handover';
export interface Summary {
  assessor: string;
  study: string;
  version: string;
  booth?: string;
  language: string;
}
const summary = (pkg: LocalSession['package']): Summary => ({
  assessor: pkg.session.assessor_code,
  study: pkg.study_version.title,
  version: String(pkg.study_version.version_number) + ' (released)',
  booth: pkg.serving_assignment?.booth_label ?? undefined,
  language: String(
    (pkg.context as { language?: string }).language ?? pkg.flow?.default_language ?? '',
  ),
});

/** Staff confirm what was prepared before the tablet goes to the participant. */
export function HandoverReady({
  summary: handover,
  onConfirm,
  embedded = false,
  offeredUpdate,
}: {
  summary: Summary;
  onConfirm: () => void;
  embedded?: boolean;
  /** Gallery only: show the update offer without the tablet app. */
  offeredUpdate?: string;
}) {
  return (
    <AssessorShell
      embedded={embedded}
      label="Ready for handover"
      actions={
        <Button variant="primary" className="ui-assessor-action" onClick={onConfirm}>
          Hand over to participant
        </Button>
      }
    >
      <h1>Ready for {handover.assessor}</h1>
      <dl className="ui-summary" data-layout="allowed-grid">
        <dt>Study</dt>
        <dd>{handover.study}</dd>
        <dt>Version</dt>
        <dd>{handover.version}</dd>
        {handover.booth && (
          <>
            <dt>Booth</dt>
            <dd>{handover.booth}</dd>
          </>
        )}
        <dt>Language</dt>
        <dd>{handover.language}</dd>
        <dt>Stored on tablet</dt>
        <dd>Complete · works offline</dd>
      </dl>
      <p>If anything is wrong, stop and ask the lab lead. Do not hand over the tablet.</p>
      <TabletUpdate offered={offeredUpdate} />
    </AssessorShell>
  );
}

export function AssignedTerminal({ requestedId }: { requestedId?: string }) {
  const [id, setId] = useState<string>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [paired, setPaired] = useState<LocalTerminal>(),
    [handover, setHandover] = useState<Summary>(),
    [claimNote, setClaimNote] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    setId(undefined);
    setPaired(undefined);
    setHandover(undefined);
    try {
      const terminal = await readTerminal();
      // Existing prepared sessions can continue on their original tablet after this update.
      const active = terminal?.sessionId ?? localStorage.getItem('sensibilia-active-session');
      const record = active && (await readSession(active));
      if (active && (!requestedId || active === requestedId) && record) {
        setId(active);
        if (localStorage.getItem(awaitKey) === active) setHandover(summary(record.package));
        // A paired tablet keeps asking which assessment staff want it on, also mid-assessment and
        // on the finish screen, so a new assignment (or an assessment staff ended) hands over
        // without a reload.
        if (terminal) setPaired(terminal);
      } else if (requestedId)
        throw new Error('This assessment is not the task prepared on this tablet. Ask staff.');
      else if (terminal) setPaired(terminal);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local terminal read failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [requestedId]);
  useEffect(() => {
    // A paired tablet picks up the assessment staff assign to it, without any key entry.
    if (!paired) return;
    let stopped = false;
    const claim = async () => {
      try {
        const task = await new Client('', paired.token).request<
          components['schemas']['TerminalTask']
        >('/terminals/' + paired.id + '/assignment', {}, 'session');
        if (!task.session_id) throw new Error('Waiting for staff to assign an assessment.');
        if (task.session_id === paired.sessionId) return;
        await prepareTerminal(paired.id, paired.token);
        // Staff confirm what was prepared before the tablet goes to the participant.
        localStorage.setItem(awaitKey, task.session_id);
        if (!stopped) void load();
      } catch (e) {
        if (!stopped) setClaimNote(e instanceof Error ? e.message : 'Could not check assignment');
      }
    };
    void claim();
    const timer = setInterval(() => void claim(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [paired]);
  useEffect(() => {
    // Attached here so the waiting screen also advertises the installation manifest.
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/assessor/manifest.webmanifest';
    const touch = document.createElement('link');
    touch.rel = 'apple-touch-icon';
    touch.href = '/assessor/apple-touch-icon.png';
    document.head.append(manifest, touch);
    return () => {
      manifest.remove();
      touch.remove();
    };
  }, []);
  if (loading)
    return (
      <AssessorShell label="Assigned assessment">
        <p role="status" aria-busy="true">
          Loading assigned assessment…
        </p>
      </AssessorShell>
    );
  if (id && handover)
    return (
      <HandoverReady
        summary={handover}
        onConfirm={() => {
          localStorage.removeItem(awaitKey);
          setHandover(undefined);
        }}
      />
    );
  if (id) return <Assessor key={id} id={id} />;
  return (
    <AssessorShell
      label="Assigned assessment"
      actions={
        <Button variant="primary" className="ui-assessor-action" onClick={() => void load()}>
          Retry assigned assessment
        </Button>
      }
    >
      <h1>Waiting for staff preparation</h1>
      <p>Ask laboratory staff to prepare this tablet.</p>
      {paired && <p role="status">{claimNote || 'Checking for an assigned assessment…'}</p>}
      {error && <p role="alert">{error}</p>}
      <TabletUpdate />
    </AssessorShell>
  );
}
