import { NodeAnswerRenderer } from '../shared/nodes/NodeAnswerRenderer';
import { methodTextFields } from '../shared/flow/text';
import { outline } from '../shared/flow';
import { useState } from 'react';
import { Button, Toolbar } from '../ui';
import { FlowCheck, PublicationSnapshot, type Issue } from '../researcher/FlowCheck';
import { MethodTextEditor } from '../shared/nodes/MethodTextEditor';
import type { Flow } from '../shared/flow';
import type { Configuration } from '../shared/methods/hedonic_acceptance_9/validation';
import { runFlow, runTests, runSamples } from './flowFixtures';
export function FlowCheckGallery() {
  const fixture = { flow: runFlow, tests: runTests, samples: runSamples };
  const [state, setState] = useState('issues');
  const [language, setLanguage] = useState('sv');
  const [flow, setFlow] = useState<Flow>({ ...fixture.flow, languages: ['en', 'sv'] });
  const [opened, setOpened] = useState('');
  const issues: Issue[] = [
    {
      severity: 'error',
      node_id: flow.nodes[0].id,
      study_test_id: null,
      path: ['nodes', flow.nodes[0].id, 'title', 'sv'],
      code: 'missing_translation',
      message: 'Review nonblank sv text',
    },
    {
      severity: 'warning',
      node_id: flow.nodes.at(-1)!.id,
      study_test_id: null,
      path: ['nodes', flow.nodes.at(-1)!.id, 'title'],
      code: 'unreachable_node',
      message: 'No structural execution path reaches this node',
    },
  ];
  return (
    <section
      className="ui-gallery-section ui-stack"
      id="flow-check"
      aria-labelledby="flow-check-title"
    >
      <h2 id="flow-check-title">Check study / publication review</h2>
      <Toolbar>
        {['issues', 'loading', 'empty', 'error', 'published', 'translations', 'tokens'].map((s) => (
          <Button key={s} onClick={() => setState(s)}>
            {'Check ' + s}
          </Button>
        ))}
      </Toolbar>
      {state === 'tokens' ? (
        <NodeAnswerRenderer
          node={outline(runFlow.nodes).find((e) => e.node.kind === 'embedded_method')!.node}
          tests={runTests}
          language="sv"
          flow={{
            ...runFlow,
            text_version: 1,
            method_text: {
              [runTests[0].id]: Object.fromEntries(
                Object.entries(methodTextFields(runTests[0].configuration as Configuration)).map(
                  ([p, t]) => [
                    p,
                    {
                      en: t,
                      sv:
                        p === '/instructions'
                          ? '<b>{{sample_code}}</b> · {{sample_position}}'
                          : 'Sv ' + t,
                    },
                  ],
                ),
              ),
            },
          }}
          variables={{ 'sample.code': '<X>', 'sample.position': 0 }}
          onChange={() => {}}
        />
      ) : state === 'translations' ? (
        <MethodTextEditor
          flow={flow}
          testId={fixture.tests[0].id}
          configuration={fixture.tests[0].configuration as Configuration}
          language={language}
          onLanguage={setLanguage}
          onChange={setFlow}
        />
      ) : (
        <>
          {state === 'published' && (
            <PublicationSnapshot
              version={{
                id: 'gallery-version',
                study_id: 'gallery-study',
                version_number: 1,
                title: 'Reviewed fixture',
                description: '',
                published_at: '2026-10-10',
                form: fixture.flow,
                revision_hash: 'gallery-hash',
              }}
              tests={fixture.tests}
              samples={fixture.samples}
            />
          )}
          <FlowCheck
            loading={state === 'loading'}
            error={state === 'error' ? 'Read failed; saved fields retained.' : ''}
            report={
              state === 'loading' || state === 'error'
                ? undefined
                : {
                    study_version_id: 'gallery-version',
                    revision_hash: 'gallery-hash',
                    valid: state !== 'issues',
                    issues: state === 'issues' ? issues : [],
                  }
            }
            onRetry={() => setState('issues')}
            onOpen={(i) => setOpened(i.path.join(' → '))}
          />
          {opened && <p role="status">Open field: {opened}</p>}
        </>
      )}
    </section>
  );
}
