import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { components } from '../api-schema';
import { Button, ConfirmButton, DataTable, Field, SidePanel, Tabs, Toolbar } from '../ui';
import { navigate } from '../router';
import { servingStateLabel } from '../shared/lexicon';
import { ApiError, Client } from './client';
import { useStaffName } from './staff';

export type BoardRoom = components['schemas']['RoomRead'];
export type BoardBooth = components['schemas']['Booth'];
export type BoardTablet = components['schemas']['BoardTablet'];
export type ServingAction = 'acknowledged' | 'served';
type Study = components['schemas']['StudyRead'];

const STAGE_LABEL: Record<BoardTablet['stage'] | 'empty', string> = {
  waiting: 'Waiting for assignment',
  serving: 'Needs samples',
  in_progress: 'Test in progress',
  completed: 'Finished',
  ended: 'Ended by staff',
  offline: 'Not responding',
  empty: 'No tablet',
};
/** A tablet in these stages is busy; moving it would split an assessment from its booth. */
const BUSY: BoardTablet['stage'][] = ['serving', 'in_progress', 'offline'];

/** Where a booth sits: its saved spot, or the spot its old grid position implies. */
export function boothPosition(b: BoardBooth, room: Pick<BoardRoom, 'rows' | 'columns'>) {
  return {
    x: b.x ?? (b.column - 0.5) / room.columns,
    y: b.y ?? (b.row - 0.5) / room.rows,
  };
}

/** The next unused booth number, so new booths read 1, 2, 3 … */
export function nextBoothLabel(booths: BoardBooth[]) {
  const used = new Set(booths.map((b) => b.label));
  let n = 1;
  while (used.has(String(n))) n += 1;
  return String(n);
}

/** First free grid cell; the grid is bookkeeping only, the board uses x and y. */
function freeCell(booths: BoardBooth[], rows: number, columns: number) {
  const taken = new Set(booths.map((b) => b.row + ':' + b.column));
  for (let r = 1; r <= 20; r++)
    for (let c = 1; c <= 20; c++)
      if (!taken.has(r + ':' + c))
        return { row: r, column: c, rows: Math.max(rows, r), columns: Math.max(columns, c) };
  return undefined;
}

/** Spread new booths over the canvas rather than stacking them. */
function startingSpot(count: number) {
  return { x: 0.15 + 0.23 * (count % 4), y: 0.15 + 0.28 * (Math.floor(count / 4) % 3) };
}

const roomKey = (r: BoardRoom) => r.room_id ?? r.id;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function Marker({ stage }: { stage: BoardTablet['stage'] | 'empty' }) {
  return <span className={'ui-board-marker ui-board-marker--' + stage} aria-hidden="true" />;
}

/** The tablets list, the floor canvas and nothing else; data and actions come from the caller. */
export function BoothCanvas({
  room,
  tablets,
  selectedId,
  onSelect,
  onMove,
  onDropTablet,
}: {
  room?: BoardRoom;
  tablets: BoardTablet[];
  selectedId?: string;
  onSelect: (boothId: string) => void;
  onMove: (boothId: string, x: number, y: number) => void;
  onDropTablet: (terminalId: string, boothId: string | null) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; moved: boolean } | undefined>(
    undefined,
  );
  const [live, setLive] = useState<{ id: string; x: number; y: number }>();
  const [over, setOver] = useState('');
  const booths = (room?.booths ?? []).filter((b) => b.enabled);
  const dropOn = (boothId: string | null) => (e: DragEvent) => {
    e.preventDefault();
    setOver('');
    const id = e.dataTransfer.getData('text/plain');
    if (id) onDropTablet(id, boothId);
  };
  const allowDrop = (key: string) => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOver(key);
  };
  const place = (e: PointerEvent, id: string) => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box) return;
    setLive({
      id,
      x: clamp((e.clientX - box.left) / box.width, 0.08, 0.92),
      y: clamp((e.clientY - box.top) / box.height, 0.1, 0.85),
    });
  };
  return (
    <>
      <div
        className={'ui-board-rail' + (over === 'rail' ? ' ui-board-rail--over' : '')}
        role="list"
        aria-label="Tablets"
        onDragOver={allowDrop('rail')}
        onDragLeave={() => setOver('')}
        onDrop={dropOn(null)}
      >
        <strong>Tablets</strong>
        {tablets.length === 0 && <span className="ui-hint">No tablets set up yet.</span>}
        {tablets.map((t) => {
          const booth = room?.booths.find((b) => b.id === t.booth_id);
          return (
            <div
              key={t.terminal_id}
              role="listitem"
              className="ui-board-tablet"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', t.terminal_id);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              {t.name}
              <small>{booth ? 'Booth ' + booth.label : 'Not on a booth'}</small>
            </div>
          );
        })}
        <span className="ui-hint">Drop a tablet here to take it off its booth.</span>
        <span className="ui-hint">Tablets not on a booth can be started from the List tab.</span>
      </div>
      <div className="ui-board-canvas" ref={canvas} role="group" aria-label="Booths">
        {booths.length === 0 && (
          <p className="ui-hint ui-board-empty">
            No booths yet. Press Add booth, then drag tablets onto them.
          </p>
        )}
        {booths.map((b) => {
          const tablet = tablets.find((t) => t.booth_id === b.id);
          const stage = tablet?.stage ?? 'empty';
          const detail = tablet ? tablet.detail : STAGE_LABEL.empty;
          const at = live?.id === b.id ? live : boothPosition(b, room!);
          return (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              aria-label={'Booth ' + b.label + ', ' + (tablet ? tablet.name + ', ' : '') + detail}
              className={
                'ui-board-booth' +
                (selectedId === b.id ? ' ui-board-booth--selected' : '') +
                (over === b.id ? ' ui-board-booth--over' : '')
              }
              style={{ left: at.x * 100 + '%', top: at.y * 100 + '%' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(b.id);
                }
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { id: b.id, sx: e.clientX, sy: e.clientY, moved: false };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== b.id) return;
                if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
                d.moved = true;
                place(e, b.id);
              }}
              onPointerUp={() => {
                const d = drag.current;
                drag.current = undefined;
                if (d?.moved && live?.id === b.id) onMove(b.id, live.x, live.y);
                else if (d) onSelect(b.id);
                setLive(undefined);
              }}
              onDragOver={allowDrop(b.id)}
              onDragLeave={() => setOver('')}
              onDrop={dropOn(b.id)}
            >
              <div className="ui-board-square">
                <Marker stage={stage} />
                {b.label}
              </div>
              <div className="ui-board-caption">
                {tablet && <small>{tablet.name}</small>}
                {detail}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Seconds since the request was made, by the server's clock so a wrong tablet clock cannot skew it. */
const waitedSeconds = (requestedAt: string, serverTime: string) =>
  Math.max(0, Math.floor((Date.parse(serverTime) - Date.parse(requestedAt)) / 1000));

/**
 * The open serving request of one tablet: what to bring, for which booth, and the two staff steps
 * (acknowledge, then mark served). Marking served asks once more because the assessor can then
 * confirm the samples.
 */
export function ServingRequest({
  tablet,
  serverTime,
  busy = false,
  needsName = false,
  onAct,
}: {
  tablet: BoardTablet;
  serverTime: string;
  busy?: boolean;
  needsName?: boolean;
  onAct: (action: ServingAction) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const serving = tablet.serving;
  if (!serving) return null;
  const state = serving.signal.state;
  const help = state === 'help';
  return (
    <div className="ui-stack" role="group" aria-label="Samples to serve">
      <strong>
        {help ? 'Assessor asked for help with samples' : 'Samples to serve'} ·{' '}
        {servingStateLabel(state)}
      </strong>
      {serving.slots.map((slot) => (
        <p key={slot.sample_id + ':' + slot.position}>
          <span className="ui-sample-code">{slot.code}</span> · {slot.label}
        </p>
      ))}
      {serving.preparation && <p>{serving.preparation}</p>}
      <p className="ui-hint">
        Assessor {tablet.assessor_code} · waiting{' '}
        {waitedSeconds(serving.signal.requested_at, serverTime)} s
      </p>
      {(state === 'ready' || help) && (
        <Button
          variant="primary"
          disabled={busy || needsName}
          onClick={() => onAct('acknowledged')}
        >
          {help ? 'Acknowledge help request' : 'Acknowledge'}
        </Button>
      )}
      {state === 'acknowledged' &&
        (confirming ? (
          <>
            <p>Check the booth and the codes above, then confirm the samples are in the booth.</p>
            <span className="ui-inline">
              <Button
                variant="primary"
                disabled={busy || needsName}
                onClick={() => {
                  setConfirming(false);
                  onAct('served');
                }}
              >
                Confirm physical delivery
              </Button>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
            </span>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={busy || needsName}
            onClick={() => setConfirming(true)}
          >
            Mark served…
          </Button>
        ))}
      {needsName && <p className="ui-hint">Enter your name in the toolbar first.</p>}
    </div>
  );
}

export interface Row {
  id: string;
  booth: string;
  tablet: string;
  study: string;
  assessor: string;
  now: string;
  board?: BoardTablet;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'booth', header: 'Booth' },
  { accessorKey: 'tablet', header: 'Tablet' },
  { accessorKey: 'study', header: 'Study' },
  { accessorKey: 'assessor', header: 'Assessor' },
  { accessorKey: 'now', header: 'Now' },
];

/** One row per booth or tablet with its single next action (the List tab). */
export function RunTable({
  rows,
  loading = false,
  busy = false,
  blocked,
  startLabel,
  onStart,
  onEnd,
  onServe,
}: {
  rows: Row[];
  loading?: boolean;
  busy?: boolean;
  blocked: (t: BoardTablet) => string | undefined;
  startLabel: (t: BoardTablet) => string;
  onStart: (t: BoardTablet) => void;
  onEnd?: (t: BoardTablet) => void;
  onServe?: (t: BoardTablet) => void;
}) {
  return (
    <DataTable
      id="run-board"
      label="Tablets and booths"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      selectable={false}
      virtualize={false}
      emptyText={loading ? 'Loading…' : 'No tablets or booths yet. Set up a tablet first.'}
      rowActions={(r) => {
        const t = r.board;
        if (!t) return <span className="ui-hint">Set up a tablet for this booth</span>;
        const end = onEnd && (
          <ConfirmButton compact confirmLabel="End now" disabled={busy} onConfirm={() => onEnd(t)}>
            End assessment
          </ConfirmButton>
        );
        if (t.stage === 'serving')
          return (
            <span className="ui-inline">
              <Button
                variant="primary"
                compact
                disabled={busy || !t.booth_id}
                title={t.booth_id ? undefined : 'Place this tablet on a booth first'}
                onClick={() => onServe?.(t)}
              >
                Serve samples
              </Button>
              {end}
            </span>
          );
        if (BUSY.includes(t.stage))
          return (
            <span className="ui-inline">
              <span className="ui-hint">In progress</span>
              {end}
            </span>
          );
        return (
          <Button
            variant={t.session_id ? 'primary' : 'default'}
            compact
            disabled={busy || !!blocked(t)}
            title={blocked(t)}
            onClick={() => onStart(t)}
          >
            {startLabel(t)}
          </Button>
        );
      }}
    />
  );
}

/** Where tablets are and what they need, with the one next action for each: start, serve or end. */
export function RunStudy({ client, view }: { client: Client; view?: string }) {
  const [rooms, setRooms] = useState<BoardRoom[]>([]),
    [tablets, setTablets] = useState<BoardTablet[]>([]),
    [serverTime, setServerTime] = useState(''),
    [roomId, setRoomId] = useState(''),
    [selectedId, setSelectedId] = useState(''),
    [label, setLabel] = useState(''),
    [studies, setStudies] = useState<Study[]>([]),
    [versionId, setVersionId] = useState(''),
    [tab, setTab] = useState(view === 'list' ? 'list' : 'floor');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  /** An earlier assessment still holding the booth a start was refused on, and the tablet to retry. */
  const [holder, setHolder] = useState<{ sessionId: string; booth: string; tablet: BoardTablet }>();
  const [staff, setStaff] = useStaffName();
  const room = rooms.find((r) => roomKey(r) === roomId) ?? rooms[0];
  const selected = room?.booths.find((b) => b.id === selectedId && b.enabled);
  const occupant = (boothId: string) => tablets.find((t) => t.booth_id === boothId);

  const load = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([
        client.request<BoardRoom[]>('/rooms'),
        client.request<{ tablets: BoardTablet[]; server_time: string }>('/booth-board'),
      ]);
      setRooms(r);
      setTablets(b.tablets);
      setServerTime(b.server_time);
      setError((e) => (e.startsWith('Could not read') ? '' : e));
    } catch (e) {
      setError('Could not read the board: ' + (e instanceof Error ? e.message : 'read failed'));
    } finally {
      setLoading(false);
    }
  }, [client]);
  const loadStudies = useCallback(
    () => client.studies('', 0).then(setStudies, () => undefined),
    [client],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => setLabel(selected?.label ?? ''), [selected?.id, selected?.label]);
  useEffect(() => {
    void loadStudies();
  }, [loadStudies]);
  const released = useMemo(
    () =>
      studies
        .filter((st) => !st.closed_at && !st.archived_at)
        .flatMap((st) =>
          st.versions
            .filter((v) => v.published_at)
            .map((v) => ({
              value: v.id,
              label: st.title + ' · v' + v.version_number,
              studyId: st.id,
            })),
        ),
    [studies],
  );
  // The server lists studies newest first, so the default is the last released version of the first
  // released study. A functional update keeps a choice made while the list was still loading.
  useEffect(() => {
    const newest = released.filter((r) => r.studyId === released[0]?.studyId).at(-1);
    if (newest) setVersionId((current) => current || newest.value);
  }, [released]);
  const studyOf = (id: string | null | undefined) => {
    if (!id) return '—';
    for (const st of studies) {
      const v = st.versions.find((x) => x.id === id);
      if (v) return st.title + ' · v' + v.version_number + (st.closed_at ? ' (closed)' : '');
    }
    return 'Earlier study';
  };
  const changeTab = (next: string) => {
    setTab(next);
    // Keep the tab in the address without a router navigation, which would move focus to the title.
    window.history.replaceState(
      window.history.state,
      '',
      '/researcher/run' + (next === 'list' ? '?view=list' : ''),
    );
  };

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    setHolder(undefined);
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
      await load();
    } finally {
      setBusy(false);
    }
  };
  /** A room layout change is a new saved revision; earlier layouts stay in history. */
  const saveLayout = async (booths: BoardBooth[], size?: { rows: number; columns: number }) => {
    const saved = await client.request<BoardRoom>('/rooms', {
      method: 'POST',
      body: JSON.stringify({
        room_id: room?.room_id,
        expected_revision: room?.revision ?? 0,
        name: room?.name ?? 'Laboratory',
        rows: size?.rows ?? room?.rows ?? 20,
        columns: size?.columns ?? room?.columns ?? 20,
        booths,
      }),
    });
    setRooms((all) => [...all.filter((r) => roomKey(r) !== roomKey(saved)), saved]);
    setRoomId(roomKey(saved));
  };
  const addBooth = () =>
    act(async () => {
      const existing = room?.booths ?? [];
      const cell = freeCell(existing, room?.rows ?? 1, room?.columns ?? 1);
      if (!cell) throw new Error('The board is full (100 booths).');
      const spot = startingSpot(existing.filter((b) => b.enabled).length);
      const booth: BoardBooth = {
        id: crypto.randomUUID(),
        label: nextBoothLabel(existing),
        row: cell.row,
        column: cell.column,
        enabled: true,
        ...spot,
      };
      await saveLayout([...existing, booth], cell);
      setTab('floor');
      setSelectedId(booth.id);
    });
  const changeBooth = (id: string, change: Partial<BoardBooth>) =>
    act(async () => {
      await saveLayout((room?.booths ?? []).map((b) => (b.id === id ? { ...b, ...change } : b)));
    });
  const link = (terminalId: string, boothId: string | null) => {
    const tablet = tablets.find((t) => t.terminal_id === terminalId);
    if (!tablet || tablet.booth_id === boothId) return;
    if (!staff.trim()) return setError('Enter your name first.');
    if (BUSY.includes(tablet.stage))
      return setError(
        tablet.name + ' has an assessment running. Wait until it finishes or end it first.',
      );
    const other = boothId ? occupant(boothId) : undefined;
    if (other && other.terminal_id !== terminalId)
      return setError(other.name + ' is already on that booth. Move it off first.');
    void act(async () => {
      await client.request('/terminals/' + terminalId + '/booth', {
        method: 'PUT',
        body: JSON.stringify({
          booth_id: boothId,
          expected_revision: tablet.revision,
          staff_name: staff,
          reason: 'Placed on the booth board',
        }),
      });
    });
  };
  const startLabel = (t: BoardTablet) =>
    !t.session_id
      ? 'Start first assessment'
      : t.study_version_id === versionId
        ? 'Next assessor'
        : 'Start on selected study';
  const blocked = (t: BoardTablet) =>
    !staff.trim()
      ? 'Enter your name first'
      : !versionId
        ? 'Choose a study first'
        : BUSY.includes(t.stage)
          ? 'Assessment in progress'
          : undefined;
  /** Start the next assessment on the selected study; a running one is ended first (answers still sync). */
  const start = (tablet: BoardTablet, endFirst = false) => {
    if (!staff.trim()) return setError('Enter your name first.');
    void act(async () => {
      if (endFirst && tablet.session_id) await client.endSession(tablet.session_id);
      let revision = tablet.revision;
      if (endFirst) {
        const fresh = await client.request<{ tablets: BoardTablet[] }>('/booth-board');
        revision =
          fresh.tablets.find((t) => t.terminal_id === tablet.terminal_id)?.revision ?? revision;
      }
      const moved = await client
        .request<{ assessor_code: string | null; name: string }>(
          '/terminals/' + tablet.terminal_id + '/next-assessment',
          {
            method: 'POST',
            body: JSON.stringify({
              expected_revision: revision,
              staff_name: staff,
              reason: !tablet.session_id
                ? 'First assessment'
                : tablet.study_version_id === versionId
                  ? 'Next assessor'
                  : 'Moved to another study',
              study_version_id: versionId || undefined,
            }),
          },
        )
        .catch((e: unknown) => {
          // The booth still holds an earlier assessment in progress: offer to end it here.
          const held = e instanceof ApiError ? (e.detail as { session_id?: unknown }) : null;
          if (held && typeof held.session_id === 'string')
            setHolder({
              sessionId: held.session_id,
              booth: String((held as { booth_label?: unknown }).booth_label ?? ''),
              tablet,
            });
          throw e;
        });
      setNotice(
        moved.name + ': assessor ' + moved.assessor_code + ' assigned. The tablet prepares itself.',
      );
    });
  };
  /** End the assessment holding the booth, then start the tablet that was refused. */
  const endHolder = () => {
    if (!holder) return;
    const { sessionId, tablet } = holder;
    let ended = false;
    void act(async () => {
      await client.endSession(sessionId);
      ended = true;
    }).then(() => {
      if (ended) start(tablet);
    });
  };
  const end = (tablet: BoardTablet) => {
    const id = tablet.session_id;
    if (!id) return;
    void act(async () => {
      await client.endSession(id);
      setNotice(
        tablet.name +
          ': assessment ended. Answers already recorded on the tablet are still accepted.',
      );
    });
  };
  /** Acknowledge or serve the tablet's open request; the server checks the revision we saw. */
  const serve = (tablet: BoardTablet, action: ServingAction) => {
    const serving = tablet.serving;
    if (!serving) return;
    if (!staff.trim()) return setError('Enter your name first.');
    const { signal } = serving;
    void act(async () => {
      await client.request('/booth-board/operations', {
        method: 'POST',
        body: JSON.stringify({
          client_event_id: crypto.randomUUID(),
          assignment_id: serving.assignment_id,
          step_id: signal.step_id,
          occurrence_id: signal.occurrence_id,
          sample_id: signal.occurrence_id === 'study' ? null : signal.occurrence_id.split(':')[1],
          expected_revision: signal.revision,
          action,
          actor: staff.trim(),
          recorded_at: new Date().toISOString(),
        }),
      });
    });
  };
  /** From the List tab: show the booth whose tablet needs samples, with its serving panel open. */
  const showOnFloor = (tablet: BoardTablet) => {
    const home = rooms.find((r) => r.booths.some((b) => b.id === tablet.booth_id));
    if (home) setRoomId(roomKey(home));
    if (tablet.booth_id) setSelectedId(tablet.booth_id);
    changeTab('floor');
  };

  const tabletOptions = [
    { value: '', label: 'No tablet' },
    ...tablets.map((t) => ({ value: t.terminal_id, label: t.name })),
  ];
  const labelTaken = !!room?.booths.some((b) => b.id !== selected?.id && b.label === label.trim());

  const count = (...stages: BoardTablet['stage'][]) =>
    tablets.filter((t) => stages.includes(t.stage)).length;
  const running = count('in_progress', 'offline');
  const needSamples = count('serving');
  const waiting = count('completed', 'ended');
  const idle = count('waiting');
  const stillBusy = running + needSamples;
  const selectedStudy = released.find((r) => r.value === versionId);

  const booths = rooms.flatMap((r) => r.booths.filter((b) => b.enabled));
  const boothLabel = (id: string | null) => booths.find((b) => b.id === id)?.label ?? '';
  const rows: Row[] = [
    ...tablets.map((t) => ({
      id: t.terminal_id,
      booth: boothLabel(t.booth_id) || 'No booth',
      tablet: t.name,
      study: studyOf(t.study_version_id),
      assessor: t.assessor_code ?? '—',
      now: t.detail,
      board: t,
    })),
    ...booths
      .filter((b) => !tablets.some((t) => t.booth_id === b.id))
      .map((b) => ({
        id: 'booth-' + b.id,
        booth: b.label,
        tablet: 'No tablet',
        study: '—',
        assessor: '—',
        now: '—',
      })),
  ].sort((a, b) => a.booth.localeCompare(b.booth, undefined, { numeric: true }));

  const floor = (
    <div className="ui-board">
      <BoothCanvas
        room={room}
        tablets={tablets}
        selectedId={selected?.id}
        onSelect={setSelectedId}
        onMove={(id, x, y) => void changeBooth(id, { x, y })}
        onDropTablet={link}
      />
      {selected && room && (
        <div className="ui-board-panel">
          <SidePanel title={'Booth ' + selected.label} onClose={() => setSelectedId('')}>
            <div className="ui-stack">
              {(() => {
                const tablet = occupant(selected.id);
                return tablet?.serving ? (
                  <ServingRequest
                    tablet={tablet}
                    serverTime={serverTime}
                    busy={busy}
                    needsName={!staff.trim()}
                    onAct={(action) => serve(tablet, action)}
                  />
                ) : null;
              })()}
              {(() => {
                const tablet = occupant(selected.id);
                if (!tablet) return null;
                const busyNow = BUSY.includes(tablet.stage);
                return (
                  <div className="ui-stack" role="group" aria-label="Assessment on this tablet">
                    <strong>{tablet.name}</strong>
                    <p>{tablet.detail}</p>
                    <p className="ui-hint">Study: {studyOf(tablet.study_version_id)}</p>
                    {busyNow ? (
                      <>
                        <ConfirmButton
                          confirmLabel="End and assign next"
                          disabled={busy || !versionId}
                          onConfirm={() => start(tablet, true)}
                        >
                          Reset and assign next…
                        </ConfirmButton>
                        <ConfirmButton
                          confirmLabel="End now"
                          disabled={busy}
                          onConfirm={() => end(tablet)}
                        >
                          End assessment
                        </ConfirmButton>
                        <p className="ui-hint">
                          This ends the running assessment. Answers the tablet already recorded
                          still sync; nothing is deleted.
                        </p>
                      </>
                    ) : (
                      <Button
                        variant="primary"
                        disabled={busy || !!blocked(tablet)}
                        title={blocked(tablet)}
                        onClick={() => start(tablet)}
                      >
                        {startLabel(tablet)}
                      </Button>
                    )}
                    {!busyNow && !versionId && (
                      <p className="ui-hint">Choose a study in the toolbar first.</p>
                    )}
                  </div>
                );
              })()}
              <Field
                label="Booth name"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                error={labelTaken ? 'Another booth already has this name.' : undefined}
                disabled={busy}
              />
              <Button
                disabled={busy || !label.trim() || labelTaken || label.trim() === selected.label}
                onClick={() => void changeBooth(selected.id, { label: label.trim() })}
              >
                Save name
              </Button>
              <Field
                label="Tablet on this booth"
                kind="select"
                value={occupant(selected.id)?.terminal_id ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  const current = occupant(selected.id);
                  if (next) link(next, selected.id);
                  else if (current) link(current.terminal_id, null);
                }}
                options={tabletOptions}
                disabled={busy}
                hint="Same as dragging a tablet onto the booth."
              />
              <p className="ui-hint">
                Removing a booth only hides it from the board. Tablets, assessments and results stay
                as they are.
              </p>
              <ConfirmButton
                variant="danger"
                confirmLabel="Remove booth"
                disabled={busy || !!occupant(selected.id)}
                onConfirm={() => {
                  void changeBooth(selected.id, { enabled: false });
                  setSelectedId('');
                }}
              >
                Remove booth…
              </ConfirmButton>
              {occupant(selected.id) && (
                <p className="ui-hint">Take the tablet off this booth before removing it.</p>
              )}
            </div>
          </SidePanel>
        </div>
      )}
    </div>
  );

  return (
    <section className="ui-stack" aria-label="Run study">
      <Toolbar
        label="Run study actions"
        secondary={
          <>
            {rooms.length > 1 && (
              <Field
                label="Room"
                kind="select"
                compact
                value={room ? roomKey(room) : ''}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  setSelectedId('');
                }}
                options={rooms.map((r) => ({ value: roomKey(r), label: r.name }))}
              />
            )}
            <Button disabled={busy || loading} onClick={() => void addBooth()}>
              Add booth
            </Button>
            <Button onClick={() => navigate('/researcher/terminals')}>Set up tablets</Button>
            <Button onClick={() => navigate('/researcher/rooms')}>Advanced room editor</Button>
            <Button
              disabled={loading || busy}
              onClick={() => {
                void load();
                void loadStudies();
              }}
            >
              Refresh
            </Button>
          </>
        }
      >
        <h1>Run study</h1>
        <Field
          label="Your name"
          compact
          placeholder="Your name"
          value={staff}
          onChange={(e) => setStaff(e.target.value)}
        />
        <Field
          label="Study for next assessments"
          kind="select"
          compact
          value={versionId}
          onChange={(e) => setVersionId(e.target.value)}
          options={released.length ? released : [{ value: '', label: 'No released study' }]}
        />
      </Toolbar>
      <p role="status">
        Tablets {tablets.length} · in progress {running} · needs samples {needSamples} · waiting for
        next assessor {waiting} · no assessment yet {idle}
        {!stillBusy && tablets.length > 0 && (
          <>
            {' · '}all assessments are finished
            {selectedStudy && (
              <>
                {' · '}
                <Button
                  compact
                  onClick={() =>
                    navigate(
                      '/researcher/studies/' +
                        selectedStudy.studyId +
                        '/versions/' +
                        versionId +
                        '/data',
                    )
                  }
                >
                  Open results and export
                </Button>
              </>
            )}
          </>
        )}
        {notice ? ' · ' + notice : ''}
      </p>
      {error && (
        <p role="alert">
          {error}{' '}
          {holder ? (
            <>
              <ConfirmButton compact confirmLabel="End now" disabled={busy} onConfirm={endHolder}>
                {'End assessment for booth ' + holder.booth}
              </ConfirmButton>{' '}
              <span className="ui-hint">
                Answers already recorded for that assessment still sync; nothing is deleted.
              </span>
            </>
          ) : (
            <Button onClick={() => void load()}>Retry</Button>
          )}
        </p>
      )}
      <Tabs
        label="Run study views"
        value={tab}
        onChange={changeTab}
        tabs={[
          { id: 'floor', label: 'Floor', content: floor },
          {
            id: 'list',
            label: 'List',
            content: (
              <RunTable
                rows={rows}
                loading={loading}
                busy={busy}
                blocked={blocked}
                startLabel={startLabel}
                onStart={(t) => start(t)}
                onEnd={end}
                onServe={showOnFloor}
              />
            ),
          },
        ]}
      />
      <p className="ui-hint">
        Drag a tablet onto a booth to place it. Drag a booth to arrange the floor like the room.
        Select a booth to start, serve, rename or remove it.
      </p>
    </section>
  );
}
