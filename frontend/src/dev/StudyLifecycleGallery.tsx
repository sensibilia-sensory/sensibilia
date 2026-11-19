import { useState } from 'react';
import { ConfirmButton, DataTable, Field, Tabs } from '../ui';
import type { Client, Study } from '../researcher/client';
import { ArchivedStudies, LifecyclePanel, studyColumns } from '../researcher/StudyLifecycle';
import { SampleBattery, emptyBattery, type Battery } from '../researcher/SampleBattery';
import { themeOptions } from '../researcher/theme';

const study = (title: string, patch: Partial<Study>): Study =>
  ({
    id: '50000000-0000-4000-8000-000000000001',
    title,
    description: '',
    status: 'active',
    created_at: '2026-10-19T08:00:00Z',
    closed_at: null,
    archived_at: null,
    open_assessments: 0,
    versions: [{ version_number: 1, published_at: '2026-10-19T09:00:00Z' }],
    ...patch,
  }) as unknown as Study;
const busyStudy = study('Four cheeses', { open_assessments: 2 });
const rows = [
  busyStudy,
  study('Oat drink liking 2026', { id: '50000000-0000-4000-8000-000000000002' }),
  study('Yoghurt pilot', {
    id: '50000000-0000-4000-8000-000000000003',
    status: 'closed',
    closed_at: '2026-10-18T09:00:00Z',
  }),
];
// Galleries never call the server; the panel only uses the client when a button is pressed.
const client = {
  studies: async () => [
    study('Cider tasting 2025', {
      status: 'closed',
      closed_at: '2026-06-01T09:00:00Z',
      archived_at: '2026-06-02T09:00:00Z',
    }),
  ],
  studyAction: async () => busyStudy,
} as unknown as Client;
const sampleBattery: Battery = {
  samplesText: 'C1, Cheddar\nC2, Gouda\nC3, Brie\nC4, Edam',
  methods: [
    { key: 'm1', methodId: 'hedonic-9-v1', text: 'Overall liking' },
    { key: 'm2', methodId: 'cata-v1', text: 'Salty\nCreamy\nSharp' },
  ],
};
const methods = [
  { id: 'hedonic-9-v1', name: 'Nine-point hedonic acceptance' },
  { id: 'cata-v1', name: 'CATA — Check all that apply' },
] as unknown as Parameters<typeof SampleBattery>[0]['methods'];

export function StudyLifecycleGallery() {
  const [tab, setTab] = useState('studies');
  const [battery, setBattery] = useState<Battery>(sampleBattery);
  const [theme, setTheme] = useState('system');
  return (
    <section
      id="study-lifecycle"
      className="ui-gallery-section ui-stack"
      aria-label="Study lifecycle fixtures"
    >
      <Tabs
        label="Study lifecycle fixture states"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'studies',
            label: 'Studies table',
            content: (
              <DataTable
                id="lifecycle-studies"
                label="Studies fixture"
                data={rows}
                columns={studyColumns(true)}
                getRowId={(s) => s.id}
                virtualize={false}
              />
            ),
          },
          {
            id: 'close',
            label: 'Close panel',
            content: (
              <LifecyclePanel
                client={client}
                study={busyStudy}
                mode="close"
                onDone={() => {}}
                onClose={() => {}}
              />
            ),
          },
          {
            id: 'archive-blocked',
            label: 'Archive blocked',
            content: (
              <LifecyclePanel
                client={client}
                study={busyStudy}
                mode="archive"
                onDone={() => {}}
                onClose={() => {}}
              />
            ),
          },
          {
            id: 'archive',
            label: 'Archive panel',
            content: (
              <LifecyclePanel
                client={client}
                study={rows[1]}
                mode="archive"
                onDone={() => {}}
                onClose={() => {}}
              />
            ),
          },
          {
            id: 'archived',
            label: 'Archive view',
            content: <ArchivedStudies client={client} open={() => {}} />,
          },
          {
            id: 'end',
            label: 'End assessment',
            content: (
              <ConfirmButton compact confirmLabel="End now" onConfirm={() => {}}>
                End assessment
              </ConfirmButton>
            ),
          },
          {
            id: 'battery',
            label: 'Sample battery',
            content: (
              <div className="ui-stack">
                <SampleBattery
                  value={battery}
                  methods={methods}
                  disabled={false}
                  onChange={setBattery}
                />
                <SampleBattery
                  value={emptyBattery}
                  methods={methods}
                  disabled={false}
                  onChange={() => {}}
                />
              </div>
            ),
          },
          {
            id: 'theme',
            label: 'Theme menu',
            content: (
              <Field
                kind="select"
                stacked
                label="Theme"
                value={theme}
                options={themeOptions}
                onChange={(e) => setTheme(e.target.value)}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
