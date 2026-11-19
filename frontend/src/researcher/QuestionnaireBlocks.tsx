import { useEffect, useState } from 'react';
import { Button, DataTable, Field, SidePanel, Toolbar, technical } from '../ui';
import { outline, type Flow } from '../shared/flow';
import { questionnaireBlock } from '../shared/nodes/authoring';
import { TemplateTable, type Template } from './Templates';
import { Client } from './client';

export function QuestionnaireBlockList({
  flow,
  onSelect,
  disabled = false,
}: {
  flow: Flow;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <DataTable
      id="questionnaire-blocks"
      label="Reviewed questionnaire blocks"
      selectable={false}
      data={outline(flow.nodes)
        .filter(({ node }) =>
          ['question', 'matrix_question', 'group', 'consent', 'info', 'confirm'].includes(
            node.kind,
          ),
        )
        .map(({ node, number }) => ({
          id: node.id,
          number,
          title: node.title[flow.default_language],
          kind: node.kind,
          rows: node.kind === 'matrix_question' ? node.data.rows.length : '',
          languages: flow.languages.join(', '),
        }))}
      getRowId={(n) => n.id}
      columns={[
        { accessorKey: 'number', header: 'Step' },
        { accessorKey: 'id', header: 'Node ID', meta: technical },
        { accessorKey: 'title', header: 'Title' },
        { accessorKey: 'kind', header: 'Type' },
        { accessorKey: 'rows', header: 'Rows' },
        { accessorKey: 'languages', header: 'Languages' },
      ]}
      emptyText="No ordinary questionnaire blocks in this template."
      rowActions={(n) => (
        <Button variant="quiet" disabled={disabled} onClick={() => onSelect(n.id)}>
          Select block
        </Button>
      )}
    />
  );
}

export function QuestionnaireBlocks({
  client,
  target,
  onClose,
  onInsert,
}: {
  client: Client;
  target: Flow;
  onClose: () => void;
  onInsert: (node: Flow['nodes'][number]) => void;
}) {
  const [data, setData] = useState<Template[]>([]),
    [busy, setBusy] = useState(true);
  const [error, setError] = useState(''),
    [offset, setOffset] = useState(0);
  const [template, setTemplate] = useState<Template>(),
    [source, setSource] = useState<Flow>();
  const [id, setId] = useState(''),
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
    <SidePanel title="Reuse reviewed questionnaire block" onClose={onClose}>
      <Toolbar label="Questionnaire template actions">
        <Button disabled={busy} onClick={load}>
          Refresh templates
        </Button>
        <Button disabled={busy || !offset} onClick={() => setOffset(Math.max(0, offset - 50))}>
          Previous templates
        </Button>
        <Button disabled={busy || data.length < 50} onClick={() => setOffset(offset + 50)}>
          Next templates
        </Button>
        <Button
          variant="primary"
          disabled={busy || !source || !id || !ack}
          onClick={() => {
            try {
              const node = questionnaireBlock(source!, id, target);
              onInsert(node);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Insert reviewed block
        </Button>
      </Toolbar>
      <TemplateTable
        data={data}
        loading={busy}
        error={error}
        onUse={async (t) => {
          setTemplate(t);
          setSource(undefined);
          setId('');
          setAck(false);
          setBusy(true);
          setError('');
          try {
            setSource(await client.templateForm(t.id));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {template && (
        <p>
          Source version: {template.source_version_id}. {template.review_notes}
        </p>
      )}
      {source && (
        <>
          <QuestionnaireBlockList
            flow={source}
            disabled={busy}
            onSelect={(next) => {
              setId(next);
              setAck(false);
              setError('');
            }}
          />
          {id && (
            <p>
              Selected:{' '}
              {
                outline(source.nodes).find(({ node }) => node.id === id)?.node.title[
                  source.default_language
                ]
              }
            </p>
          )}
          <Field
            label="Review wording, scale direction and every target-language translation before release"
            kind="checkbox"
            checked={ack}
            disabled={busy}
            onChange={(e) => setAck(e.target.checked)}
          />
          <p>
            Copies receive fresh step IDs. Row/option IDs, explicit scores and reviewed wording are
            preserved. External routes, sample dependencies and restriction sources require the
            complete study template.
          </p>
        </>
      )}
    </SidePanel>
  );
}
