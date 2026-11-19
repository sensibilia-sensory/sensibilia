import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { components } from '../api-schema';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, DataTable, Field, PropertyGrid, SidePanel, Toolbar, technical } from '../ui';
import { Client } from './client';
import { useStaffName } from './staff';
import { statusLabel } from '../shared/lexicon';
import { groupFingerprint, pemFingerprint } from '../shared/certFingerprint';
import { prepareTerminal, readTerminal } from '../assessor/terminal';
import { readSessions, synchronise } from '../assessor/storage';
type Terminal = components['schemas']['TerminalRead'];
type Registered = components['schemas']['TerminalRegistered'];
type Audit = components['schemas']['TerminalAuditRead'];
type Issued = components['schemas']['PairingIssued'];
type PairingStatus = components['schemas']['PairingStatus'];
type Room = components['schemas']['RoomRead'];
/** Host and port typed by staff, with this page's scheme (a missing scheme is not an error). */
export function tabletOrigin(input: string) {
  const bare = input
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/.*$/, '');
  try {
    const url = new URL(window.location.protocol + '//' + (bare || window.location.host));
    return url.origin;
  } catch {
    return window.location.origin;
  }
}
const columnsFor = (booths: Record<string, string>): ColumnDef<Terminal>[] => [
  { accessorKey: 'name', header: 'Terminal' },
  { accessorKey: 'id', header: 'Terminal ID', meta: technical },
  {
    id: 'booth',
    header: 'Booth',
    accessorFn: (t) => (t.booth_id ? (booths[t.booth_id] ?? 'Unknown booth') : ''),
  },
  { accessorKey: 'session_id', header: 'Assessment ID', meta: technical },
  { accessorKey: 'assessor_code', header: 'Assessor' },
  { accessorKey: 'study_version_id', header: 'Version ID', meta: technical },
  {
    id: 'session_status',
    header: 'Assessment status',
    accessorFn: (t) => statusLabel(t.session_status),
  },
  { accessorKey: 'registered_at', header: 'Registered' },
];
export function TerminalTable({
  rows,
  loading = false,
  error = '',
  onRetry,
  onSelect,
  onNext,
  onRemove,
  nextBlocked,
  booths = {},
}: {
  rows: Terminal[];
  booths?: Record<string, string>;
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  onSelect?: (t: Terminal) => void;
  onNext?: (t: Terminal) => void;
  onRemove?: (t: Terminal) => void;
  nextBlocked?: (t: Terminal) => string | undefined;
}) {
  return (
    <div className="ui-stack">
      {loading && (
        <p role="status" aria-busy="true">
          Loading terminals…
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <Button onClick={onRetry}>Retry terminals</Button>
        </p>
      )}
      <DataTable
        id="terminals-table"
        wideActions
        label="Laboratory terminals"
        data={rows}
        columns={columnsFor(booths)}
        getRowId={(t) => t.id}
        emptyText={loading ? 'Loading terminals…' : 'No registered terminals.'}
        onActivate={onSelect}
        rowActions={
          onSelect
            ? (t) => (
                <>
                  {onNext && (
                    <Button
                      variant="quiet"
                      disabled={!!nextBlocked?.(t)}
                      title={nextBlocked?.(t)}
                      onClick={() => onNext(t)}
                    >
                      Next assessment
                    </Button>
                  )}
                  <Button variant="quiet" onClick={() => onSelect(t)}>
                    Manage
                  </Button>
                  {onRemove && !t.retired_at && (
                    <Button variant="quiet" onClick={() => onRemove(t)}>
                      Remove tablet…
                    </Button>
                  )}
                </>
              )
            : undefined
        }
      />
    </div>
  );
}
export function TerminalPreparation({
  onPrepare,
  busy = false,
  presetId = '',
  presetToken = '',
  readonly = false,
}: {
  onPrepare: (id: string, token: string) => void;
  busy?: boolean;
  presetId?: string;
  presetToken?: string;
  readonly?: boolean;
}) {
  const [id, setId] = useState(presetId),
    [token, setToken] = useState(presetToken);
  return (
    <PropertyGrid
      sections={[
        {
          title: 'Staff tablet preparation',
          defaultOpen: true,
          children: (
            <>
              <Field
                label="Registered terminal ID"
                value={id}
                onChange={(e) => setId(e.target.value)}
                disabled={busy || readonly}
              />
              <Field
                label="Terminal access key"
                kind="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={busy || readonly}
              />
              <p>
                Run on the registered tablet. Finish and synchronise previous assessments before
                handover. Pending records stay on their original assessment.
              </p>
              <Button
                disabled={busy || readonly || !id || !token}
                onClick={() => onPrepare(id, token)}
              >
                Prepare this tablet
              </Button>
            </>
          ),
        },
      ]}
    />
  );
}
export function TerminalAuditTable({ rows }: { rows: Audit[] }) {
  return (
    <DataTable
      id="terminal-audit"
      label="Terminal audit"
      data={rows}
      getRowId={(r) => r.id}
      columns={[
        { accessorKey: 'action', header: 'Action' },
        { accessorKey: 'staff_name', header: 'Staff (entered)' },
        { accessorKey: 'principal', header: 'Credential principal' },
        { accessorKey: 'reason', header: 'Reason' },
        { accessorKey: 'session_id', header: 'Assessment' },
        { accessorKey: 'revision', header: 'Revision' },
        { accessorKey: 'recorded_at', header: 'Time' },
      ]}
      emptyText="No audit entries."
    />
  );
}
export function Terminals({ client }: { client: Client }) {
  const [rows, setRows] = useState<Terminal[]>([]),
    [selected, setSelected] = useState<Terminal>();
  const [audit, setAudit] = useState<Audit[]>([]),
    [auditLoading, setAuditLoading] = useState(false),
    [auditError, setAuditError] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [staff, setStaff] = useStaffName();
  const [name, setName] = useState(''),
    [reason, setReason] = useState(''),
    [session, setSession] = useState('');
  const [created, setCreated] = useState<Registered>(),
    [confirmRetire, setConfirmRetire] = useState(false),
    [offset, setOffset] = useState(0);
  const [rooms, setRooms] = useState<Room[]>([]),
    [pairBooth, setPairBooth] = useState(''),
    [linkBooth, setLinkBooth] = useState(''),
    [address, setAddress] = useState(window.location.origin),
    [issued, setIssued] = useState<Issued>(),
    [pairExpired, setPairExpired] = useState(false),
    [qr, setQr] = useState(''),
    [caFingerprint, setCaFingerprint] = useState(''),
    [nextCode, setNextCode] = useState('');
  const boothOptions = rooms.flatMap((r) =>
    r.booths
      .filter((b) => b.enabled)
      .map((b) => ({ value: b.id, label: rooms.length > 1 ? r.name + ' · ' + b.label : b.label })),
  );
  const boothLabels = Object.fromEntries(
    rooms.flatMap((r) => r.booths.map((b) => [b.id, b.label] as const)),
  );
  // Only host and port are taken from the field; the scheme always matches this page, so
  // a tablet is never sent to plain HTTP on an HTTPS-only port.
  const base = tabletOrigin(address);
  const unreachable = /^(localhost|127\.|\[?::1)/.test(new URL(base).hostname);
  const pairingUrl = issued
    ? base + '/assessor/pair' + (caFingerprint ? '?ca=' + caFingerprint : '') + '#' + issued.code
    : '';
  const nextBlocked = (t: Terminal) =>
    t.retired_at
      ? 'Removed tablet'
      : !t.session_id
        ? 'Assign a first assessment instead'
        : t.session_status === 'in_progress'
          ? 'The current assessment is still in progress'
          : !staff.trim()
            ? 'Enter a staff name first'
            : undefined;
  const nextAssessment = (t: Terminal) =>
    void action(async () => {
      const moved = await client.request<Terminal>('/terminals/' + t.id + '/next-assessment', {
        method: 'POST',
        body: JSON.stringify({
          expected_revision: t.revision,
          staff_name: staff,
          reason: reason.trim() || 'Next assessment',
          assessor_code: nextCode.trim() || null,
        }),
      });
      setNextCode('');
      setNotice(
        moved.name +
          ' now has assessment ' +
          moved.assessor_code +
          '. The tablet prepares itself once it has synchronised.',
      );
      if (selected?.id === moved.id) setSelected(moved);
      await load();
    });
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await client.request<Terminal[]>('/terminals?retired=exclude&offset=' + offset));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Read failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [offset]);
  useEffect(() => {
    client
      .request<Room[]>('/rooms')
      .then(setRooms)
      .catch(() => setNotice('Booths could not be read; tablets can still be set up without one.'));
  }, []);
  useEffect(() => {
    setLinkBooth(selected?.booth_id ?? '');
  }, [selected?.id, selected?.booth_id]);
  useEffect(() => {
    // A test CA is published by the server; its fingerprint lets a tablet app verify it.
    if (!issued) return;
    let current = true;
    fetch('/certificate.crt')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('none'))))
      .then(pemFingerprint)
      .then((hex) => current && setCaFingerprint(hex))
      .catch(() => current && setCaFingerprint(''));
    return () => {
      current = false;
    };
  }, [issued?.id]);
  useEffect(() => {
    if (!pairingUrl) return setQr('');
    let current = true;
    void QRCode.toString(pairingUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(
      (svg) => current && setQr(svg),
    );
    return () => {
      current = false;
    };
  }, [pairingUrl]);
  useEffect(() => {
    if (!issued || pairExpired) return;
    const timer = setInterval(() => {
      void client
        .request<PairingStatus>('/terminals/pairings/' + issued.id)
        .then(async (status) => {
          if (status.status === 'expired') setPairExpired(true);
          if (status.status !== 'paired' || !status.terminal) return;
          setIssued(undefined);
          setNotice(status.terminal.name + ' is paired. Assign an assessment to it below.');
          setSelected(status.terminal);
          await load();
          await loadAudit(status.terminal);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [issued, pairExpired]);
  const loadAudit = async (t: Terminal) => {
    setAudit([]);
    setAuditLoading(true);
    setAuditError('');
    try {
      setAudit(await client.request<Audit[]>('/terminals/' + t.id + '/audit?limit=1000'));
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : 'Audit read failed');
    } finally {
      setAuditLoading(false);
    }
  };
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  };
  const prepared = async (id: string, token: string) => {
    const result = await prepareTerminal(id, token);
    setNotice(
      result.durable
        ? 'Tablet prepared. Persistent storage granted.'
        : 'Tablet prepared. Persistent storage was not granted; device acceptance is required before collection.',
    );
  };
  return (
    <section className="ui-stack" aria-label="Terminal management">
      <Toolbar
        label="Terminal actions"
        secondary={
          <Button disabled={loading || busy} onClick={() => void load()}>
            Refresh terminals
          </Button>
        }
      >
        <h1>Laboratory terminals</h1>
        <Button
          variant="primary"
          disabled={busy || !!issued || !staff.trim()}
          onClick={() =>
            void action(async () => {
              setPairExpired(false);
              setIssued(
                await client.request<Issued>('/terminals/pairings', {
                  method: 'POST',
                  body: JSON.stringify({ staff_name: staff, booth_id: pairBooth || null }),
                }),
              );
            })
          }
        >
          Set up new tablet
        </Button>
      </Toolbar>
      {notice && <p role="status">{notice}</p>}
      <PropertyGrid
        sections={[
          {
            title: 'Set up new tablet',
            defaultOpen: true,
            children: (
              <>
                <Field
                  label="Staff name"
                  value={staff}
                  onChange={(e) => setStaff(e.target.value)}
                  disabled={busy}
                />
                <Field
                  label="Booth for the new tablet"
                  kind="select"
                  value={pairBooth}
                  onChange={(e) => setPairBooth(e.target.value)}
                  options={[{ value: '', label: 'No booth' }, ...boothOptions]}
                  disabled={busy || !!issued}
                />
                <Field
                  label="Action reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                  hint="Recorded when assigning, linking or retiring a tablet."
                />
                {issued && (
                  <>
                    <Field
                      label="Server address for tablets"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      hint={
                        unreachable
                          ? 'A tablet cannot reach localhost. Enter this computer’s address on the laboratory network, for example 192.168.1.20:1379.'
                          : 'Host and port the tablet can reach. The tablet uses ' +
                            window.location.protocol.replace(':', '').toUpperCase() +
                            ', like this page.'
                      }
                    />
                    <div className="ui-qr" role="img" aria-label="Pairing QR code">
                      <div dangerouslySetInnerHTML={{ __html: qr }} />
                    </div>
                    {caFingerprint && (
                      <p className="ui-hint">
                        Test certificate fingerprint (SHA-256):{' '}
                        <span className="mono">{groupFingerprint(caFingerprint)}</span>
                      </p>
                    )}
                    <p className="ui-pairing-code" aria-label="Pairing code">
                      {issued.code.slice(0, 4) + '-' + issued.code.slice(4)}
                    </p>
                    <p role="status">
                      {pairExpired
                        ? 'This code has expired. Set up the tablet again.'
                        : 'Scan the code with the tablet camera, or open ' +
                          base +
                          '/assessor/pair and type it. Single use, valid 10 minutes. Waiting for the tablet…'}
                    </p>
                    <Button onClick={() => setIssued(undefined)}>Cancel pairing</Button>
                  </>
                )}
              </>
            ),
          },
          {
            title: 'Next assessment',
            defaultOpen: true,
            children: (
              <Field
                label="Assessor code for next assessment"
                value={nextCode}
                onChange={(e) => setNextCode(e.target.value)}
                disabled={busy}
                hint="Optional. Blank numbers the next assessor automatically (A001, A002…)."
              />
            ),
          },
          {
            title: 'Manual registration (recovery)',
            children: (
              <>
                <Field
                  label="Terminal name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
                <Button
                  disabled={busy || !!created || !name.trim() || !staff.trim() || !reason.trim()}
                  onClick={() =>
                    void action(async () => {
                      const t = await client.request<Registered>('/terminals', {
                        method: 'POST',
                        body: JSON.stringify({ name, staff_name: staff, reason }),
                      });
                      setCreated(t);
                      setName('');
                      setSelected(t);
                      await load();
                      await loadAudit(t);
                    })
                  }
                >
                  Register terminal
                </Button>
              </>
            ),
          },
        ]}
      />
      {created && (
        <PropertyGrid
          sections={[
            {
              title: 'Terminal credential · shown once',
              defaultOpen: true,
              children: (
                <>
                  <Field label="New terminal ID" value={created.id} readOnly onChange={() => {}} />
                  <Field
                    label="New terminal access key"
                    value={created.terminal_token}
                    readOnly
                    mono
                    onChange={() => {}}
                  />
                  <p>
                    On the tablet being registered: assign an assessment below, then prepare it with
                    this key. To use another tablet, select and copy the key and enter it there. The
                    key is never included in record lists or URLs.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await prepared(created.id, created.terminal_token);
                        setCreated(undefined);
                      })
                    }
                  >
                    Prepare this tablet with new key
                  </Button>
                  <Button onClick={() => setCreated(undefined)}>Close terminal credential</Button>
                </>
              ),
            },
          ]}
        />
      )}
      <TerminalTable
        rows={rows}
        booths={boothLabels}
        onNext={nextAssessment}
        nextBlocked={nextBlocked}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        onSelect={(t) => {
          setSelected(t);
          setSession('');
          setConfirmRetire(false);
          void loadAudit(t);
        }}
        onRemove={(t) => {
          setSelected(t);
          setSession('');
          setConfirmRetire(true);
          void loadAudit(t);
        }}
      />
      <Toolbar label="Terminal pages">
        <Button disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>
          Previous terminals
        </Button>
        <Button disabled={rows.length < 50 || loading} onClick={() => setOffset(offset + 50)}>
          Next terminals
        </Button>
      </Toolbar>
      {selected && (
        <SidePanel title="Terminal assignment" onClose={() => setSelected(undefined)}>
          <PropertyGrid
            sections={[
              {
                title: selected.name,
                defaultOpen: true,
                children: (
                  <>
                    <Field
                      label="Assignment revision"
                      value={String(selected.revision)}
                      disabled
                      onChange={() => {}}
                    />
                    <Button
                      disabled={busy || !!nextBlocked(selected)}
                      onClick={() => nextAssessment(selected)}
                    >
                      Next assessment
                    </Button>
                    {nextBlocked(selected) && <p>{nextBlocked(selected)}.</p>}
                    <Field
                      label="Booth"
                      kind="select"
                      value={linkBooth}
                      onChange={(e) => setLinkBooth(e.target.value)}
                      options={[{ value: '', label: 'No booth' }, ...boothOptions]}
                      disabled={busy || !!selected.retired_at}
                      hint="Assigning an assessment to this booth also assigns it to this tablet."
                    />
                    <Button
                      disabled={
                        busy ||
                        !!selected.retired_at ||
                        linkBooth === (selected.booth_id ?? '') ||
                        !staff.trim() ||
                        !reason.trim()
                      }
                      onClick={() =>
                        void action(async () => {
                          const t = await client.request<Terminal>(
                            '/terminals/' + selected.id + '/booth',
                            {
                              method: 'PUT',
                              body: JSON.stringify({
                                booth_id: linkBooth || null,
                                expected_revision: selected.revision,
                                staff_name: staff,
                                reason,
                              }),
                            },
                          );
                          setSelected(t);
                          await load();
                          await loadAudit(t);
                        })
                      }
                    >
                      Save booth
                    </Button>
                    <details>
                      <summary>Assign an existing assessment by ID (advanced)</summary>
                      <Field
                        label="Assessment ID"
                        value={session}
                        disabled={busy || !!selected.retired_at}
                        onChange={(e) => setSession(e.target.value)}
                        hint="Provision the published version in Sessions first; use its session ID."
                      />
                      <Button
                        disabled={
                          busy ||
                          !!selected.retired_at ||
                          !session ||
                          !staff.trim() ||
                          !reason.trim()
                        }
                        onClick={() =>
                          void action(async () => {
                            const t = await client.request<Terminal>(
                              '/terminals/' + selected.id + '/assignments',
                              {
                                method: 'POST',
                                body: JSON.stringify({
                                  session_id: session,
                                  expected_revision: selected.revision,
                                  staff_name: staff,
                                  reason,
                                }),
                              },
                            );
                            setSelected(t);
                            await load();
                            await loadAudit(t);
                            setNotice(
                              'Assessment assigned. Staff must prepare its registered tablet.',
                            );
                          })
                        }
                      >
                        Assign assessment
                      </Button>
                    </details>
                    <details>
                      <summary>Technical details</summary>
                      <p className="mono">
                        Terminal ID {selected.id} · revision {selected.revision}
                      </p>
                    </details>
                    {selected.retired_at ? (
                      <p>Removed tablet · history is read-only.</p>
                    ) : (
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => setConfirmRetire(true)}
                      >
                        Remove tablet…
                      </Button>
                    )}
                    {confirmRetire && !selected.retired_at && (
                      <>
                        <p>
                          Remove {selected.name} from the laboratory. It stops working and its booth
                          is freed. Assessments and answers already on the server are kept. Records
                          still waiting on the tablet cannot be sent after removal, so let it
                          synchronise first. To use the same tablet again, set it up with a new
                          code.
                        </p>
                        {selected.session_status === 'in_progress' && (
                          <p role="status">
                            An assessment is still in progress on this tablet. End it on Run study
                            and let the tablet synchronise before removing it.
                          </p>
                        )}
                        {!staff.trim() && (
                          <p className="ui-hint">Enter your staff name above first.</p>
                        )}
                        <Button
                          variant="danger"
                          disabled={
                            busy || !staff.trim() || selected.session_status === 'in_progress'
                          }
                          onClick={() =>
                            void action(async () => {
                              await client.request<Terminal>(
                                '/terminals/' + selected.id + '/retire',
                                {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    expected_revision: selected.revision,
                                    staff_name: staff,
                                    reason: reason.trim() || 'Removed from the laboratory',
                                  }),
                                },
                              );
                              setSelected(undefined);
                              setConfirmRetire(false);
                              setNotice(
                                selected.name +
                                  ' removed. Its assessments and answers on the server are kept. The next tablet you set up takes the name ' +
                                  selected.name +
                                  '.',
                              );
                              await load();
                            })
                          }
                        >
                          Remove {selected.name}
                        </Button>
                        <Button onClick={() => setConfirmRetire(false)}>Keep tablet</Button>
                      </>
                    )}
                  </>
                ),
              },
            ]}
          />
          {auditLoading && (
            <p role="status" aria-busy="true">
              Loading terminal audit…
            </p>
          )}
          {auditError && (
            <p role="alert">
              {auditError} <Button onClick={() => void loadAudit(selected)}>Retry audit</Button>
            </p>
          )}
          <TerminalAuditTable rows={audit} />
        </SidePanel>
      )}
      <TerminalPreparation
        onPrepare={(id, token) => void action(() => prepared(id, token))}
        busy={busy}
      />
      <Button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            const registered = await readTerminal();
            if (!registered)
              throw new Error('Enrol this tablet with its terminal ID and key first.');
            await prepared(registered.id, registered.token);
          })
        }
      >
        Prepare registered tablet
      </Button>
      <Button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            const configured = await readTerminal();
            if (!configured) throw new Error('This tablet is not registered locally.');
            for (const r of await readSessions())
              if (r.outbox.length) await synchronise(r.id, () => {});
            setNotice('Saved assessments synchronised on this tablet.');
          })
        }
      >
        Synchronise this tablet before handover
      </Button>
      <a className="ui-button ui-button--default ui-button--default" href="/assessor/">
        Open assigned assessment
      </a>
    </section>
  );
}
