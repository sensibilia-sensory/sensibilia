import { useState } from 'react';
import type { components } from '../api-schema';
import { Button, Tabs } from '../ui';
import {
  BoothCanvas,
  RunTable,
  ServingRequest,
  type BoardRoom,
  type BoardTablet,
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
});
const tablets: BoardTablet[] = [
  tablet(1, '1', 'serving', 'Needs samples 731 204'),
  {
    ...tablet(2, '2', 'in_progress', 'Test in progress, step 4 of 12 · next sample 482'),
    next_samples: [{ sample_id: 's3', code: '482', label: 'Product C', position: 2 }],
  },
  tablet(3, '3', 'completed', 'Has completed the test'),
  tablet(4, '4', 'waiting', 'Waiting for assignment'),
  tablet(5, '5', 'offline', 'No contact for 3 min'),
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

const canvas = (populated: boolean) => (
  <div className="ui-board">
    <BoothCanvas
      room={populated ? room : undefined}
      tablets={populated ? tablets : []}
      selectedId={populated ? 'booth-2' : undefined}
      onSelect={() => {}}
      onMove={() => {}}
      onDropTablet={() => {}}
    />
  </div>
);

const rows: Row[] = [
  ...tablets
    .filter((t) => t.booth_id)
    .map((t) => ({
      id: t.terminal_id,
      booth: 'Booth ' + t.booth_id!.replace('booth-', ''),
      tablet: t.name,
      study: t.study_version_id ? 'Oat drink liking 2026 · v2' : '—',
      assessor: t.assessor_code ?? '—',
      now: t.detail,
      board: t,
    })),
  { id: 'empty-booth', booth: 'Booth 7', tablet: 'No tablet', study: '—', assessor: '—', now: '—' },
];
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
          { id: 'empty', label: 'No booths', content: canvas(false) },
          { id: 'request', label: 'Serving request', content: <RequestDemo /> },
          {
            id: 'list',
            label: 'List',
            content: (
              <RunTable
                rows={rows}
                blocked={() => undefined}
                startLabel={startLabel}
                onStart={() => {}}
                onEnd={() => {}}
                onServe={() => {}}
              />
            ),
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
