import { useState } from 'react';
import type { components } from '../api-schema';
import { Button, Tabs } from '../ui';
import {
  BoothCanvas,
  FloorViewOptions,
  RunTable,
  ServingRequest,
  appText,
  type BoardRoom,
  type BoardTablet,
  type FloorView,
  type ListView,
  type Row,
} from '../researcher/RunStudy';
import { StepMenuContent } from '../researcher/StepMenu';
import { StaffCorner } from '../assessor/StaffCorner';
import { HandoverReady } from '../assessor/Assessor';

type Method = components['schemas']['TestTypeRead'];

const booths = [
  { label: '1', x: 0.2, y: 0.2 },
  { label: '2', x: 0.45, y: 0.2 },
  { label: '3', x: 0.7, y: 0.2 },
  { label: '4', x: 0.2, y: 0.6 },
  { label: '5', x: 0.45, y: 0.6 },
  { label: '6', x: 0.7, y: 0.6 },
];
const room: BoardRoom = {
  id: 'room-version',
  room_id: 'room',
  revision: 1,
  expected_revision: 1,
  name: 'Laboratory',
  rows: 20,
  columns: 20,
  created_at: '2026-10-20T09:00:00Z',
  booths: booths.map((b, i) => ({
    id: 'booth-' + b.label,
    label: b.label,
    row: 1,
    column: i + 1,
    enabled: true,
    x: b.x,
    y: b.y,
  })),
};
const tablet = (
  n: number,
  boothLabel: string | null,
  stage: BoardTablet['stage'],
  detail: string,
): BoardTablet => ({
  terminal_id: 'tablet-' + n,
  name: 'Tablet 0' + n,
  revision: 1,
  booth_id: boothLabel ? 'booth-' + boothLabel : null,
  session_id: stage === 'waiting' ? null : 'session-' + n,
  study_version_id: stage === 'waiting' ? null : 'version-1',
  assessor_code: stage === 'waiting' ? null : 'A00' + n,
  stage,
  detail,
  next_samples: [],
  current_samples: [],
  upcoming_samples: [],
  app_version: n === 1 ? '0.1.2' : '0.1.3',
  app_update_available: n === 1,
});
const slot = (n: number, code: string, label: string) => ({
  sample_id: 's' + n,
  code,
  label: 'Product ' + label,
  position: 1,
});
const tablets: BoardTablet[] = [
  {
    ...tablet(1, '1', 'serving', 'Needs samples 731 204'),
    upcoming_samples: [[slot(3, '482', 'C')], [slot(4, '519', 'D')]],
  },
  {
    ...tablet(
      2,
      '2',
      'in_progress',
      'Test in progress, step 9 of 26 (sample 2 of 5) · next sample 482',
    ),
    next_samples: [slot(3, '482', 'C')],
    step_position: 9,
    step_total: 26,
    step_title: 'Liking',
    loop_position: 2,
    loop_total: 5,
    current_samples: [slot(1, '731', 'A')],
    upcoming_samples: [
      [slot(3, '482', 'C')],
      [slot(4, '519', 'D')],
      [slot(5, '640', 'E')],
      [slot(2, '204', 'B')],
    ],
  },
  tablet(3, '3', 'completed', 'Has completed the test'),
  tablet(4, '4', 'waiting', 'Waiting for assignment'),
  {
    ...tablet(5, '5', 'offline', 'No contact for 3 min'),
    current_samples: [slot(4, '519', 'D')],
    upcoming_samples: [[slot(2, '204', 'B')]],
  },
  tablet(6, null, 'waiting', 'Waiting for assignment'),
];

const withRequest = (state: string, revision: number): BoardTablet => ({
  ...tablets[0],
  serving: {
    assignment_id: 'assignment-1',
    signal: {
      id: 'signal-1',
      assignment_id: 'assignment-1',
      step_id: 'gate',
      occurrence_id: 'study',
      state,
      revision,
      requested_at: '2026-10-20T09:00:00Z',
      updated_at: '2026-10-20T09:00:30Z',
      actor: 'Tablet',
    },
    slots: [
      { sample_id: 's1', code: '731', label: 'Product A', position: 1 },
      { sample_id: 's2', code: '204', label: 'Product B', position: 2 },
    ],
    preparation: 'One portion each, room temperature',
  },
});
// The serving tablet on the floor carries its open request, as the board reports it.
tablets[0] = withRequest('ready', 1);

function RequestDemo() {
  const [state, setState] = useState('ready');
  return (
    <div className="ui-board-panel">
      <ServingRequest
        tablet={withRequest(state, 1)}
        serverTime="2026-10-20T09:01:05Z"
        onAct={(action) => setState(action)}
      />
      <Button compact onClick={() => setState('ready')}>
        Start over
      </Button>
      <Button compact onClick={() => setState('help')}>
        Assessor asks for help
      </Button>
    </div>
  );
}

function Floor({ populated, table = false }: { populated: boolean; table?: boolean }) {
  const [view, setView] = useState<FloorView>({ underBooths: true, table, ahead: 3 });
  const [labels, setLabels] = useState<Record<string, string>>({});
  const shown = populated
    ? { ...room, booths: room.booths.map((b) => ({ ...b, label: labels[b.id] ?? b.label })) }
    : undefined;
  return (
    <div className="ui-stack">
      <FloorViewOptions view={view} onChange={(next) => setView((v) => ({ ...v, ...next }))} />
      <div className="ui-board">
        <BoothCanvas
          room={shown}
          tablets={populated ? tablets : []}
          selectedId={populated ? 'booth-2' : undefined}
          onSelect={() => {}}
          onMove={() => {}}
          onDropTablet={() => {}}
          onRename={(id, label) => setLabels((l) => ({ ...l, [id]: label }))}
          view={view}
        />
      </div>
    </div>
  );
}
const canvas = (populated: boolean) => <Floor populated={populated} />;

const rows: Row[] = [
  ...tablets
    .filter((t) => t.booth_id)
    .map((t) => ({
      id: t.terminal_id,
      boothId: t.booth_id!,
      booth: 'Booth ' + t.booth_id!.replace('booth-', ''),
      tablet: t.name,
      study: t.study_version_id ? 'Oat drink liking 2026 · v2' : '—',
      assessor: t.assessor_code ?? '—',
      now: t.detail,
      app: appText(t, '0.1.3'),
      board: t,
    })),
  {
    id: 'empty-booth',
    boothId: 'booth-7',
    booth: 'Booth 7',
    tablet: 'No tablet',
    study: '—',
    assessor: '—',
    now: '—',
  },
];

/** The List tab with its column menu and in-place booth names, as on the page. */
function ListDemo() {
  const [view, setView] = useState<ListView>({ hidden: ['now'], ahead: 3, labels: true });
  const [names, setNames] = useState<Record<string, string>>({});
  return (
    <RunTable
      rows={rows.map((r) => ({ ...r, booth: (r.boothId && names[r.boothId]) || r.booth }))}
      blocked={() => undefined}
      startLabel={startLabel}
      onStart={() => {}}
      onEnd={() => {}}
      onServe={() => {}}
      onRename={(id, name) => setNames((n) => ({ ...n, [id]: name }))}
      view={view}
      onViewChange={(next) => setView((v) => ({ ...v, ...next }))}
    />
  );
}
const startLabel = (t: BoardTablet) => (t.session_id ? 'Next assessor' : 'Start first assessment');

const methods = [
  { id: 'hedonic-9-v1', name: 'Nine-point hedonic acceptance' },
  { id: 'cata-v1', name: 'CATA — Check all that apply' },
] as unknown as Method[];

export function RunStudyGallery() {
  const [tab, setTab] = useState('stages');
  return (
    <section id="run-study" className="ui-gallery-section ui-stack" aria-label="Run study fixtures">
      <Tabs
        label="Run study fixture states"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'stages', label: 'Every stage', content: canvas(true) },
          { id: 'table', label: 'Sample table', content: <Floor populated table /> },
          { id: 'empty', label: 'No booths', content: canvas(false) },
          { id: 'request', label: 'Serving request', content: <RequestDemo /> },
          {
            id: 'list',
            label: 'List',
            content: <ListDemo />,
          },
          {
            id: 'list-empty',
            label: 'List empty',
            content: (
              <RunTable
                rows={[]}
                blocked={() => undefined}
                startLabel={startLabel}
                onStart={() => {}}
              />
            ),
          },
          {
            id: 'blocked',
            label: 'Name missing',
            content: (
              <RunTable
                rows={rows}
                blocked={() => 'Enter your name first'}
                startLabel={startLabel}
                onStart={() => {}}
              />
            ),
          },
          {
            id: 'handover',
            label: 'Handover',
            content: (
              <HandoverReady
                summary={{
                  assessor: 'A003',
                  study: 'Oat drink liking 2026',
                  version: '2 (released)',
                  booth: 'Booth 3',
                  language: 'en',
                }}
                onConfirm={() => {}}
              />
            ),
          },
          {
            id: 'handover-update',
            label: 'Handover, app update',
            content: (
              <HandoverReady
                summary={{
                  assessor: 'A004',
                  study: 'Oat drink liking 2026',
                  version: '2 (released)',
                  booth: 'Booth 3',
                  language: 'en',
                }}
                onConfirm={() => {}}
                offeredUpdate="0.1.3"
              />
            ),
          },
          {
            id: 'staff',
            label: 'Staff panel',
            content: (
              <div className="ui-preview ui-stack">
                <StaffCorner defaultOpen>
                  <p>Version 2 · en · A003</p>
                  <p role="status">Synchronised</p>
                </StaffCorner>
              </div>
            ),
          },
          {
            id: 'menu',
            label: 'Add step menu',
            content: (
              <div className="ui-stack">
                <StepMenuContent
                  methods={methods}
                  onMethod={() => {}}
                  onKind={() => {}}
                  onBlock={() => {}}
                />
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
