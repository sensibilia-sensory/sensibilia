import { saveBlob } from './download';
import { useEffect, useRef, useState } from 'react';
import type { components } from '../api-schema';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, DataTable, Field, PropertyGrid, SidePanel, Toolbar } from '../ui';
import type { Client } from './client';
export type Snapshot = components['schemas']['SnapshotRead'];
export type Job = components['schemas']['JobRead'];
const short = (value: string) => <span title={value}>{value.slice(0, 12)}</span>;
const snapshotColumns: ColumnDef<Snapshot>[] = [
  { id: 'id', header: 'ID', accessorFn: (r) => r.id, cell: ({ row }) => short(row.original.id) },
  { accessorKey: 'label', header: 'Label' },
  {
    id: 'scope',
    header: 'Version scope',
    accessorFn: (r) => r.study_version_id ?? 'All published',
    cell: ({ row }) =>
      row.original.study_version_id ? short(row.original.study_version_id) : 'All published',
  },
  { id: 'history', header: 'History', accessorFn: (r) => r.manifest.history },
  { id: 'rows', header: 'Rows', accessorFn: (r) => r.manifest.row_count },
  { id: 'sessions', header: 'Sessions', accessorFn: (r) => r.manifest.session_count },
  { accessorKey: 'staff_name', header: 'Staff' },
  { accessorKey: 'created_at', header: 'Created' },
  {
    id: 'hash',
    header: 'Dataset SHA256',
    accessorFn: (r) => r.manifest.dataset_sha256,
    cell: ({ row }) => short(row.original.manifest.dataset_sha256),
  },
];
const jobColumns: ColumnDef<Job>[] = [
  { id: 'id', header: 'ID', accessorFn: (r) => r.id, cell: ({ row }) => short(row.original.id) },
  { accessorKey: 'recipe', header: 'Recipe' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'staff_name', header: 'Staff' },
  { accessorKey: 'created_at', header: 'Created' },
  { accessorKey: 'finished_at', header: 'Finished' },
  {
    id: 'result',
    header: 'Result SHA256',
    accessorFn: (r) => r.result_sha256 ?? '—',
    cell: ({ row }) => (row.original.result_sha256 ? short(row.original.result_sha256) : '—'),
  },
  { accessorKey: 'error', header: 'Detail' },
];
export function SnapshotTable({
  rows,
  loading = false,
  error = '',
  onRetry,
  onInspect,
  disabled = false,
  id = 'dataset-snapshots',
}: {
  rows: Snapshot[];
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  onInspect?: (row: Snapshot) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="ui-stack">
      {loading && (
        <p role="status" aria-busy="true">
          Loading snapshots…
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <Button onClick={onRetry}>Retry snapshots</Button>
        </p>
      )}
      <DataTable
        id={id}
        label="Dataset snapshots"
        data={rows}
        columns={snapshotColumns}
        getRowId={(r) => r.id}
        selectable={false}
        emptyText={loading ? 'Loading snapshots…' : 'No snapshots. Freeze a published dataset.'}
        rowActions={
          onInspect
            ? (r) => (
                <Button compact disabled={disabled} onClick={() => onInspect(r)}>
                  Inspect
                </Button>
              )
            : undefined
        }
      />
    </div>
  );
}
export function JobTable({
  rows,
  loading = false,
  error = '',
  onRetry,
  onCancel,
  onResult,
  disabled = false,
  id = 'analysis-jobs',
}: {
  rows: Job[];
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  onCancel?: (row: Job) => void;
  onResult?: (row: Job) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="ui-stack">
      {loading && (
        <p role="status" aria-busy="true">
          Loading jobs…
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <Button onClick={onRetry}>Retry jobs</Button>
        </p>
      )}
      <DataTable
        id={id}
        label="Snapshot analysis jobs"
        data={rows}
        columns={jobColumns}
        getRowId={(r) => r.id}
        selectable={false}
        emptyText={loading ? 'Loading jobs…' : 'No jobs for this snapshot.'}
        rowActions={
          onCancel || onResult
            ? (r) =>
                onCancel && ['queued', 'running'].includes(r.status) ? (
                  <Button compact disabled={disabled} onClick={() => onCancel(r)}>
                    Cancel job
                  </Button>
                ) : onResult ? (
                  <Button compact disabled={disabled || !r.result} onClick={() => onResult(r)}>
                    Result JSON
                  </Button>
                ) : null
            : undefined
        }
      />
    </div>
  );
}
export function SnapshotCreation({
  label,
  staff,
  scope,
  history,
  published,
  busy,
  loading,
  onLabel,
  onStaff,
  onFreeze,
  onRefresh,
}: {
  label: string;
  staff: string;
  scope: string;
  history: 'all' | 'current';
  published: boolean;
  busy: boolean;
  loading: boolean;
  onLabel: (value: string) => void;
  onStaff: (value: string) => void;
  onFreeze: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <Toolbar
        label="Snapshot actions"
        secondary={
          <Button disabled={loading || busy} onClick={onRefresh}>
            Refresh snapshots
          </Button>
        }
      >
        <Button
          variant="primary"
          disabled={busy || !published || !label.trim() || !staff.trim()}
          onClick={onFreeze}
        >
          Freeze dataset snapshot
        </Button>
      </Toolbar>
      <PropertyGrid
        sections={[
          {
            title: 'Snapshot creation',
            defaultOpen: true,
            children: (
              <>
                <Field
                  label="Snapshot label"
                  value={label}
                  disabled={busy}
                  onChange={(e) => onLabel(e.target.value)}
                />
                <Field
                  label="Snapshot staff name"
                  value={staff}
                  disabled={busy}
                  onChange={(e) => onStaff(e.target.value)}
                />
                <p>
                  Scope: {scope || 'All published versions'} · History: {history}. Freezes one
                  consistent cut; later collection does not alter it.
                </p>
              </>
            ),
          },
        ]}
      />
      {!published && (
        <p>Release this version before freezing its dataset, or select all published versions.</p>
      )}
    </>
  );
}

export function Snapshots({
  client,
  studyId,
  scope,
  history,
  active,
  published,
}: {
  client: Client;
  studyId: string;
  scope: string;
  history: 'all' | 'current';
  active: boolean;
  published: boolean;
}) {
  const [rows, setRows] = useState<Snapshot[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [staff, setStaff] = useState(''),
    [label, setLabel] = useState(''),
    [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0),
    [jobOffset, setJobOffset] = useState(0);
  const [selected, setSelected] = useState<Snapshot | null>(null),
    [manifest, setManifest] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]),
    [jobsLoading, setJobsLoading] = useState(false),
    [jobsError, setJobsError] = useState('');
  const generation = useRef(0),
    jobGeneration = useRef(0);
  const load = async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    setRows([]);
    try {
      const data = await client.snapshots(studyId, offset);
      if (current === generation.current) setRows(data);
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : 'Snapshot read failed');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  const loadJobs = async () => {
    if (!selected) return;
    const current = ++jobGeneration.current;
    setJobsLoading(true);
    setJobsError('');
    setJobs([]);
    try {
      const data = await client.snapshotJobs(studyId, selected.id, jobOffset);
      if (current === jobGeneration.current) setJobs(data);
    } catch (e) {
      if (current === jobGeneration.current)
        setJobsError(e instanceof Error ? e.message : 'Job read failed');
    } finally {
      if (current === jobGeneration.current) setJobsLoading(false);
    }
  };
  useEffect(() => {
    if (active) void load();
    return () => {
      generation.current++;
    };
  }, [studyId, offset, active]);
  useEffect(() => {
    if (active) void loadJobs();
    return () => {
      jobGeneration.current++;
    };
  }, [studyId, selected?.id, jobOffset, active]);
  useEffect(() => {
    setSelected(null);
    setJobs([]);
    setManifest(false);
    setOffset(0);
    setJobOffset(0);
  }, [studyId]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Snapshot action failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ui-stack" aria-label="Snapshots and analysis">
      <SnapshotCreation
        label={label}
        staff={staff}
        scope={scope}
        history={history}
        published={published}
        busy={busy}
        loading={loading}
        onLabel={setLabel}
        onStaff={setStaff}
        onRefresh={() => void load()}
        onFreeze={() =>
          void perform(async () => {
            const item = await client.createSnapshot(studyId, {
              label,
              staff_name: staff,
              study_version_id: scope || null,
              history,
            });
            setSelected(item);
            setJobOffset(0);
            setOffset(0);
            await load();
          })
        }
      />
      <SnapshotTable
        rows={rows}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        disabled={busy}
        onInspect={(row) => {
          setSelected(row);
          setJobOffset(0);
          setManifest(true);
        }}
      />
      <Toolbar
        label="Snapshot pages"
        secondary={
          <Button
            disabled={loading || busy || rows.length < 50}
            onClick={() => setOffset(offset + 50)}
          >
            Next snapshots
          </Button>
        }
      >
        <Button
          disabled={loading || busy || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous snapshots
        </Button>
      </Toolbar>
      {selected && (
        <>
          <p>
            Snapshot: {selected.label} · {selected.id} · Dataset SHA256:{' '}
            {selected.manifest.dataset_sha256}
          </p>
          <Toolbar label="Frozen dataset downloads">
            {(['archive', 'long', 'wide'] as const).map((format) => (
              <Button
                key={format}
                disabled={busy}
                onClick={() =>
                  void perform(async () =>
                    saveBlob(
                      await client.snapshotExport(studyId, selected.id, format),
                      selected.id + (format === 'archive' ? '.zip' : '-' + format + '.csv'),
                    ),
                  )
                }
              >
                {format === 'archive' ? 'Archive' : format === 'long' ? 'Long CSV' : 'Wide CSV'}
              </Button>
            ))}
          </Toolbar>
          <Toolbar
            label="Analysis actions"
            secondary={
              <Button disabled={jobsLoading || busy} onClick={() => void loadJobs()}>
                Refresh jobs
              </Button>
            }
          >
            <Button
              disabled={busy || !staff.trim()}
              onClick={() =>
                void perform(async () => {
                  await client.queueAnalysis(studyId, selected.id, staff);
                  setJobOffset(0);
                  await loadJobs();
                })
              }
            >
              Queue ledger census
            </Button>
            <Button disabled={busy} onClick={() => setManifest(true)}>
              View manifest
            </Button>
          </Toolbar>
          <p>
            Ledger census counts projected row kinds and states. It performs no rating scoring or
            statistical inference. Jobs wait for the laboratory analysis worker.
          </p>
          <JobTable
            rows={jobs}
            loading={jobsLoading}
            error={jobsError}
            disabled={busy || !staff.trim()}
            onRetry={() => void loadJobs()}
            onCancel={(job) =>
              void perform(async () => {
                await client.cancelAnalysis(studyId, selected.id, job.id, staff);
                await loadJobs();
              })
            }
            onResult={(job) =>
              saveBlob(
                new Blob([JSON.stringify(job, null, 2) + '\n'], { type: 'application/json' }),
                job.id + '-result.json',
              )
            }
          />
          <Toolbar
            label="Job pages"
            secondary={
              <Button
                disabled={jobsLoading || busy || jobs.length < 50}
                onClick={() => setJobOffset(jobOffset + 50)}
              >
                Next jobs
              </Button>
            }
          >
            <Button
              disabled={jobsLoading || busy || jobOffset === 0}
              onClick={() => setJobOffset(Math.max(0, jobOffset - 50))}
            >
              Previous jobs
            </Button>
          </Toolbar>
        </>
      )}
      {manifest && selected && (
        <SidePanel title="Frozen dataset manifest" onClose={() => setManifest(false)}>
          <p>
            {selected.id} · {selected.label} · {selected.staff_name} · {selected.created_at}
          </p>
          <p>Manifest SHA256: {selected.manifest_sha256}</p>
          <p>{selected.manifest.exclusion_policy}</p>
          <p>{selected.manifest.state_policy}</p>
          <DataTable
            id="snapshot-manifest-files"
            label="Snapshot checksums"
            data={Object.entries(selected.manifest.files).map(([name, value]) => ({
              name,
              ...value,
            }))}
            getRowId={(r) => r.name}
            selectable={false}
            columns={[
              { accessorKey: 'name', header: 'File' },
              { accessorKey: 'byte_size', header: 'Bytes' },
              { accessorKey: 'sha256', header: 'SHA256' },
            ]}
          />
          <DataTable
            id="snapshot-event-counts"
            label="Snapshot atomic counts"
            data={Object.entries(selected.manifest.event_counts).map(([name, count]) => ({
              name,
              count,
            }))}
            getRowId={(r) => r.name}
            selectable={false}
            columns={[
              { accessorKey: 'name', header: 'Ledger' },
              { accessorKey: 'count', header: 'Atomic records' },
            ]}
          />
          <Button
            onClick={() =>
              saveBlob(
                new Blob([JSON.stringify(selected.manifest, null, 2) + '\n'], {
                  type: 'application/json',
                }),
                selected.id + '-manifest.json',
              )
            }
          >
            Download manifest JSON
          </Button>
        </SidePanel>
      )}
    </section>
  );
}
