import { useEffect, useState } from 'react';
import { Button, DataTable, Field, PropertyGrid, SidePanel, Toolbar } from '../ui';
import { navigate } from '../router';
import { Client } from './client';
import type { components } from '../api-schema';
export type Template = components['schemas']['TemplateRead'];

export function TemplateTable({
  data,
  loading = false,
  error = '',
  readonly = false,
  onUse,
}: {
  data: Template[];
  loading?: boolean;
  error?: string;
  readonly?: boolean;
  onUse: (t: Template) => void;
}) {
  return (
    <section aria-label="Study templates" aria-busy={loading}>
      {loading && <p role="status">Loading templates…</p>}
      {error && <p role="alert">{error}</p>}
      <DataTable
        id="study-templates"
        label="Reviewed study templates"
        data={data}
        getRowId={(t) => t.id}
        columns={[
          { accessorKey: 'name', header: 'Name' },
          { accessorKey: 'source_version_id', header: 'Source version' },
          { accessorKey: 'review_notes', header: 'Review notes' },
          { accessorKey: 'principal', header: 'Registered by' },
          { accessorKey: 'created_at', header: 'Created' },
        ]}
        emptyText={
          loading
            ? 'Loading templates…'
            : 'No templates registered. Register a reviewed published version from its workspace.'
        }
        rowActions={(t) => (
          <Button variant="quiet" disabled={readonly || loading} onClick={() => onUse(t)}>
            Use template
          </Button>
        )}
      />
    </section>
  );
}
export function Templates({ client }: { client: Client }) {
  const [data, setData] = useState<Template[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Template>(),
    [title, setTitle] = useState(''),
    [ack, setAck] = useState(false);
  const load = () => {
    setBusy(true);
    setError('');
    client
      .templates(offset)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(load, [client, offset]);
  return (
    <section className="ui-stack">
      <Toolbar>
        <h1>Study templates</h1>
        <Button onClick={load} disabled={busy}>
          Refresh
        </Button>
        <Button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
          Previous page
        </Button>
        <Button disabled={busy || data.length < 50} onClick={() => setOffset(offset + 50)}>
          Next page
        </Button>
        {selected && (
          <Button
            variant="primary"
            disabled={busy || !title.trim() || !ack}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const s = await client.duplicate({
                  title,
                  description: '',
                  source_version_id: selected.source_version_id,
                  reviewed_content: true,
                });
                navigate('/researcher/studies/' + s.id + '/versions/' + s.versions[0].id + '/flow');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Duplicate failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Create from template
          </Button>
        )}
      </Toolbar>
      <TemplateTable
        data={data}
        loading={busy}
        error={error}
        onUse={(t) => {
          setSelected(t);
          setTitle('Copy of ' + t.name);
          setAck(false);
        }}
      />
      {selected && (
        <SidePanel title="Review template copy" onClose={() => setSelected(undefined)}>
          <PropertyGrid
            sections={[
              {
                title: 'Copy into a new study',
                defaultOpen: true,
                children: (
                  <>
                    <p>
                      Source version: {selected.source_version_id}. {selected.review_notes}
                    </p>
                    <Field
                      label="New study title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={busy}
                    />
                    <Field
                      label="Review wording, restrictions, sample codes and translations before release"
                      kind="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      disabled={busy}
                    />
                    <p>
                      The copy receives fresh study, version, test and sample IDs. Assessors,
                      responses and tablet credentials are excluded.
                    </p>
                  </>
                ),
              },
            ]}
          />
        </SidePanel>
      )}
    </section>
  );
}
