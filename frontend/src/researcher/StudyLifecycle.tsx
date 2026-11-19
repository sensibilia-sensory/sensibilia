import { useEffect, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, DataTable, Field, SidePanel, Toolbar } from '../ui';
import { statusLabel } from '../shared/lexicon';
import type { Client, Study } from './client';

export type LifecycleMode = 'close' | 'archive';

export const studyColumns = (showOpen: boolean): ColumnDef<Study>[] => [
  { accessorKey: 'title', header: 'Title' },
  {
    id: 'state',
    header: 'Status',
    accessorFn: (s) => (s.archived_at ? 'Archived' : statusLabel(s.status)),
  },
  ...(showOpen
    ? [{ accessorKey: 'open_assessments', header: 'In progress' } as ColumnDef<Study>]
    : []),
  {
    id: 'version',
    header: 'Draft / latest',
    accessorFn: (s) =>
      s.versions.find((v) => !v.published_at)?.version_number ??
      s.versions.at(-1)?.version_number ??
      '—',
  },
  { accessorKey: 'created_at', header: 'Created' },
];

/** Close or archive one study. Nothing is deleted; both can be undone. */
export function LifecyclePanel({
  client,
  study,
  mode,
  onDone,
  onClose,
}: {
  client: Client;
  study: Study;
  mode: LifecycleMode;
  onDone: () => void;
  onClose: () => void;
}) {
  const open = study.open_assessments;
  const [endOpen, setEndOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setEndOpen(false);
    setError('');
  }, [study.id, mode]);
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'close')
        await client.studyAction(study.id, 'close', { end_open_assessments: endOpen });
      else await client.studyAction(study.id, 'archive');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change was not saved.');
    } finally {
      setBusy(false);
    }
  };
  const title = (mode === 'close' ? 'Close ' : 'Archive ') + study.title;
  return (
    <SidePanel title={title} onClose={onClose}>
      <div className="ui-stack">
        {mode === 'close' ? (
          <>
            <p>
              Closing stops new assessments from starting. Nothing is deleted, and results and
              export stay available. You can reopen the study later.
            </p>
            {open > 0 && (
              <>
                <p role="status">
                  {open} {open === 1 ? 'assessment is' : 'assessments are'} still in progress. They
                  may finish normally.
                </p>
                <Field
                  kind="checkbox"
                  label={`End the ${open} ${open === 1 ? 'assessment' : 'assessments'} in progress now`}
                  checked={endOpen}
                  disabled={busy}
                  onChange={(e) => setEndOpen(e.target.checked)}
                  hint="An ended assessment accepts no further answers. Answers a tablet already recorded are still accepted when it reconnects."
                />
              </>
            )}
          </>
        ) : open > 0 ? (
          <p role="status">
            {open} {open === 1 ? 'assessment is' : 'assessments are'} still in progress. End or
            finish {open === 1 ? 'it' : 'them'} first: close the study and choose to end them, or
            use End assessment on Run study.
          </p>
        ) : (
          <p>
            Archiving removes this study from the Studies list, Run study and the pickers. Nothing
            is deleted: find it under Archive, where results and export stay available, and use
            Restore to bring it back.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="ui-inline">
          <Button
            variant="primary"
            disabled={busy || (mode === 'archive' && open > 0)}
            onClick={() => void run()}
          >
            {mode === 'close' ? 'Close study' : 'Archive study'}
          </Button>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

/** Archived studies: read-only, with Restore. */
export function ArchivedStudies({
  client,
  open,
}: {
  client: Client;
  open: (study: Study) => void;
}) {
  const [data, setData] = useState<Study[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = () => {
    setBusy(true);
    setError('');
    client
      .studies('', 0, undefined, 'only')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Read failed'))
      .finally(() => setBusy(false));
  };
  useEffect(load, [client]);
  const restore = async (study: Study) => {
    setBusy(true);
    try {
      await client.studyAction(study.id, 'restore');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The study was not restored.');
      setBusy(false);
    }
  };
  return (
    <section aria-busy={busy}>
      <Toolbar label="Archive actions">
        <h1>Archive</h1>
        <Button onClick={load} disabled={busy}>
          Refresh
        </Button>
      </Toolbar>
      {error && <p role="alert">{error}</p>}
      <DataTable
        id="archived-studies"
        label="Archived studies"
        emptyText={
          busy ? 'Loading…' : 'No archived studies. Archive a study from the Studies list.'
        }
        data={data}
        columns={[
          ...studyColumns(false),
          { id: 'archived', header: 'Archived', accessorFn: (s) => s.archived_at ?? '' },
        ]}
        getRowId={(s) => s.id}
        virtualize={false}
        rowActions={(s) => (
          <div className="ui-inline">
            <Button compact onClick={() => open(s)}>
              Open results
            </Button>
            <Button compact disabled={busy} onClick={() => void restore(s)}>
              Restore
            </Button>
          </div>
        )}
      />
    </section>
  );
}
