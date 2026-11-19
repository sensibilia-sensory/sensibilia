import { LinearPreview } from '../shared/nodes/LinearPreview';
import { OrdinaryRenderer } from '../shared/nodes/OrdinaryRenderer';
import { answerValid } from '../shared/nodes/answers';
import type { Answer } from '../shared/flow';
import { useState } from 'react';
import { Button, ChoiceScale, Field, OutlineTable, PropertyGrid, SchemaFields, Tabs } from '../ui';
import { GuardProperties } from '../shared/nodes/GuardProperties';
import { newNode, nodeFields, nodeKinds } from '../shared/nodes/authoring';
import { moveNodeTo, outline, updateNode, type Flow } from '../shared/flow';
export function GuardsGallery() {
  const [flow, setFlow] = useState<Flow>(() => ({
    schema_version: 2,
    languages: ['en'],
    default_language: 'en',
    nodes: [newNode('consent', 'en'), newNode('group', 'en'), newNode('end', 'en')],
  }));
  const [selected, setSelected] = useState(flow.nodes[0].id),
    [tab, setTab] = useState('edit'),
    [answer, setAnswer] = useState<string[]>([]);
  const [rendererAnswer, setRendererAnswer] = useState<Answer>();
  const [rendererReadOnly, setRendererReadOnly] = useState(false);
  const [fixtureNotice, setFixtureNotice] = useState('Fixture answers stay in memory.');
  const node = outline(flow.nodes).find((e) => e.node.id === selected)?.node ?? flow.nodes[0],
    fields = nodeFields(node, 'en');
  return (
    <section id="guards" className="ui-gallery-section" aria-label="Guard fixtures">
      <h2>Guards and Otherwise · fixtures</h2>
      <Field
        label="Fixture node kind"
        kind="select"
        value={node.kind}
        options={nodeKinds.map((value) => ({ value, label: value }))}
        onChange={(e) => {
          const next = newNode(e.target.value as (typeof nodeKinds)[number], 'en');
          setSelected(next.id);
          setFlow({ ...flow, nodes: [next, ...flow.nodes.slice(1)] });
        }}
      />
      <Tabs
        label="Guard fixture states"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'edit', label: 'Edit', content: null },
          { id: 'readonly', label: 'Read-only', content: null },
          {
            id: 'renderers',
            label: 'Renderers',
            content: (
              <div className="ui-stack">
                <Field
                  label="Read-only renderer"
                  kind="checkbox"
                  checked={rendererReadOnly}
                  onChange={(e) => setRendererReadOnly(e.target.checked)}
                />
                <div className="ui-preview ui-stack">
                  <OrdinaryRenderer
                    key={node.id}
                    node={node}
                    language="en"
                    answer={rendererAnswer}
                    onChange={setRendererAnswer}
                    disabled={rendererReadOnly}
                  />
                  <Button
                    disabled={rendererReadOnly || !answerValid(node, rendererAnswer, {})}
                    onClick={() =>
                      setFixtureNotice(`Accepted ${rendererAnswer?.state} fixture answer.`)
                    }
                  >
                    Fixture Continue
                  </Button>
                  <p role="status">{fixtureNotice}</p>
                </div>
                <Field
                  label="Renderer state"
                  value={JSON.stringify(rendererAnswer) ?? 'missing'}
                  onChange={() => {}}
                  disabled
                />
                <Button onClick={() => setRendererAnswer(undefined)}>Reset fixture answer</Button>
              </div>
            ),
          },
          {
            id: 'codereset',
            label: 'Code reset',
            content: (
              <LinearPreview
                tests={[]}
                flow={{
                  schema_version: 2,
                  languages: ['en'],
                  default_language: 'en',
                  nodes: [
                    {
                      id: '30000000-0000-4000-8000-000000000001',
                      kind: 'code_entry',
                      title: { en: 'First code' },
                      data: {
                        prompt: { en: 'First code input' },
                        source: 'returning_codes',
                        allow_unknown: false,
                        normalization: 'trim_upper_ascii',
                      },
                    },
                    {
                      id: '30000000-0000-4000-8000-000000000002',
                      kind: 'end',
                      title: { en: 'Done' },
                      data: { body: { en: 'Done' }, outcome: 'completed' },
                    },
                  ],
                }}
              />
            ),
          },
          { id: 'empty', label: 'Empty', content: <p>No condition. Always / Continue.</p> },
          {
            id: 'loading',
            label: 'Loading',
            content: (
              <p aria-busy="true" role="status">
                Loading guard properties…
              </p>
            ),
          },
          {
            id: 'error',
            label: 'Error',
            content: <p role="alert">Illegal backward target; buffer retained.</p>,
          },
        ]}
      />
      {['edit', 'readonly'].includes(tab) && (
        <>
          <GuardProperties
            flow={flow}
            node={node}
            disabled={tab === 'readonly'}
            onChange={(next) =>
              setFlow({ ...flow, nodes: updateNode(flow.nodes, node.id, () => next) })
            }
          />
          <SchemaFields
            schema={fields.schema}
            value={fields.value}
            disabled={tab === 'readonly'}
            onChange={(data) =>
              setFlow({
                ...flow,
                nodes: updateNode(
                  flow.nodes,
                  node.id,
                  (n) => ({ ...n, data: fields.restore(data) }) as typeof n,
                ),
              })
            }
          />
        </>
      )}
      <OutlineTable
        rows={outline(flow.nodes).map((e) => ({
          id: e.node.id,
          title: e.node.title.en,
          kind: e.node.kind,
          method: '—',
          version: '—',
          state: 'Draft',
          guard: 'Always',
          otherwise: 'Continue',
          number: e.number,
          depth: e.ancestors.length,
          container: e.node.kind === 'group',
        }))}
        onSelect={setSelected}
        canDrop={(id, targetId, position) =>
          moveNodeTo(flow.nodes, id, targetId, position) !== undefined
        }
        onDrop={(id, targetId, position) => {
          const nodes = moveNodeTo(flow.nodes, id, targetId, position);
          if (nodes) setFlow({ ...flow, nodes });
        }}
      />
      <PropertyGrid
        sections={[
          {
            title: 'Touch choices',
            defaultOpen: true,
            children: (
              <ChoiceScale
                label="Fixture restrictions"
                options={[
                  { value: 'nuts', label: 'Nuts' },
                  { value: 'none', label: 'None' },
                ]}
                multiple
                showValues={false}
                value={answer}
                onChange={(value) =>
                  setAnswer(
                    answer.includes(String(value))
                      ? answer.filter((v) => v !== value)
                      : [...answer, String(value)],
                  )
                }
              />
            ),
          },
        ]}
      />
      <Field label="Fixture selection" value={answer.join(',')} onChange={() => {}} disabled />
    </section>
  );
}
