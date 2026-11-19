import { useMemo, useState } from 'react';
import type { components } from '../../api-schema';
import { Button, Field, PropertyGrid } from '../../ui';
import {
  advance,
  occurrenceId,
  type Sample,
  currentNode,
  initialState,
  outline,
  returnFromReview,
  reviewable,
  type Flow,
  type Answer,
  type State,
} from '../flow';
import { displayText } from '../flow/text';
import { NodeAnswerRenderer } from './NodeAnswerRenderer';
import { rehearsalPackage, rehearsalContext, rehearsalAnswerValid } from './rehearsal';
type Test = components['schemas']['TestRead'];
/** Shared rehearsal composition; the historical export name remains compatible. */
export function LinearPreview({
  flow,
  tests,
  samples = [],
  designs = [],
  sequenceIndex = 0,
}: {
  flow: Flow;
  tests: Test[];
  samples?: Sample[];
  designs?: components['schemas']['DesignRead'][];
  sequenceIndex?: number;
}) {
  const { issues, assignments, methodAssignments } = useMemo(
    () => rehearsalPackage(flow, tests, samples, designs, sequenceIndex),
    [flow, tests, samples, designs, sequenceIndex],
  );
  const [state, setState] = useState<State>(() =>
    issues.length ? initialState() : initialState(flow, {}, assignments, methodAssignments),
  );
  const [language, setLanguage] = useState(flow.default_language);
  const [answer, setAnswer] = useState<Answer>();
  const [generation, setGeneration] = useState(0);
  const [returning, setReturning] = useState(''),
    [booth, setBooth] = useState(''),
    [table, setTable] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const node = currentNode(flow, state);
  const displayed = state.review && node ? state.answers[node.id] : answer;
  const valid = node && rehearsalAnswerValid(node, answer, state.variables, tests);
  const reset = async (nextLanguage = language) => {
    setBusy(true);
    setError('');
    try {
      const context = await rehearsalContext(flow, returning, booth, table);
      setState(
        issues.length
          ? initialState()
          : initialState(
              flow,
              { ...context, 'context.language': nextLanguage },
              assignments,
              methodAssignments,
            ),
      );
      setAnswer(undefined);
      setGeneration((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rehearsal failed.');
    } finally {
      setBusy(false);
    }
  };
  const prior = [...state.visited].reverse().find(
    (id) =>
      reviewable(state.answers[id]) &&
      (!state.loop ||
        outline(flow.nodes)
          .find((e) => e.node.id === id)
          ?.ancestors.includes(state.loop.id)),
  );
  return (
    <section className="ui-preview ui-stack" aria-label="Assessor rehearsal">
      <p>Rehearsal · {language} · answers stay in memory</p>
      <Field
        label="Rehearsal language"
        kind="select"
        value={language}
        options={flow.languages.map((value) => ({ value, label: value }))}
        disabled={busy}
        onChange={(e) => {
          setLanguage(e.target.value);
          void reset(e.target.value);
        }}
      />
      <PropertyGrid
        sections={[
          {
            title: 'Rehearsal context',
            children: (
              <div className="ui-stack">
                <Field
                  label="Returning codes"
                  value={returning}
                  onChange={(e) => setReturning(e.target.value)}
                  hint="Comma-separated pseudonymous fixture codes, in memory only."
                />
                <Field
                  label="Booth number"
                  kind="number"
                  value={booth}
                  onChange={(e) => setBooth(e.target.value)}
                />
                <Field
                  label="Table number"
                  kind="number"
                  value={table}
                  onChange={(e) => setTable(e.target.value)}
                />
                <Button disabled={busy} onClick={() => void reset()}>
                  Apply rehearsal context and reset
                </Button>
              </div>
            ),
          },
        ]}
      />
      {error && <p role="alert">{error}</p>}
      {issues.length ? (
        <p role="alert">{issues.join(' ')}</p>
      ) : !node ? (
        <p>No nodes.</p>
      ) : (
        <>
          {state.loop && (
            <p role="status">
              Sample {String(state.variables['sample.position'])} · code{' '}
              {String(state.variables['sample.code'])}
            </p>
          )}
          <h2>
            {displayText(node.title[language] ?? '', state.variables, flow.text_version === 1)}
          </h2>
          {state.review && <p role="status">Review only · answers are locked</p>}
          {node.kind === 'end' ? (
            <p role="status">
              {displayText(node.data.body[language] ?? '', state.variables)} · {node.data.outcome}
            </p>
          ) : (
            <>
              <NodeAnswerRenderer
                key={
                  generation +
                  ':' +
                  occurrenceId(state) +
                  ':' +
                  node.id +
                  (state.review ? 'review' : 'answer')
                }
                node={node}
                tests={tests}
                assignments={methodAssignments}
                language={language}
                flow={flow}
                variables={state.variables}
                answer={displayed}
                onChange={setAnswer}
                disabled={!!state.review}
              />
              {state.review ? (
                <Button
                  onClick={() => {
                    setState(returnFromReview(flow, state));
                    setAnswer(undefined);
                  }}
                >
                  Return to flow
                </Button>
              ) : (
                <Button
                  disabled={busy || !valid}
                  onClick={() => {
                    try {
                      setState(
                        advance(
                          flow,
                          state,
                          node.kind === 'info'
                            ? { state: 'continued', acknowledged: true }
                            : answer,
                        ),
                      );
                      setAnswer(undefined);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Rehearsal failed.');
                    }
                  }}
                >
                  {node.kind === 'info'
                    ? displayText(node.data.continue_label[language] ?? '', state.variables)
                    : 'Next'}
                </Button>
              )}
            </>
          )}
          {!state.review && prior && !state.outcome && (
            <Button
              onClick={() => setState({ ...state, review: { nodeId: prior, resume: state.index } })}
            >
              Review previous answer
            </Button>
          )}
        </>
      )}
      <Button disabled={busy} onClick={() => void reset()}>
        Reset rehearsal
      </Button>
    </section>
  );
}
