import { settingHelp } from '../shared/nodes/settingHelp';
import { useState } from 'react';
import { Field, OutlineTable, SchemaFields, Tabs } from '../ui';
import { LinearPreview } from '../shared/nodes/LinearPreview';
import { InfoTextEditor } from '../shared/nodes/InfoTextEditor';
import { OrdinaryRenderer } from '../shared/nodes/OrdinaryRenderer';
import { newNode } from '../shared/nodes/authoring';
import { QuestionnaireFile, type BankItem } from '../researcher/QuestionnaireFile';
import type { Node } from '../shared/flow';
import {
  HedonicRenderer,
  editorLabels,
  type Configuration,
} from '../shared/methods/hedonic_acceptance_9';
import type { Flow } from '../shared/flow';
import type { components } from '../api-schema';

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    instructions: { type: 'string' },
    questions: { type: 'array', minItems: 1, maxItems: 100, items: { $ref: '#/$defs/Question' } },
    scale_labels: { type: 'array', minItems: 9, maxItems: 9, items: { type: 'string' } },
    allow_skips: { type: 'boolean' },
  },
  $defs: {
    Question: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'prompt'],
      properties: {
        id: { type: 'string' },
        prompt: { type: 'string' },
        required: { type: 'boolean', default: true },
      },
    },
  },
};
const initial: Configuration = {
  instructions: 'Taste the coded sample.',
  questions: [{ id: 'liking', prompt: 'Overall liking', required: true }],
  scale_labels: [
    'Dislike extremely',
    'Dislike very much',
    'Dislike moderately',
    'Dislike slightly',
    'Neither like nor dislike',
    'Like slightly',
    'Like moderately',
    'Like very much',
    'Like extremely',
  ],
  allow_skips: false,
};
const flow: Flow = {
  schema_version: 2,
  languages: ['en'],
  default_language: 'en',
  nodes: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      kind: 'embedded_method',
      title: { en: 'Liking' },
      data: { study_test_id: '10000000-0000-4000-8000-000000000003', sample_binding: 'none' },
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      kind: 'end',
      title: { en: 'Finish' },
      data: { body: { en: 'Thank you' }, outcome: 'completed' },
    },
  ],
};
/** A nine-point scale with only the ends and the midpoint named. */
const unnamedSteps = {
  instructions: 'Taste the sample and rate it.',
  questions: [{ id: 'overall', prompt: 'How much do you like it?', required: true }],
  scale_labels: ['Dislike', '', '', '', 'Neither', '', '', '', 'Like'],
  allow_skips: false,
} as Configuration;
function UnnamedStepsFixture() {
  const [answers, setAnswers] = useState<Record<string, number | 'skipped'>>({});
  return (
    <div data-testid="unnamed-steps-fixture" className="ui-preview ui-stack">
      <HedonicRenderer
        configuration={unnamedSteps}
        answers={answers}
        onChange={(id, value) => setAnswers({ ...answers, [id]: value })}
      />
    </div>
  );
}
function QuestionnaireFileFixture() {
  const [added, setAdded] = useState<string[]>([]);
  const [items, setItems] = useState<BankItem[]>([]);
  const question = newNode('question', 'en');
  const flow: Flow = {
    schema_version: 2,
    text_version: 1,
    languages: ['en'],
    default_language: 'en',
    nodes: [
      question.kind === 'question'
        ? {
            ...question,
            title: { en: 'Nut allergy' },
            data: {
              ...question.data,
              prompt: { en: 'Do you have a nut allergy?' },
              options: question.data.options!.map((o, i) => ({
                ...o,
                label: { en: 'Option ' + i },
              })),
            },
          }
        : question,
    ],
  };
  return (
    <div data-testid="questionnaire-file-fixture" className="ui-stack">
      <QuestionnaireFile
        flow={flow}
        selectedId={flow.nodes[0].id}
        bank={{
          items: items.filter((i) => !i.archived_at),
          busy: false,
          error: '',
          onSave: async (item) => {
            setItems((previous) => [
              ...previous,
              {
                ...item,
                id: crypto.randomUUID(),
                kind: String((item.node as { kind: string }).kind),
                principal: 'gallery',
                created_at: '2026-11-18T10:00:00+00:00',
                archived_at: null,
              } as BankItem,
            ]);
          },
          onArchive: async (id) =>
            setItems((previous) =>
              previous.map((i) => (i.id === id ? { ...i, archived_at: 'now' } : i)),
            ),
        }}
        onClose={() => {}}
        onInsert={(nodes) => setAdded(nodes.map((n) => n.title.en))}
      />
      <p role="status">Added: {added.join(', ') || 'nothing'}</p>
    </div>
  );
}
/** A method's rating scale in each display chosen on its flow step. */
function MethodScaleLayoutsFixture() {
  const [answers, setAnswers] = useState<Record<string, number | 'skipped'>>({});
  return (
    <div data-testid="method-scale-layouts" className="ui-preview ui-stack">
      {(['vertical', 'horizontal', 'horizontal_ends'] as const).map((layout) => (
        <section key={layout} aria-label={'Layout ' + layout} className="ui-stack">
          <HedonicRenderer
            layout={layout}
            configuration={unnamedSteps}
            answers={answers}
            onChange={(id, value) => setAnswers({ ...answers, [id]: value })}
          />
        </section>
      ))}
    </div>
  );
}
function InfoTextFixture({
  disabled = false,
  inLoop = false,
}: {
  disabled?: boolean;
  inLoop?: boolean;
}) {
  const [node, setNode] = useState<Node>(() => {
    const info = newNode('info', 'en');
    if (info.kind === 'info')
      info.data.body.en =
        'Welcome.\nPlease **taste each sample in order**.\n\n*Rinse your mouth* between samples.';
    return info;
  });
  return (
    <div data-testid="info-text-fixture" className="ui-stack">
      {node.kind === 'info' && (
        <InfoTextEditor
          node={node}
          language="en"
          disabled={disabled}
          inLoop={inLoop}
          onChange={setNode}
        />
      )}
      <div className="ui-preview ui-stack" data-testid="info-text-rendered">
        <OrdinaryRenderer node={node} language="en" onChange={() => {}} />
      </div>
    </div>
  );
}
export function FoundationGallery() {
  const [config, setConfig] = useState(initial);
  const [tab, setTab] = useState('editor');
  const [selected, setSelected] = useState('None');
  return (
    <section id="foundation" className="ui-gallery-section" aria-label="Flow foundation fixtures">
      <h2>Flow foundation · fixtures</h2>
      <Field label="Secret fixture" kind="password" value="" onChange={() => {}} />
      <Tabs
        label="Foundation fixture states"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'editor',
            label: 'Editor',
            content: (
              <SchemaFields
                help={settingHelp}
                schema={schema}
                value={config}
                onChange={(v) => setConfig(v as Configuration)}
                labels={editorLabels}
              />
            ),
          },
          {
            id: 'readonly',
            label: 'Read-only',
            content: (
              <SchemaFields
                help={settingHelp}
                schema={schema}
                value={config}
                onChange={() => {}}
                disabled
                labels={editorLabels}
              />
            ),
          },
          { id: 'empty', label: 'Empty', content: <OutlineTable rows={[]} onSelect={() => {}} /> },
          { id: 'info-text', label: 'Information text', content: <InfoTextFixture /> },
          {
            id: 'info-text-loop',
            label: 'Information text in a sample loop',
            content: <InfoTextFixture inLoop />,
          },
          {
            id: 'questionnaire-file',
            label: 'Save or load questions',
            content: <QuestionnaireFileFixture />,
          },
          {
            id: 'method-scale-layouts',
            label: 'Method scale layouts',
            content: <MethodScaleLayoutsFixture />,
          },
          {
            id: 'unnamed-steps',
            label: 'Scale with unnamed steps',
            content: <UnnamedStepsFixture />,
          },
          {
            id: 'info-text-readonly',
            label: 'Information text, read-only',
            content: <InfoTextFixture disabled />,
          },
          {
            id: 'loading',
            label: 'Loading',
            content: (
              <p role="status" aria-busy="true">
                Loading saved flow…
              </p>
            ),
          },
          {
            id: 'error',
            label: 'Error',
            content: <p role="alert">Draft changed; reload and review.</p>,
          },
          {
            id: 'preview',
            label: 'Rehearsal',
            content: (
              <LinearPreview
                flow={flow}
                tests={[
                  {
                    id:
                      flow.nodes[0].kind === 'embedded_method'
                        ? flow.nodes[0].data.study_test_id
                        : '',
                    study_version_id: 'fixture',
                    test_type_id: 'hedonic-9-v1',
                    position: 0,
                    configuration: config,
                  } satisfies components['schemas']['TestRead'],
                ]}
              />
            ),
          },
        ]}
      />
      <OutlineTable
        rows={flow.nodes.map((n) => ({
          id: n.id,
          title: n.title.en,
          kind: n.kind,
          method: n.kind === 'embedded_method' ? 'hedonic-9-v1' : '—',
          version: n.kind === 'embedded_method' ? '1' : '—',
          state: 'Draft',
          guard: 'Always',
          otherwise: 'Continue',
        }))}
        onSelect={setSelected}
      />
      <p data-testid="foundation-selection">Selected fixture: {selected}</p>
    </section>
  );
}
