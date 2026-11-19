import { useEffect, useState } from 'react';
import type { components } from '../api-schema';
import {
  Button,
  DataTable,
  Field,
  PropertyGrid,
  SidePanel,
  Toolbar,
  BoothLayout,
  technical,
} from '../ui';
import { Client } from './client';
import { presenceLabel, servingStateLabel } from '../shared/lexicon';
export type Room = components['schemas']['RoomRead'];
export type Task = components['schemas']['TaskRead'];
export type Dashboard = components['schemas']['DashboardRead'];
export function OperatorTable({
  view,
  loading = false,
  error = '',
  readOnly = false,
  onAction = () => {},
  big = false,
}: {
  view?: Dashboard;
  loading?: boolean;
  error?: string;
  readOnly?: boolean;
  onAction?: (t: Task, a: 'acknowledged' | 'served') => void;
  big?: boolean;
}) {
  return (
    <section className={big ? 'ui-operator-big ui-stack' : 'ui-stack'} aria-label="Serving tasks">
      {loading && (
        <p role="status" aria-busy="true">
          Loading serving tasks…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {readOnly && <p role="status">Read-only serving view</p>}
      {(view?.rooms ?? []).map((room) => (
        <BoothLayout
          key={room.id}
          label={room.name + ' floor layout · revision ' + room.revision}
          rows={room.rows}
          columns={room.columns}
          booths={room.booths.map((b) => ({
            id: b.id,
            label: b.label,
            row: b.row,
            column: b.column,
            state: servingStateLabel(
              view?.tasks.find((t) => t.booth_id === b.id && t.room_version_id === room.id)
                ?.status ?? 'no session',
            ),
          }))}
        />
      ))}
      <DataTable
        id="operator-tasks"
        label="Serving tasks"
        data={view?.tasks ?? []}
        getRowId={(t) => t.assignment_id}
        virtualize={false}
        emptyText="No active booth assignments. Staff must assign assessments."
        columns={[
          {
            id: 'name',
            header: 'Booth',
            accessorFn: (t) => t.booth_label + ' · ' + t.room_name,
          },
          { accessorKey: 'assessor_code', header: 'Assessor' },
          { accessorKey: 'version_number', header: 'Version' },
          { id: 'status', header: 'State', accessorFn: (t) => servingStateLabel(t.status) },
          { id: 'presence', header: 'Tablet', accessorFn: (t) => presenceLabel(t.presence) },
          {
            id: 'last_seen',
            header: 'Last seen',
            accessorFn: (t) =>
              t.last_seen ? t.last_seen.slice(5, 10) + ' ' + t.last_seen.slice(11, 19) : 'Unknown',
          },
          {
            id: 'code',
            header: 'Serve code / product',
            accessorFn: (t) => t.slots.map((s) => s.code + ' / ' + s.label).join('; '),
          },
          {
            id: 'wait',
            header: 'Wait s',
            accessorFn: (t) =>
              t.signal
                ? Math.max(
                    0,
                    Math.floor(
                      (Date.parse(view!.server_time) - Date.parse(t.signal.requested_at)) / 1000,
                    ),
                  )
                : null,
          },
          { accessorKey: 'preparation', header: 'Preparation' },
        ]}
        rowActions={(t) =>
          t.signal?.state === 'ready' || t.signal?.state === 'help' ? (
            <Button compact disabled={readOnly} onClick={() => onAction(t, 'acknowledged')}>
              {t.signal.state === 'help' ? 'Acknowledge help request' : 'Acknowledge'}
            </Button>
          ) : t.signal?.state === 'acknowledged' ? (
            <Button compact disabled={readOnly} onClick={() => onAction(t, 'served')}>
              Mark served
            </Button>
          ) : null
        }
      />
    </section>
  );
}
export function Operator() {
  const [token, setToken] = useState(''),
    [signedIn, setSignedIn] = useState(false),
    [input, setInput] = useState(''),
    [actor, setActor] = useState(''),
    [view, setView] = useState<Dashboard>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [connected, setConnected] = useState(false),
    [big, setBig] = useState(false),
    [selected, setSelected] = useState<{ task: Task; action: 'acknowledged' | 'served' }>();
  const [retry, setRetry] = useState<{
    task: Task;
    command: components['schemas']['SignalCommand'];
  }>();
  const read = async () => {
    if (!signedIn) return;
    try {
      setView(await new Client('', token).request<Dashboard>('/operator/dashboard', {}, 'session'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operator read failed');
    }
  };
  useEffect(() => {
    if (!signedIn) return;
    const abort = new AbortController();
    let disposed = false;
    setLoading(true);
    void read().finally(() => setLoading(false));
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read();
    }, 5000);
    const stream = async () => {
      try {
        const response = await fetch('/operator/events', {
          headers: { Authorization: 'Bearer ' + token },
          signal: abort.signal,
        });
        if (!response.ok || !response.body) throw new Error('Stream unavailable');
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = '';
        while (!disposed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.includes('event: snapshot')) {
              const data = frame.split('\n').find((l) => l.startsWith('data: '));
              if (data) {
                setView(JSON.parse(data.slice(6)));
                setConnected(true);
              }
            }
          }
        }
      } catch {
        if (!disposed) setConnected(false);
      }
    };
    void stream();
    return () => {
      disposed = true;
      abort.abort();
      clearInterval(timer);
    };
  }, [signedIn, token]);
  const command = async (t: Task, a: 'acknowledged' | 'served') => {
    const c: components['schemas']['SignalCommand'] = {
      client_event_id: crypto.randomUUID(),
      assignment_id: t.assignment_id,
      step_id: t.signal!.step_id,
      occurrence_id: t.signal!.occurrence_id,
      sample_id: t.signal!.occurrence_id === 'study' ? null : t.signal!.occurrence_id.split(':')[1],
      expected_revision: t.signal!.revision,
      action: a,
      actor,
      recorded_at: new Date().toISOString(),
      reason: '',
      codes: [],
      elapsed_ms: 0,
      clock_quality: 'wall_estimate',
      offline: false,
    };
    setRetry({ task: t, command: c });
    await send(c);
  };
  const send = async (c: components['schemas']['SignalCommand']) => {
    setLoading(true);
    try {
      await new Client('', token).request(
        '/operator/operations',
        { method: 'POST', body: JSON.stringify(c) },
        'session',
      );
      setRetry(undefined);
      setSelected(undefined);
      await read();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation interrupted; retry the same UUID');
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="ui-stack">
      <h1>Laboratory operator</h1>
      {!signedIn ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setToken(input);
            setSignedIn(true);
            setInput('');
          }}
        >
          <PropertyGrid
            sections={[
              {
                title: 'Properties',
                defaultOpen: true,
                children: (
                  <>
                    <Field
                      kind="password"
                      label="Operator access key"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                    />
                    <Field
                      label="Operator name"
                      value={actor}
                      onChange={(e) => setActor(e.target.value)}
                      required
                    />
                  </>
                ),
              },
            ]}
          />
          <Button type="submit">Open serving dashboard</Button>
        </form>
      ) : (
        <>
          <Toolbar>
            <span role="status">
              {connected ? 'Live stream' : 'Snapshot fallback · every 5 seconds'}
            </span>
            <Button compact onClick={() => void read()}>
              Refresh tasks
            </Button>
            <Button compact onClick={() => setBig(!big)}>
              {big ? 'Desktop view' : 'Big-screen view'}
            </Button>
            <Button
              compact
              onClick={() => {
                setToken('');
                setSignedIn(false);
                setView(undefined);
              }}
            >
              Sign out
            </Button>
          </Toolbar>
          <OperatorTable
            view={view}
            loading={loading}
            error={error}
            readOnly={loading}
            big={big}
            onAction={(task, action) => {
              setSelected({ task, action });
              setRetry(undefined);
            }}
          />
          {selected && (
            <SidePanel title="Verify serving task" onClose={() => setSelected(undefined)}>
              <p>
                Room {selected.task.room_name} · layout {selected.task.room_revision} · booth{' '}
                {selected.task.booth_label} · assessor {selected.task.assessor_code} · version{' '}
                {selected.task.version_number}
              </p>
              <p>{selected.task.slots.map((s) => s.code + ' / ' + s.label).join('; ')}</p>
              <p>{selected.task.preparation}</p>
              <p>
                Verify the booth and assigned codes before{' '}
                {selected.action === 'served'
                  ? 'confirming physical delivery'
                  : 'preparing the sample'}
                .
              </p>
              <Button
                disabled={loading || !!retry}
                onClick={() => void command(selected.task, selected.action)}
              >
                {selected.action === 'served'
                  ? 'Confirm physical delivery'
                  : 'Confirm acknowledgement'}
              </Button>
              {retry && (
                <Button disabled={loading} onClick={() => void send(retry.command)}>
                  Retry same operation
                </Button>
              )}
            </SidePanel>
          )}
        </>
      )}
    </main>
  );
}
export function Rooms({ client, readOnly = false }: { client: Client; readOnly?: boolean }) {
  const [historyOffset, setHistoryOffset] = useState(0);
  const [history, setHistory] = useState<components['schemas']['BoothHistoryRead'][]>([]),
    [releaseId, setReleaseId] = useState(''),
    [pendingWrite, setPendingWrite] = useState<{ path: string; body: unknown }>();
  const [rooms, setRooms] = useState<Room[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [edit, setEdit] = useState<Room>(),
    [name, setName] = useState(''),
    [rows, setRows] = useState(2),
    [columns, setColumns] = useState(4),
    [booths, setBooths] = useState<Room['booths']>([]),
    [panel, setPanel] = useState(false);
  const [session, setSession] = useState(''),
    [booth, setBooth] = useState(''),
    [staff, setStaff] = useState(''),
    [reason, setReason] = useState(''),
    [previous, setPrevious] = useState('');
  const load = async () => {
    setLoading(true);
    try {
      const [layouts, assignments] = await Promise.all([
        client.request<Room[]>('/rooms'),
        client.request<components['schemas']['BoothHistoryRead'][]>(
          '/booth-assignments?offset=' + historyOffset + '&limit=100',
        ),
      ]);
      setRooms(layouts);
      setHistory(assignments);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [client, historyOffset]);
  const mutate = async (path: string, body: unknown) => {
    setPendingWrite({ path, body });
    setLoading(true);
    try {
      await client.request(path, { method: 'POST', body: JSON.stringify(body) });
      setPanel(false);
      setPendingWrite(undefined);
      setReleaseId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Room operation failed');
    } finally {
      setLoading(false);
    }
  };
  const open = (r?: Room) => {
    setEdit(r);
    setName(r?.name ?? '');
    setRows(r?.rows ?? 2);
    setColumns(r?.columns ?? 4);
    setBooths(r?.booths ?? []);
    setPanel(true);
  };
  const selected = rooms.find((r) => r.booths.some((b) => b.id === booth));
  return (
    <section className="ui-stack">
      <h1>Rooms and booths</h1>
      {readOnly && <p role="status">Read-only room layouts</p>}
      <Toolbar>
        <Button disabled={loading || readOnly} onClick={() => open()}>
          New room
        </Button>
        <Button compact onClick={() => void load()}>
          Refresh rooms
        </Button>
      </Toolbar>
      {panel && (
        <SidePanel title="Room layout revision" onClose={() => setPanel(false)}>
          <PropertyGrid
            sections={[
              {
                title: 'Properties',
                defaultOpen: true,
                children: (
                  <>
                    <Field
                      label="Room name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Field
                      kind="number"
                      label="Grid rows"
                      value={rows}
                      min={1}
                      max={20}
                      onChange={(e) => setRows(Number(e.target.value))}
                    />
                    <Field
                      kind="number"
                      label="Grid columns"
                      value={columns}
                      min={1}
                      max={20}
                      onChange={(e) => setColumns(Number(e.target.value))}
                    />
                  </>
                ),
              },
            ]}
          />
          <Toolbar>
            <Button
              compact
              disabled={booths.length >= rows * columns}
              onClick={() => {
                const slots = Array.from({ length: rows * columns }, (_, i) => ({
                  row: Math.floor(i / columns) + 1,
                  column: (i % columns) + 1,
                }));
                const slot = slots.find(
                  (s) => !booths.some((b) => b.row === s.row && b.column === s.column),
                );
                if (slot)
                  setBooths([
                    ...booths,
                    {
                      id: crypto.randomUUID(),
                      label: String(booths.length + 1),
                      ...slot,
                      enabled: true,
                    },
                  ]);
              }}
            >
              Add booth
            </Button>
          </Toolbar>
          <DataTable
            id="room-edit-booths"
            label="Edit booth properties"
            data={booths}
            getRowId={(b) => b.id}
            columns={[
              {
                id: 'label',
                header: 'Label',
                cell: ({ row }) => (
                  <Field
                    compact
                    label={'Booth label ' + row.original.id}
                    value={row.original.label}
                    onChange={(e) =>
                      setBooths(
                        booths.map((b) =>
                          b.id === row.original.id ? { ...b, label: e.target.value } : b,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                id: 'row',
                header: 'Row',
                cell: ({ row }) => (
                  <Field
                    compact
                    kind="number"
                    label={'Grid row ' + row.original.label}
                    value={row.original.row}
                    min={1}
                    max={rows}
                    disabled={loading || readOnly}
                    onChange={(e) =>
                      setBooths(
                        booths.map((b) =>
                          b.id === row.original.id ? { ...b, row: Number(e.target.value) } : b,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                id: 'column',
                header: 'Column',
                cell: ({ row }) => (
                  <Field
                    compact
                    kind="number"
                    label={'Grid column ' + row.original.label}
                    value={row.original.column}
                    min={1}
                    max={columns}
                    disabled={loading || readOnly}
                    onChange={(e) =>
                      setBooths(
                        booths.map((b) =>
                          b.id === row.original.id ? { ...b, column: Number(e.target.value) } : b,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                id: 'enabled',
                header: 'Enabled',
                cell: ({ row }) => (
                  <Field
                    compact
                    kind="checkbox"
                    label={'Enabled ' + row.original.label}
                    checked={row.original.enabled}
                    onChange={(e) =>
                      setBooths(
                        booths.map((b) =>
                          b.id === row.original.id ? { ...b, enabled: e.target.checked } : b,
                        ),
                      )
                    }
                  />
                ),
              },
            ]}
          />
          <p>
            Saving creates a new layout revision. Existing assessments retain their assigned layout.
          </p>
          <Button
            disabled={readOnly || loading || !name || !booths.length}
            onClick={() =>
              void mutate('/rooms', {
                room_id: edit?.room_id ?? null,
                expected_revision: edit?.revision ?? 0,
                name,
                rows,
                columns,
                booths,
              })
            }
          >
            Save room revision
          </Button>
        </SidePanel>
      )}
      {loading && (
        <p role="status" aria-busy="true">
          Loading rooms…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <DataTable
        id="rooms"
        label="Room layouts"
        data={rooms}
        getRowId={(r) => r.id}
        columns={[
          { accessorKey: 'name', header: 'Room' },
          { accessorKey: 'revision', header: 'Revision' },
          { accessorKey: 'rows', header: 'Rows' },
          { accessorKey: 'columns', header: 'Columns' },
          { id: 'booths', header: 'Booths', accessorFn: (r) => r.booths.length },
          { accessorKey: 'created_at', header: 'Created' },
        ]}
        rowActions={(r) => (
          <Button compact disabled={readOnly || loading} onClick={() => open(r)}>
            Revise layout
          </Button>
        )}
      />
      <DataTable
        id="booths"
        label="Booth inventory"
        data={rooms.flatMap((r) =>
          r.booths.map((b) => ({
            ...b,
            room: r.name,
            revision: r.revision,
            room_version_id: r.id,
          })),
        )}
        getRowId={(b) => b.id}
        columns={[
          { accessorKey: 'room', header: 'Room' },
          { accessorKey: 'revision', header: 'Revision' },
          { accessorKey: 'label', header: 'Booth' },
          { accessorKey: 'row', header: 'Row' },
          { accessorKey: 'column', header: 'Column' },
          { id: 'enabled', header: 'Enabled', accessorFn: (b) => (b.enabled ? 'Yes' : 'No') },
          { accessorKey: 'id', header: 'ID', meta: technical },
        ]}
      />
      <PropertyGrid
        sections={[
          {
            title: 'Properties',
            defaultOpen: true,
            children: (
              <>
                <Field
                  label="Assessment ID"
                  value={session}
                  onChange={(e) => setSession(e.target.value)}
                />
                <Field
                  kind="select"
                  label="Assign to booth"
                  value={booth}
                  onChange={(e) => setBooth(e.target.value)}
                  options={[
                    { value: '', label: 'Choose booth' },
                    ...rooms.flatMap((r) =>
                      r.booths
                        .filter((b) => b.enabled)
                        .map((b) => ({ value: b.id, label: r.name + ' / ' + b.label })),
                    ),
                  ]}
                />
                <Field
                  label="Staff name"
                  value={staff}
                  onChange={(e) => setStaff(e.target.value)}
                />
                <Field
                  label="Assignment reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Field
                  label="Prior assignment ID"
                  value={previous}
                  onChange={(e) => setPrevious(e.target.value)}
                />
              </>
            ),
          },
        ]}
      />
      <Button
        disabled={readOnly || loading || !selected || !session || !staff || !reason}
        onClick={() =>
          void mutate('/booth-assignments', {
            client_event_id: crypto.randomUUID(),
            session_id: session,
            room_version_id: selected!.id,
            booth_id: booth,
            previous_assignment_id: previous || null,
            staff_name: staff,
            reason,
          })
        }
      >
        Assign assessment to booth
      </Button>
      {pendingWrite && (
        <Button
          disabled={loading}
          onClick={() => void mutate(pendingWrite.path, pendingWrite.body)}
        >
          Retry same room operation
        </Button>
      )}
      <Toolbar>
        <Button
          compact
          disabled={loading || historyOffset === 0}
          onClick={() => setHistoryOffset(Math.max(0, historyOffset - 100))}
        >
          Previous assignments
        </Button>
        <span>Assignment page {historyOffset / 100 + 1}</span>
        <Button
          compact
          disabled={loading || history.length < 100}
          onClick={() => setHistoryOffset(historyOffset + 100)}
        >
          Next assignments
        </Button>
      </Toolbar>
      <DataTable
        id="booth-assignment-history"
        label="Booth assignment history"
        data={history}
        getRowId={(a) => a.id}
        columns={[
          { accessorKey: 'booth_id', header: 'Booth ID', meta: technical },
          { accessorKey: 'session_id', header: 'Assessment ID', meta: technical },
          { accessorKey: 'room_version_id', header: 'Layout revision ID', meta: technical },
          { accessorKey: 'staff_name', header: 'Staff' },
          { accessorKey: 'principal', header: 'Principal' },
          { accessorKey: 'reason', header: 'Reason' },
          { accessorKey: 'assigned_at', header: 'Assigned' },
          { accessorKey: 'released_at', header: 'Released' },
          { accessorKey: 'id', header: 'Assignment ID', meta: technical },
        ]}
        rowActions={(a) =>
          !a.released_at && (
            <Button compact disabled={loading || readOnly} onClick={() => setReleaseId(a.id)}>
              Release booth
            </Button>
          )
        }
      />
      {releaseId && (
        <div className="ui-stack">
          <p>
            Release assignment {releaseId} and cancel its outstanding serving requests. Stored
            research remains attributable to its assessment.
          </p>
          <Toolbar>
            <Button
              disabled={loading || readOnly || !staff || !reason}
              onClick={() =>
                void mutate('/booth-assignments/' + releaseId + '/release', {
                  client_event_id: crypto.randomUUID(),
                  staff_name: staff,
                  reason,
                })
              }
            >
              Confirm booth release
            </Button>
            <Button onClick={() => setReleaseId('')}>Keep assignment</Button>
          </Toolbar>
        </div>
      )}
    </section>
  );
}
