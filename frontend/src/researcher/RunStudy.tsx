import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { components } from '../api-schema';
import { Button, ConfirmButton, DataTable, Field, Popover, SidePanel, Tabs, Toolbar } from '../ui';
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

const NEXT_BOX_KEY = 'sensibilia.run.next-samples-box';
const FLOOR_VIEW_KEY = 'sensibilia.run.floor-view';
/** Where this viewer left the Next samples box; a per-browser convenience, safe to lose. */
function savedNextBox() {
  try {
    const at = JSON.parse(localStorage.getItem(NEXT_BOX_KEY) ?? '') as { x: number; y: number };
    if (typeof at.x === 'number' && typeof at.y === 'number') return at;
  } catch {
    /* no saved spot */
  }
  return { x: 1, y: 0 };
}

const NAMES_KEY = 'sensibilia.run.booth-names';
/**
 * Booth names this viewer chose. They change only what this browser shows: the room layout,
 * assignments and records keep the booth's own label.
 */
export function useBoothNames() {
  const [names, setNames] = useState<Record<string, string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '') as unknown;
      return saved && typeof saved === 'object' ? (saved as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  /** An empty name, or the booth's own label, goes back to showing the booth's own label. */
  const rename = (id: string, name: string) =>
    setNames((n) => {
      const next = { ...n };
      if (name) next[id] = name;
      else delete next[id];
      try {
        localStorage.setItem(NAMES_KEY, JSON.stringify(next));
      } catch {
        /* not remembered; it still shows until reload */
      }
      return next;
    });
  return [names, rename] as const;
}
/** The room as this viewer sees it: each booth under the name chosen here, if any. */
export const withNames = (room: BoardRoom, names: Record<string, string>): BoardRoom => ({
  ...room,
  booths: room.booths.map((b) => ({ ...b, label: names[b.id] || b.label })),
});

/** What this viewer shows on the floor: the next sample under each booth, the sample table. */
export type FloorView = { underBooths: boolean; table: boolean; ahead: number };
const FLOOR_VIEW: FloorView = { underBooths: true, table: false, ahead: 3 };
/** The longest look ahead the table offers; the board reports more than this. */
export const MAX_AHEAD = 5;

/** This viewer's floor view settings; a per-browser convenience, safe to lose. */
export function useFloorView() {
  const [view, setView] = useState<FloorView>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FLOOR_VIEW_KEY) ?? '') as Partial<FloorView>;
      return {
        underBooths:
          typeof saved.underBooths === 'boolean' ? saved.underBooths : FLOOR_VIEW.underBooths,
        table: typeof saved.table === 'boolean' ? saved.table : FLOOR_VIEW.table,
        ahead:
          typeof saved.ahead === 'number' ? clamp(saved.ahead, 1, MAX_AHEAD) : FLOOR_VIEW.ahead,
      };
    } catch {
      return FLOOR_VIEW;
    }
  });
  const change = (next: Partial<FloorView>) =>
    setView((v) => {
      const merged = { ...v, ...next };
      try {
        localStorage.setItem(FLOOR_VIEW_KEY, JSON.stringify(merged));
      } catch {
        /* not remembered; it still works */
      }
      return merged;
    });
  return [view, change] as const;
}

/** The toggles above the floor: next sample under booths, the sample table and its reach. */
export function FloorViewOptions({
  view,
  onChange,
}: {
  view: FloorView;
  onChange: (next: Partial<FloorView>) => void;
}) {
  return (
    <div className="ui-board-options" role="group" aria-label="Floor view">
      <Field
        kind="toggle"
        label="Next sample under booths"
        checked={view.underBooths}
        onChange={(e) => onChange({ underBooths: e.target.checked })}
      />
      <Field
        kind="toggle"
        label="Sample table"
        checked={view.table}
        onChange={(e) => onChange({ table: e.target.checked })}
      />
      {view.table && (
        <Field
          kind="select"
          label="Upcoming samples in the table"
          compact
          value={String(view.ahead)}
          onChange={(e) => onChange({ ahead: Number(e.target.value) })}
          options={Array.from({ length: MAX_AHEAD }, (_, i) => ({
            value: String(i + 1),
            label: i + 1 + ' upcoming',
          }))}
        />
      )}
    </div>
  );
}

type Slot = BoardTablet['next_samples'][number];
/** A tablet that is running an assessment, so it has samples now or ahead. */
const RUNNING: BoardTablet['stage'][] = ['in_progress', 'serving', 'offline'];

/**
 * The serving steps still ahead of a running tablet, nearest first. While the tablet asks for
 * samples, that open request is the nearest step and is needed now.
 */
export function upcoming(t: BoardTablet) {
  const ahead = t.upcoming_samples ?? [];
  if (t.serving) return { steps: [t.serving.slots, ...ahead], now: true };
  return { steps: ahead, now: false };
}

/** The stage sentence without the "next sample" part, when that is shown on its own line. */
const withoutNext = (detail: string) => detail.replace(/ · next samples? .*$/, '');

function Slots({ slots, labels = true }: { slots: Slot[] | undefined; labels?: boolean }) {
  if (!slots?.length) return <>—</>;
  return (
    <>
      {slots.map((s) => (
        <span key={s.sample_id + ':' + s.position} className="ui-board-next-slot">
          <span className="ui-sample-code">{s.code}</span>
          {labels && ' ' + s.label}
        </span>
      ))}
    </>
  );
}
const slotText = (slots: Slot[] | undefined) => (slots ?? []).map((s) => s.code).join(' ');

const AHEAD_HEADER = ['Next', '2nd next', '3rd next', '4th next', '5th next'];

/**
 * A box staff can drag anywhere on the floor, listing for each running assessor the sample they
 * are assessing and the samples their next serving steps ask for, so those can be prepared before
 * the tablet asks. The next one is highlighted.
 */
export function NextSamplesBox({
  tablets,
  booths,
  ahead,
  canvas,
}: {
  tablets: BoardTablet[];
  booths: BoardBooth[];
  ahead: number;
  canvas: RefObject<HTMLDivElement | null>;
}) {
  const [at, setAt] = useState(savedNextBox);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const rows = tablets
    .filter((t) => t.assessor_code && RUNNING.includes(t.stage))
    .sort((a, b) =>
      (a.assessor_code ?? '').localeCompare(b.assessor_code ?? '', undefined, { numeric: true }),
    );
  if (!rows.length) return null;
  const columns = Array.from({ length: clamp(ahead, 1, MAX_AHEAD) }, (_, i) => i);
  return (
    <div
      ref={box}
      className="ui-board-next"
      role="group"
      aria-label="Next samples"
      // 0..1 of the free space on each axis, so the box always stays wholly on the floor.
      style={{
        left: at.x * 100 + '%',
        top: at.y * 100 + '%',
        transform: `translate(${-at.x * 100}%, ${-at.y * 100}%)`,
      }}
      onPointerDown={(e) => {
        const own = box.current?.getBoundingClientRect();
        if (e.button !== 0 || !own) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { dx: e.clientX - own.left, dy: e.clientY - own.top };
      }}
      onPointerMove={(e) => {
        const area = canvas.current?.getBoundingClientRect();
        const own = box.current?.getBoundingClientRect();
        if (!drag.current || !area || !own) return;
        const free = (pointer: number, start: number, room: number, own: number) =>
          room > own ? clamp((pointer - start) / (room - own), 0, 1) : 0;
        setAt({
          x: free(e.clientX - drag.current.dx, area.left, area.width, own.width),
          y: free(e.clientY - drag.current.dy, area.top, area.height, own.height),
        });
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = undefined;
        try {
          localStorage.setItem(NEXT_BOX_KEY, JSON.stringify(at));
        } catch {
          /* not remembered; it still works */
        }
      }}
    >
      <strong>Next samples</strong>
      <table>
        <thead>
          <tr>
            <th scope="col">Assessor</th>
            <th scope="col">Booth</th>
            <th scope="col">Assessing</th>
            {columns.map((i) => (
              <th key={i} scope="col" className={i === 0 ? 'ui-board-next-now' : undefined}>
                {AHEAD_HEADER[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const { steps, now } = upcoming(t);
            return (
              <tr key={t.terminal_id}>
                <td>{t.assessor_code}</td>
                <td>{booths.find((b) => b.id === t.booth_id)?.label ?? '—'}</td>
                <td>
                  <Slots slots={t.current_samples} />
                </td>
                {columns.map((i) => (
                  <td key={i} className={i === 0 ? 'ui-board-next-now' : undefined}>
                    <Slots slots={steps[i]} />
                    {i === 0 && now && <small> needed now</small>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The booth name typed in place on the floor; Enter or leaving the field saves, Escape cancels. */
export function BoothRename({
  booth,
  taken,
  onSave,
  onDone,
}: {
  booth: BoardBooth;
  taken: (label: string) => boolean;
  onSave: (label: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(booth.label);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = wrap.current?.querySelector('input');
    input?.focus();
    input?.select();
  }, []);
  // Closing removes the field, which can fire one more blur; act on the first ending only.
  const ended = useRef(false);
  const name = value.trim();
  const clash = !!name && name !== booth.label && taken(name);
  const close = (save: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (save && !clash && name !== booth.label) onSave(name);
    onDone();
  };
  return (
    <div
      ref={wrap}
      className="ui-board-rename"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          close(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close(false);
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close(true);
      }}
    >
      <Field
        label="Booth name"
        compact
        value={value}
        onChange={(e) => setValue(e.target.value)}
        hint="Shown on this computer only. Leave empty for the booth's own name."
        error={clash ? 'Another booth already has this name.' : undefined}
      />
    </div>
  );
}

/** The tablets list, the floor canvas and nothing else; data and actions come from the caller. */
export function BoothCanvas({
  room,
  tablets,
  selectedId,
  onSelect,
  onMove,
  onDropTablet,
  onRename,
  view = FLOOR_VIEW,
}: {
  room?: BoardRoom;
  tablets: BoardTablet[];
  selectedId?: string;
  onSelect: (boothId: string) => void;
  onMove: (boothId: string, x: number, y: number) => void;
  onDropTablet: (terminalId: string, boothId: string | null) => void;
  /** Rename a booth in place (double-click or F2); without it booths are renamed elsewhere. */
  onRename?: (boothId: string, label: string) => void;
  view?: FloorView;
}) {
  const [renaming, setRenaming] = useState('');
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
          const running = tablet && RUNNING.includes(tablet.stage) ? upcoming(tablet) : undefined;
          const next = running?.steps[0]?.length ? running.steps[0] : undefined;
          const now = running?.now;
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
                } else if (e.key === 'F2' && onRename) {
                  e.preventDefault();
                  setRenaming(b.id);
                }
              }}
              onDoubleClick={() => onRename && setRenaming(b.id)}
              onPointerDown={(e) => {
                if (e.button !== 0 || renaming === b.id) return;
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
                <span className="ui-board-label">{b.label}</span>
              </div>
              {renaming === b.id && onRename && (
                <BoothRename
                  booth={b}
                  taken={(label) => booths.some((o) => o.id !== b.id && o.label === label)}
                  onSave={(label) => onRename(b.id, label)}
                  onDone={() => setRenaming('')}
                />
              )}
              <div className="ui-board-caption">
                {tablet && <small>{tablet.name}</small>}
                {view.underBooths ? withoutNext(detail) : detail}
                {view.underBooths && next && (
                  <span className="ui-board-booth-next">
                    {now ? 'Needed now: ' : 'Next: '}
                    <Slots slots={next} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {view.table && (
          <NextSamplesBox
            tablets={tablets}
            booths={room?.booths ?? []}
            ahead={view.ahead}
            canvas={canvas}
          />
        )}
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
  /** The booth this row is about, when it has one, so it can be renamed from the list. */
  boothId?: string;
  booth: string;
  tablet: string;
  study: string;
  assessor: string;
  now: string;
  /** Tablet app version, with "update available" when the server has a newer one. */
  app?: string;
  board?: BoardTablet;
}

/**
 * The tablet app version, as "0.1.2 → 0.1.3" when the server offers a newer one; undefined when
 * the tablet has not said (a browser).
 */
export function appText(t: BoardTablet, offered?: string | null) {
  if (!t.app_version) return undefined;
  return t.app_version + (t.app_update_available && offered ? ' → ' + offered : '');
}

/** The List tab's columns staff can show or hide, in table order. Booth always shows. */
export const LIST_COLUMNS = [
  { id: 'tablet', label: 'Tablet' },
  { id: 'study', label: 'Study' },
  { id: 'assessor', label: 'Assessor' },
  { id: 'status', label: 'Status' },
  { id: 'step', label: 'Step' },
  { id: 'title', label: 'Current step' },
  { id: 'loop', label: 'Loop sample' },
  { id: 'now', label: 'Now' },
  { id: 'assessing', label: 'Assessing' },
  { id: 'upcoming', label: 'Upcoming samples' },
  { id: 'app', label: 'Tablet app' },
] as const;
type ListColumn = (typeof LIST_COLUMNS)[number]['id'];
/** What this viewer shows in the List tab: hidden columns, how far ahead, product labels. */
export type ListView = { hidden: ListColumn[]; ahead: number; labels: boolean };
const LIST_VIEW: ListView = { hidden: ['now'], ahead: 3, labels: true };
const LIST_VIEW_KEY = 'sensibilia.run.list-view';

/** This viewer's List tab settings; a per-browser convenience, safe to lose. */
export function useListView() {
  const [view, setView] = useState<ListView>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LIST_VIEW_KEY) ?? '') as Partial<ListView>;
      return {
        hidden: Array.isArray(saved.hidden) ? saved.hidden : LIST_VIEW.hidden,
        ahead: typeof saved.ahead === 'number' ? clamp(saved.ahead, 1, MAX_AHEAD) : LIST_VIEW.ahead,
        labels: typeof saved.labels === 'boolean' ? saved.labels : LIST_VIEW.labels,
      };
    } catch {
      return LIST_VIEW;
    }
  });
  const change = (next: Partial<ListView>) =>
    setView((v) => {
      const merged = { ...v, ...next };
      try {
        localStorage.setItem(LIST_VIEW_KEY, JSON.stringify(merged));
      } catch {
        /* not remembered; it still works */
      }
      return merged;
    });
  return [view, change] as const;
}

/** The "Columns" menu above the list: which columns show, how many samples ahead, labels. */
export function ListViewOptions({
  view,
  onChange,
}: {
  view: ListView;
  onChange: (next: Partial<ListView>) => void;
}) {
  return (
    <Popover label="Columns" align="right">
      {LIST_COLUMNS.map((c) => (
        <Field
          key={c.id}
          kind="checkbox"
          label={c.label}
          checked={!view.hidden.includes(c.id)}
          onChange={(e) =>
            onChange({
              hidden: e.target.checked
                ? view.hidden.filter((h) => h !== c.id)
                : [...view.hidden, c.id],
            })
          }
        />
      ))}
      <Field
        kind="select"
        label="Upcoming samples"
        value={String(view.ahead)}
        onChange={(e) => onChange({ ahead: Number(e.target.value) })}
        options={Array.from({ length: MAX_AHEAD }, (_, i) => ({
          value: String(i + 1),
          label: String(i + 1),
        }))}
      />
      <Field
        kind="checkbox"
        label="Product labels"
        hint="Show the private product label next to each sample code."
        checked={view.labels}
        onChange={(e) => onChange({ labels: e.target.checked })}
      />
    </Popover>
  );
}

const stepText = (t?: BoardTablet) =>
  t?.step_position ? t.step_position + ' of ' + t.step_total : '—';
const loopText = (t?: BoardTablet) =>
  t?.loop_position ? t.loop_position + ' of ' + t.loop_total : '—';
const live = (t?: BoardTablet) => (t && RUNNING.includes(t.stage) ? t : undefined);

/** Every column the List tab can show; `view` picks which. */
function listColumns(
  view: ListView,
  showApp: boolean,
  rename: { id: string; start: (id: string) => void; end: () => void } | undefined,
  onRename: ((boothId: string, name: string) => void) | undefined,
  taken: (boothId: string, name: string) => boolean,
): ColumnDef<Row>[] {
  const shown = (id: ListColumn) => !view.hidden.includes(id);
  const columns: ColumnDef<Row>[] = [
    {
      id: 'booth',
      accessorKey: 'booth',
      header: 'Booth',
      cell: ({ row }) => {
        const r = row.original;
        if (r.boothId && onRename && rename?.id === r.boothId)
          return (
            <BoothRename
              booth={{ id: r.boothId, label: r.booth } as BoardBooth}
              taken={(name) => taken(r.boothId!, name)}
              onSave={(name) => onRename(r.boothId!, name)}
              onDone={rename.end}
            />
          );
        if (!r.boothId || !onRename || !rename) return r.booth;
        const start = () => rename.start(r.boothId!);
        // Like the floor: double-click the name (or press F2 or Enter on it) to rename it here.
        return (
          <span
            className="ui-board-list-name"
            role="button"
            tabIndex={0}
            aria-label={r.booth + ', rename'}
            title="Double-click or press F2 to rename (shown on this computer only)"
            onDoubleClick={start}
            onKeyDown={(e) => {
              if (e.key === 'F2' || e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                start();
              }
            }}
          >
            {r.booth}
          </span>
        );
      },
    },
  ];
  if (shown('tablet')) columns.push({ accessorKey: 'tablet', header: 'Tablet' });
  if (shown('study')) columns.push({ accessorKey: 'study', header: 'Study' });
  if (shown('assessor')) columns.push({ accessorKey: 'assessor', header: 'Assessor' });
  if (shown('status'))
    columns.push({
      id: 'status',
      header: 'Status',
      accessorFn: (r) => STAGE_LABEL[r.board?.stage ?? 'empty'],
    });
  if (shown('step'))
    columns.push({
      id: 'step',
      header: 'Step',
      accessorFn: (r) => live(r.board)?.step_position ?? 0,
      cell: ({ row }) => stepText(live(row.original.board)),
    });
  if (shown('title'))
    columns.push({
      id: 'title',
      header: 'Current step',
      accessorFn: (r) => live(r.board)?.step_title ?? '—',
    });
  if (shown('loop'))
    columns.push({
      id: 'loop',
      header: 'Loop sample',
      accessorFn: (r) => loopText(live(r.board)),
    });
  if (shown('now')) columns.push({ accessorKey: 'now', header: 'Now' });
  if (shown('assessing'))
    columns.push({
      id: 'assessing',
      header: 'Assessing',
      accessorFn: (r) => slotText(live(r.board)?.current_samples),
      cell: ({ row }) => (
        <Slots slots={live(row.original.board)?.current_samples} labels={view.labels} />
      ),
    });
  if (shown('upcoming'))
    for (let i = 0; i < clamp(view.ahead, 1, MAX_AHEAD); i++) {
      const steps = (r: Row) => {
        const t = live(r.board);
        return t ? upcoming(t) : undefined;
      };
      columns.push({
        id: 'next-' + i,
        header: AHEAD_HEADER[i],
        accessorFn: (r) => slotText(steps(r)?.steps[i]),
        cell: ({ row }) => {
          const at = steps(row.original);
          return (
            <span className={i === 0 ? 'ui-board-next-now' : undefined}>
              <Slots slots={at?.steps[i]} labels={view.labels} />
              {i === 0 && at?.now && <small> needed now</small>}
            </span>
          );
        },
      });
    }
  if (shown('app') && showApp) columns.push({ accessorKey: 'app', header: 'Tablet app' });
  return columns;
}

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
  onRename,
  view = LIST_VIEW,
  onViewChange,
}: {
  rows: Row[];
  loading?: boolean;
  busy?: boolean;
  blocked: (t: BoardTablet) => string | undefined;
  startLabel: (t: BoardTablet) => string;
  onStart: (t: BoardTablet) => void;
  onEnd?: (t: BoardTablet) => void;
  onServe?: (t: BoardTablet) => void;
  /** Rename a booth for this viewer; without it the list offers no Rename. */
  onRename?: (boothId: string, name: string) => void;
  view?: ListView;
  onViewChange?: (next: Partial<ListView>) => void;
}) {
  const [renaming, setRenaming] = useState('');
  const latest = useRef(rows);
  latest.current = rows;
  // Shown only when some tablet reports its app version (not in a browser or a Docker install).
  const showApp = rows.some((r) => r.app);
  // Stable while a name is typed, so the board refreshing underneath keeps the field's focus.
  const columns = useMemo(
    () =>
      listColumns(
        view,
        showApp,
        { id: renaming, start: setRenaming, end: () => setRenaming('') },
        onRename,
        (boothId, name) => latest.current.some((r) => r.boothId !== boothId && r.booth === name),
      ),
    [view, showApp, renaming],
  );
  return (
    <DataTable
      id="run-board"
      label="Tablets and booths"
      data={rows}
      columns={columns}
      tools={onViewChange && <ListViewOptions view={view} onChange={onViewChange} />}
      resizable="run-board"
      getRowId={(r) => r.id}
      selectable={false}
      virtualize={false}
      wideActions
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
    [offeredApp, setOfferedApp] = useState<string | null>(null),
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
  const [floorView, setFloorView] = useFloorView();
  const [listView, setListView] = useListView();
  const [names, setName] = useBoothNames();
  const room = rooms.find((r) => roomKey(r) === roomId) ?? rooms[0];
  const selected = room?.booths.find((b) => b.id === selectedId && b.enabled);
  const occupant = (boothId: string) => tablets.find((t) => t.booth_id === boothId);
  /** The room as shown here, under the booth names chosen on this computer. */
  const shownRoom = room && withNames(room, names);
  const shownLabel = (b: BoardBooth) => names[b.id] || b.label;
  /** A name equal to the booth's own label clears the chosen one. */
  const renameBooth = (id: string, name: string) => {
    const own = rooms.flatMap((r) => r.booths).find((b) => b.id === id)?.label;
    setName(id, name === own ? '' : name);
  };

  const load = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([
        client.request<BoardRoom[]>('/rooms'),
        client.request<{
          tablets: BoardTablet[];
          server_time: string;
          offered_app_version?: string | null;
        }>('/booth-board'),
      ]);
      setRooms(r);
      setTablets(b.tablets);
      setServerTime(b.server_time);
      setOfferedApp(b.offered_app_version ?? null);
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
  const selectedName = selected ? names[selected.id] || selected.label : '';
  useEffect(() => setLabel(selectedName), [selected?.id, selectedName]);
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
  const labelTaken = !!shownRoom?.booths.some(
    (b) => b.id !== selected?.id && b.label === label.trim(),
  );

  const count = (...stages: BoardTablet['stage'][]) =>
    tablets.filter((t) => stages.includes(t.stage)).length;
  const running = count('in_progress', 'offline');
  const needSamples = count('serving');
  const waiting = count('completed', 'ended');
  const idle = count('waiting');
  const stillBusy = running + needSamples;
  const selectedStudy = released.find((r) => r.value === versionId);

  const booths = rooms.flatMap((r) => r.booths.filter((b) => b.enabled));
  const boothOf = (id: string | null) => booths.find((b) => b.id === id);
  const rows: Row[] = [
    ...tablets.map((t) => ({
      id: t.terminal_id,
      boothId: boothOf(t.booth_id)?.id,
      booth: boothOf(t.booth_id) ? shownLabel(boothOf(t.booth_id)!) : 'No booth',
      tablet: t.name,
      study: studyOf(t.study_version_id),
      assessor: t.assessor_code ?? '—',
      now: t.detail,
      app: appText(t, offeredApp),
      board: t,
    })),
    ...booths
      .filter((b) => !tablets.some((t) => t.booth_id === b.id))
      .map((b) => ({
        id: 'booth-' + b.id,
        boothId: b.id,
        booth: shownLabel(b),
        tablet: 'No tablet',
        study: '—',
        assessor: '—',
        now: '—',
      })),
  ].sort((a, b) => a.booth.localeCompare(b.booth, undefined, { numeric: true }));

  const floor = (
    <div className="ui-stack">
      <FloorViewOptions view={floorView} onChange={setFloorView} />
      <div className="ui-board">
        <BoothCanvas
          room={shownRoom}
          tablets={tablets}
          selectedId={selected?.id}
          onSelect={setSelectedId}
          onMove={(id, x, y) => void changeBooth(id, { x, y })}
          onDropTablet={link}
          onRename={renameBooth}
          view={floorView}
        />
        {selected && room && (
          <div className="ui-board-panel">
            <SidePanel title={'Booth ' + selectedName} onClose={() => setSelectedId('')}>
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
                      {tablet.app_version && (
                        <p className="ui-hint">
                          Tablet app {tablet.app_version}
                          {tablet.app_update_available &&
                            offeredApp &&
                            ' · ' +
                              offeredApp +
                              ' available: press and hold the top-left corner of the tablet, then' +
                              ' Update tablet app'}
                        </p>
                      )}
                      {!tablet.serving && !!tablet.next_samples.length && (
                        <p>
                          Prepare next:{' '}
                          {tablet.next_samples.map((s) => (
                            <span key={s.sample_id + ':' + s.position}>
                              <span className="ui-sample-code">{s.code}</span> {s.label}{' '}
                            </span>
                          ))}
                        </p>
                      )}
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
                  hint={
                    'Shown on this computer only; the room layout and records keep booth ' +
                    selected.label +
                    '.'
                  }
                  error={labelTaken ? 'Another booth already has this name.' : undefined}
                />
                <span className="ui-inline">
                  <Button
                    disabled={!label.trim() || labelTaken || label.trim() === selectedName}
                    onClick={() => renameBooth(selected.id, label.trim())}
                  >
                    Save name
                  </Button>
                  {names[selected.id] && (
                    <Button onClick={() => renameBooth(selected.id, '')}>
                      Use booth's own name
                    </Button>
                  )}
                </span>
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
                  Removing a booth only hides it from the board. Tablets, assessments and results
                  stay as they are.
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
                onRename={renameBooth}
                view={listView}
                onViewChange={setListView}
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
        Select a booth to start, serve, rename or remove it. Double-click a booth (or press F2) to
        rename it in place.
      </p>
    </section>
  );
}
