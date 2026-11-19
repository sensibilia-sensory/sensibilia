import { useState } from 'react';
import { Tabs } from '../ui';
import {
  SnapshotCreation,
  SnapshotTable,
  JobTable,
  type Snapshot,
  type Job,
} from '../researcher/Snapshots';
const rows: Snapshot[] = Array.from({ length: 17 }, (_, i) => ({
  id: 'snapshot-' + i,
  study_id: 'fixture-study',
  study_version_id: 'published-v1',
  label: 'Synthetic cut ' + i,
  staff_name: 'Scientist',
  principal: 'researcher-key:fixture',
  created_at: '2026-10-14T12:00:00Z',
  manifest_sha256: 'd'.repeat(64),
  manifest: {
    snapshot_id: 'snapshot-' + i,
    label: 'Synthetic cut ' + i,
    staff_name: 'Scientist',
    principal: 'researcher-key:fixture',
    schema_version: 1,
    study_id: 'fixture-study',
    study_version_id: 'published-v1',
    created_at: '2026-10-14T12:00:00Z',
    history: 'all',
    row_count: 69,
    session_count: 1,
    event_counts: {
      responses: 12,
      form_events: 16,
      path_events: 35,
      temporal_runs: 0,
      temporal_events: 0,
    },
    row_kinds: { answer: 69 },
    states: { rated: 69 },
    dataset_sha256: 'a'.repeat(64),
    files: {},
    state_policy: 'Original tagged states',
    exclusion_policy: 'No exclusions',
    limitations: [],
  },
}));
const jobs: Job[] = Array.from({ length: 17 }, (_, i) => ({
  id: 'job-' + i,
  snapshot_id: 'snapshot-0',
  recipe: 'ledger-state-census-v1',
  recipe_sha256: 'b'.repeat(64),
  staff_name: 'Scientist',
  principal: 'researcher-key:fixture',
  created_at: '2026-10-14T12:00:00Z',
  status: ['queued', 'running', 'succeeded', 'failed', 'cancelled'][i % 5] as Job['status'],
  started_at: null,
  finished_at: null,
  image: null,
  result: i % 5 === 2 ? { row_count: 69 } : null,
  result_sha256: i % 5 === 2 ? 'c'.repeat(64) : null,
  error: i % 5 === 3 ? 'Runner unavailable' : null,
}));
export function SnapshotsGallery() {
  const [state, setState] = useState('readonly');
  const [label, setLabel] = useState('Synthetic cut'),
    [staff, setStaff] = useState('Scientist'),
    [notice, setNotice] = useState('');
  return (
    <section
      id="snapshots-gallery"
      className="ui-gallery-section ui-stack"
      aria-label="Snapshot fixtures"
    >
      <SnapshotCreation
        label={label}
        staff={staff}
        scope="published-v1"
        history="all"
        published={state !== 'empty'}
        busy={state === 'loading'}
        loading={state === 'loading'}
        onLabel={setLabel}
        onStaff={setStaff}
        onRefresh={() => setState('readonly')}
        onFreeze={() => setNotice('Fixture cut: ' + label + ' · ' + staff)}
      />
      {notice && <p role="status">{notice}</p>}
      <Tabs
        label="Snapshot states"
        value={state}
        onChange={setState}
        tabs={['readonly', 'empty', 'loading', 'error', 'jobs'].map((id) => ({
          id,
          label: {
            readonly: 'Read-only',
            empty: 'Empty',
            loading: 'Loading',
            error: 'Error',
            jobs: 'Jobs',
          }[id]!,
          content:
            id === 'jobs' ? (
              <JobTable
                id={'gallery-jobs-' + id}
                rows={jobs}
                onRetry={() => setState('readonly')}
              />
            ) : (
              <SnapshotTable
                id={'gallery-snapshots-' + id}
                rows={id === 'readonly' ? rows : []}
                loading={id === 'loading'}
                error={id === 'error' ? 'Cannot reach laboratory server.' : ''}
                onRetry={() => setState('readonly')}
              />
            ),
        }))}
      />
    </section>
  );
}
