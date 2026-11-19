import { useState } from 'react';
import { AssessorShell, Field, Tabs } from '../ui';
import { OrdinaryRenderer } from '../shared/nodes/OrdinaryRenderer';
import { newNode } from '../shared/nodes/authoring';
import type { Answer } from '../shared/flow';
import { QuestionnaireEditor } from '../shared/nodes/QuestionnaireEditor';
import { QuestionnaireBlockList } from '../researcher/QuestionnaireBlocks';
import type { MatrixNode } from '../shared/nodes/authoring';
import type { Flow } from '../shared/flow';

export const batteryFixture: MatrixNode = {
  id: '16000000-0000-4000-8000-000000000001',
  kind: 'matrix_question',
  title: { en: 'Synthetic frequency battery', sv: 'Syntetiskt frekvensbatteri' },
  data: {
    instructions: {
      en: 'Synthetic fixture only; review wording for each study.',
      sv: 'Endast syntetisk testdata; granska text för varje studie.',
    },
    rows: Array.from({ length: 17 }, (_, i) => ({
      id: 'item_' + (i + 1),
      prompt: { en: 'Fixture item ' + (i + 1), sv: 'Testfråga ' + (i + 1) },
      required: false,
    })),
    options: [
      { id: 'never', label: { en: 'Never', sv: 'Aldrig' }, score: 0, exclusive: false },
      { id: 'often', label: { en: 'Often', sv: 'Ofta' }, score: 1, exclusive: false },
    ],
    allow_skip: true,
    layout: 'vertical',
  },
};
const seven = (low: string, high: string) =>
  Array.from({ length: 7 }, (_, i) => ({
    id: 'p' + (i + 1),
    label: { en: i === 0 ? low : i === 6 ? high : String(i + 1) },
    exclusive: false,
    score: i + 1,
  }));
/** Each scale layout as the tablet shows it. */
function ScaleLayouts() {
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>({});
  const layouts = ['vertical', 'horizontal', 'horizontal_ends'] as const;
  return (
    <div data-testid="scale-layouts">
      <AssessorShell label="Scale layouts" embedded>
        {layouts.map((layout) => {
          const node = newNode('question', 'en');
          if (node.kind !== 'question') throw new Error('Expected a question');
          node.data = {
            ...node.data,
            prompt: { en: 'Single question, ' + layout },
            layout,
            options: seven('Strongly disagree', 'Strongly agree').map(
              ({ score: _score, ...o }) => o,
            ),
          };
          return (
            <OrdinaryRenderer
              key={layout}
              node={node}
              language="en"
              answer={answers[layout]}
              onChange={(a) => setAnswers((previous) => ({ ...previous, [layout]: a }))}
            />
          );
        })}
        {(['horizontal', 'horizontal_ends'] as const).map((layout) => {
          const node = newNode('matrix_question', 'en');
          if (node.kind !== 'matrix_question') throw new Error('Expected a grid');
          node.data = {
            ...node.data,
            instructions: { en: 'Question grid, ' + layout },
            layout,
            allow_skip: true,
            rows: [
              { id: 'r1', prompt: { en: '1. Aroma' }, required: true },
              { id: 'r2', prompt: { en: '2. Texture' }, required: true },
              { id: 'r3', prompt: { en: '3. Aftertaste' }, required: false },
            ],
            options: seven('Strongly disagree', 'Strongly agree'),
          };
          return (
            <OrdinaryRenderer
              key={layout + '-grid'}
              node={node}
              language="en"
              answer={answers[layout + '-grid']}
              onChange={(a) => setAnswers((previous) => ({ ...previous, [layout + '-grid']: a }))}
            />
          );
        })}
      </AssessorShell>
    </div>
  );
}
export function QuestionnaireGallery({ active = true }: { active?: boolean }) {
  const [node, setNode] = useState(batteryFixture),
    [state, setState] = useState('ready'),
    [language, setLanguage] = useState('en');
  const flow: Flow = {
    schema_version: 2,
    text_version: 1,
    languages: ['en', 'sv'],
    default_language: 'en',
    nodes: [node],
  };
  return (
    <section
      id="questionnaire-gallery"
      className="ui-stack"
      aria-label="Questionnaire block fixtures"
    >
      <h2>Questionnaire blocks</h2>
      {active && (
        <>
          <Field
            label="Battery fixture language"
            kind="select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            options={flow.languages.map((l) => ({ value: l, label: l }))}
          />
          <Tabs
            label="Questionnaire states"
            value={state}
            onChange={setState}
            tabs={['ready', 'empty', 'loading', 'error', 'readonly', 'blocks', 'layouts'].map(
              (id, i) => ({
                id,
                label: id,
                content:
                  id === 'loading' ? (
                    <p role="status">Loading reviewed questionnaire…</p>
                  ) : id === 'error' ? (
                    <p role="alert">
                      Cannot read questionnaire template. Retry preserves the draft.
                    </p>
                  ) : id === 'layouts' ? (
                    <ScaleLayouts />
                  ) : id === 'blocks' ? (
                    <QuestionnaireBlockList flow={flow} onSelect={() => {}} />
                  ) : (
                    <QuestionnaireEditor
                      key={id}
                      node={{
                        ...node,
                        id: node.id.slice(0, -1) + (i + 1),
                        data: { ...node.data, rows: id === 'empty' ? [] : node.data.rows },
                      }}
                      language={language}
                      disabled={id === 'readonly'}
                      onChange={(next) =>
                        setNode({ ...(next as MatrixNode), id: batteryFixture.id })
                      }
                    />
                  ),
              }),
            )}
          />
        </>
      )}
    </section>
  );
}
