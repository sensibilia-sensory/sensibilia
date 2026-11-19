import { useEffect, useRef, useState } from 'react';
import { Button, DataTable, Field, Toolbar } from '../../ui';
import {
  activeAttributes,
  interrupted,
  type TemporalConfig,
  type TemporalDraft,
} from '../methods/temporal';
import type { Answer } from '../flow';

/** Shared Preview/PWA acquisition. Persist completes before captured state is shown. */
export function TemporalRenderer({
  config,
  initial,
  onChange,
  persist,
  disabled = false,
  id = 'temporal',
}: {
  id?: string;
  config: TemporalConfig;
  initial?: TemporalDraft;
  onChange: (answer: Answer | undefined) => void;
  persist?: (draft: TemporalDraft) => Promise<void>;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [elapsed, setElapsed] = useState(initial?.elapsed_ms ?? 0),
    [replay, setReplay] = useState(0);
  const clock = useRef<{ wall: number; mono: number } | undefined>(undefined),
    lastTick = useRef<number | undefined>(undefined),
    current = useRef(draft),
    start = useRef<number | undefined>(undefined),
    writing = useRef(false),
    pendingHidden = useRef(false),
    retry = useRef<TemporalDraft | undefined>(undefined);
  const elapsedNow = () =>
    Math.min(
      config.duration_ms,
      Math.max(
        current.current?.elapsed_ms ?? 0,
        Math.floor(performance.now() - (start.current ?? performance.now())),
      ),
    );
  async function save(next: TemporalDraft) {
    if (disabled) return;
    if (writing.current) {
      if (next.interruption_flags.includes('hidden')) pendingHidden.current = true;
      return;
    }
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await persist?.(next);
      current.current = next;
      setDraft(next);
      setElapsed(next.elapsed_ms);
      retry.current = undefined;
      if (next.state !== 'running') onChange({ state: 'temporal', value: next, ready: true });
      else onChange(undefined);
    } catch (e) {
      retry.current = interrupted(next, 'storage_failure');
      start.current = undefined;
      onChange(undefined);
      setError(e instanceof Error ? e.message : 'Temporal save failed. Retry before continuing.');
    } finally {
      writing.current = false;
      setBusy(false);
      if (pendingHidden.current && current.current?.state === 'running') {
        pendingHidden.current = false;
        void save(interrupted(current.current, 'hidden', elapsedNow()));
      }
    }
  }
  useEffect(() => {
    if (initial?.state === 'running' && !disabled) void save(interrupted(initial, 'reload'));
    else if (initial && initial.state !== 'running')
      onChange({ state: 'temporal', value: initial, ready: true });
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== 'visible' && current.current?.state === 'running')
        void save(interrupted(current.current, 'hidden', elapsedNow()));
    };
    const timer = window.setInterval(() => {
      if (current.current?.state !== 'running' || start.current == null || retry.current) return;
      const now = performance.now(),
        ms = elapsedNow();
      setElapsed(ms);
      if (
        clock.current &&
        (Math.abs(Date.now() - clock.current.wall - (now - clock.current.mono)) >
          config.required_tolerance_ms ||
          (lastTick.current != null && now - lastTick.current > 1000))
      ) {
        void save(interrupted(current.current, 'clock_gap', ms));
        return;
      }
      lastTick.current = now;
      if (document.visibilityState !== 'visible') {
        hidden();
        return;
      }
      if (ms >= config.duration_ms)
        void save({
          ...current.current,
          state: 'complete',
          elapsed_ms: config.duration_ms,
          ended_at: new Date().toISOString(),
        });
    }, 50);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [config.duration_ms, disabled, persist]);
  const active = activeAttributes(draft?.transitions ?? []);
  const locked = disabled || busy || !!error;
  return (
    <section className="ui-stack" aria-label="TCATA capture">
      <p>{config.instructions}</p>
      <p>{config.start_instruction}</p>
      <p role="status">
        {draft ? draft.state + ' · ' + elapsed + ' / ' + config.duration_ms + ' ms' : 'Not started'}
      </p>
      {error && <p role="alert">{error}</p>}
      {retry.current && (
        <Button disabled={busy || disabled} onClick={() => void save(retry.current!)}>
          Retry temporal save
        </Button>
      )}
      {!draft && (
        <Toolbar label="Temporal start">
          <Button
            disabled={locked}
            onClick={() => {
              const stamp = new Date().toISOString();
              const t = performance.now();
              let resolution = Infinity,
                prior = t;
              for (let i = 0; i < 1000; i++) {
                const n = performance.now();
                if (n > prior) resolution = Math.min(resolution, n - prior);
                prior = n;
              }
              start.current = t;
              clock.current = { wall: Date.now(), mono: t };
              lastTick.current = t;
              void save({
                client_event_id: crypto.randomUUID(),
                state: 'running',
                started_at: stamp,
                ended_at: stamp,
                elapsed_ms: 0,
                clock_resolution_ms: Number.isFinite(resolution) ? resolution : null,
                interruption_flags: [],
                transitions: [],
              });
            }}
          >
            Start temporal run
          </Button>
          {config.allow_skips && (
            <Button
              disabled={locked}
              onClick={() =>
                void save({
                  client_event_id: crypto.randomUUID(),
                  state: 'skipped',
                  started_at: null,
                  ended_at: new Date().toISOString(),
                  elapsed_ms: 0,
                  clock_resolution_ms: null,
                  interruption_flags: [],
                  transitions: [],
                })
              }
            >
              Skip temporal run
            </Button>
          )}
        </Toolbar>
      )}
      {draft?.state === 'running' &&
        config.attributes.map((attribute) => (
          <Button
            key={attribute.id}
            disabled={locked}
            aria-pressed={active.has(attribute.id)}
            onClick={() => {
              const ms = elapsedNow();
              if (ms >= config.duration_ms) return;
              if (draft.transitions.length >= 10000) {
                void save(interrupted(draft, 'event_limit', ms));
                return;
              }
              const stamp = new Date().toISOString();
              void save({
                ...draft,
                elapsed_ms: ms,
                ended_at: stamp,
                transitions: [
                  ...draft.transitions,
                  {
                    client_event_id: crypto.randomUUID(),
                    seq: draft.transitions.length + 1,
                    elapsed_ms: ms,
                    attribute_id: attribute.id,
                    selected: !active.has(attribute.id),
                    recorded_at: stamp,
                  },
                ],
              });
            }}
          >
            {attribute.prompt} · {active.has(attribute.id) ? 'selected' : 'unselected'}
          </Button>
        ))}
      {draft && draft.state !== 'running' && (
        <>
          {draft.state === 'interrupted' && (
            <p role="status">
              Interrupted: {draft.interruption_flags.join(', ')}. Retained trace; ask staff. This
              run cannot resume its original clock.
            </p>
          )}
          <Field
            label="Replay elapsed ms"
            kind="number"
            value={String(replay)}
            min={0}
            max={draft.elapsed_ms}
            onChange={(e) => setReplay(Number(e.target.value))}
          />
          <p>
            Active at replay:{' '}
            {[...activeAttributes(draft.transitions, replay)]
              .map((id) => config.attributes.find((a) => a.id === id)?.prompt)
              .join(', ') || 'None'}
          </p>
          <DataTable
            id={id + '-transitions'}
            label="Temporal transitions"
            selectable={false}
            data={draft.transitions}
            getRowId={(e) => e.client_event_id}
            columns={[
              { accessorKey: 'seq', header: 'Sequence' },
              { accessorKey: 'elapsed_ms', header: 'Elapsed ms' },
              { accessorKey: 'attribute_id', header: 'Attribute ID' },
              {
                id: 'selected',
                header: 'State',
                accessorFn: (e) => (e.selected ? 'selected' : 'unselected'),
              },
              { accessorKey: 'recorded_at', header: 'Recorded UTC' },
            ]}
          />
        </>
      )}
    </section>
  );
}
