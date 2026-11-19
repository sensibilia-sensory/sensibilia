import { useEffect, useState, useRef } from 'react';
import type { components } from '../api-schema';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, ConfirmButton, DataTable, Field, PropertyGrid, Toolbar, technical } from '../ui';
import { rehearsalContext } from '../shared/nodes/rehearsal';
import { ApiError, type Client, type Version } from './client';
import { statusLabel } from '../shared/lexicon';
type Session = components['schemas']['SessionRead'];
type Provisioned = components['schemas']['SessionProvisioned'];
const columns: ColumnDef<Session>[] = [
  { accessorKey: 'id', header: 'Session ID', meta: technical },
  { accessorKey: 'study_version_id', header: 'Version ID', meta: technical },
  { accessorKey: 'assessor_code', header: 'Assessor' },
  { id: 'status', header: 'Status', accessorFn: (s) => statusLabel(s.status) },
  { accessorKey: 'started_at', header: 'Started' },
  { accessorKey: 'completed_at', header: 'Completed' },
];
export function SessionTable({
  rows,
  loading = false,
  error = '',
  onRetry,
  onEnd,
}: {
  rows: Session[];
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  onEnd?: (session: Session) => void;
}) {
  return (
    <div className="ui-stack">
      {loading && (
        <p role="status" aria-busy="true">
          Loading sessions…
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <Button onClick={onRetry}>Retry sessions</Button>
        </p>
      )}
      <DataTable
        id="sessions-table"
        label="Sessions"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        emptyText={loading ? 'Loading sessions…' : 'No sessions for this version.'}
        rowActions={
          onEnd
            ? (r) =>
                r.status === 'in_progress' ? (
                  <ConfirmButton compact confirmLabel="End now" onConfirm={() => onEnd(r)}>
                    End assessment
                  </ConfirmButton>
                ) : null
            : undefined
        }
      />
    </div>
  );
}
export function SessionCredential({
  session,
  onClose,
}: {
  session: Provisioned;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState('');
  return (
    <PropertyGrid
      sections={[
        {
          title: 'New session credential · shown once',
          defaultOpen: true,
          children: (
            <>
              <Field label="Session ID" value={session.id} disabled onChange={() => {}} />
              <Field
                label="Session token"
                kind="password"
                value={session.session_token}
                readOnly
                onChange={() => {}}
              />
              <p>Copy the token before closing. Lost tokens require a new session.</p>
              <Button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(session.session_token)
                    .then(() => setCopied(true))
                    .catch(() => setError('Copy failed; select and copy the token field.'))
                }
              >
                Copy session token
              </Button>
              {copied && <p role="status">Token copied.</p>}
              {error && <p role="alert">{error}</p>}
              <a href="/researcher/terminals" target="_blank" rel="noreferrer">
                Assign to laboratory terminal
              </a>
              <Button onClick={onClose}>Close credential</Button>
            </>
          ),
        },
      ]}
    />
  );
}
export function Sessions({
  client,
  studyId,
  version,
}: {
  client: Client;
  studyId: string;
  version: Version;
}) {
  const [rows, setRows] = useState<Session[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [status, setStatus] = useState(''),
    [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false);
  const [assessor, setAssessor] = useState(''),
    [language, setLanguage] = useState(
      version.form?.schema_version === 2 ? version.form.default_language : 'en',
    );
  const [booth, setBooth] = useState(''),
    [table, setTable] = useState(''),
    [returning, setReturning] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [created, setCreated] = useState<Provisioned>(),
    [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);
  const load = async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setRows([]);
    setError('');
    try {
      const records = await client.sessions(studyId, version.id, status, offset);
      if (generation === requestGeneration.current) setRows(records);
    } catch (e) {
      if (generation === requestGeneration.current)
        setError(e instanceof Error ? e.message : 'Read failed');
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [version.id, status, offset]);
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const flow = version.form?.schema_version === 2 ? version.form : undefined;
      const vars = flow ? await rehearsalContext(flow, returning, booth, table) : {};
      const context = flow
        ? {
            language,
            returning_code_hashes: (vars['context.returning_code_hashes'] as string[]) ?? [],
            ...(booth !== '' ? { booth_number: Number(booth) } : {}),
            ...(table !== '' ? { table_number: Number(table) } : {}),
          }
        : undefined;
      const result = await client.provision({
        study_version_id: version.id,
        assessor_code: assessor,
        context,
      });
      setCreated(result);
      setOpen(false);
      setAssessor('');
      setReturning('');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        setUncertain(true);
        setError(
          'Provisioning outcome is unknown. Refresh sessions to inspect the record; its token cannot be recovered. Cancel before explicitly provisioning a replacement.',
        );
      } else setError(e instanceof Error ? e.message : 'Provisioning failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ui-stack" aria-label="Version sessions">
      <Toolbar
        label="Sessions toolbar"
        children={
          <Button
            disabled={!version.published_at || busy || !!created}
            onClick={() => setOpen(true)}
          >
            Provision session
          </Button>
        }
        secondary={
          <Button disabled={loading} onClick={() => void load()}>
            Refresh sessions
          </Button>
        }
      />
      {!version.published_at && (
        <p>Publish this version before provisioning. Draft configuration is read-only here.</p>
      )}
      <Field
        label="Session status"
        kind="select"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setOffset(0);
        }}
        options={['', 'in_progress', 'completed', 'screened_out', 'ended'].map((value) => ({
          value,
          label: value ? statusLabel(value) : 'All statuses',
        }))}
      />
      {created && <SessionCredential session={created} onClose={() => setCreated(undefined)} />}
      {open && (
        <PropertyGrid
          sections={[
            {
              title: 'Provision published version',
              defaultOpen: true,
              children: (
                <>
                  <Field
                    label="Assessor code"
                    value={assessor}
                    onChange={(e) => setAssessor(e.target.value)}
                    disabled={busy}
                  />
                  {version.form?.schema_version === 2 && (
                    <>
                      <Field
                        label="Session language"
                        kind="select"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        options={version.form.languages.map((value) => ({ value, label: value }))}
                        disabled={busy}
                      />
                      <Field
                        label="Booth number"
                        kind="number"
                        value={booth}
                        onChange={(e) => setBooth(e.target.value)}
                        disabled={busy}
                      />
                      <Field
                        label="Table number"
                        kind="number"
                        value={table}
                        onChange={(e) => setTable(e.target.value)}
                        disabled={busy}
                      />
                      <Field
                        label="Returning codes"
                        value={returning}
                        onChange={(e) => setReturning(e.target.value)}
                        hint="Comma-separated pseudonymous codes; only normalized hashes are frozen."
                        disabled={busy}
                      />
                    </>
                  )}
                  <Button
                    disabled={busy || uncertain || !assessor.trim()}
                    onClick={() => void create()}
                  >
                    Create session
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setOpen(false);
                      setUncertain(false);
                    }}
                  >
                    Cancel provisioning
                  </Button>
                </>
              ),
            },
          ]}
        />
      )}
      <SessionTable
        rows={rows}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        onEnd={async (session) => {
          try {
            await client.endSession(session.id);
            await load();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not end the assessment');
          }
        }}
      />
      <Toolbar
        label="Session pages"
        children={
          <Button
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous sessions
          </Button>
        }
        secondary={
          <Button disabled={rows.length < 50 || loading} onClick={() => setOffset(offset + 50)}>
            Next sessions
          </Button>
        }
      />
    </section>
  );
}
