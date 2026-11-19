import { useCallback, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  FormStep,
  MatrixStep,
  Selection,
  StepValue,
  StudyForm,
  StudyTest,
  Sample,
  Configuration,
} from './api';
import { MatrixRenderer } from './MatrixRenderer';
import { MethodRenderer } from './MethodRenderer';
import { isHedonic, previewAssignment } from './methods';
import { nextStep } from './flow';

function hedonicMatrix(step: Extract<FormStep, { kind: 'test' }>, test: StudyTest): MatrixStep {
  const config = test.configuration as Configuration;
  return {
    kind: 'matrix',
    id: step.id,
    title: step.title,
    instructions: config.instructions,
    rows: config.questions,
    scale: (config.scale_labels ?? []).map((label, i) => ({
      id: `${i + 1}`,
      label,
      score: i + 1,
    })),
    allow_skips: config.allow_skips ?? false,
  };
}

/** Interactive rehearsal of the published routing semantics; never submits observations. */
export function FlowPreview({
  form,
  tests,
  samples = [],
  singleStep,
}: {
  form: StudyForm;
  tests: StudyTest[];
  samples?: Sample[];
  singleStep?: FormStep;
}) {
  const [current, setCurrent] = useState(singleStep?.id ?? form.steps[0]?.id ?? 'complete');
  const [values, setValues] = useState<Record<string, StepValue>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Selection>>({});
  const [visited, setVisited] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [methodReady, setMethodReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const methodChange = useCallback((_: unknown, ready: boolean) => setMethodReady(ready), []);
  const step =
    singleStep?.id === current ? singleStep : form.steps.find((item) => item.id === current);
  const test =
    step?.kind === 'test' ? tests.find((test) => test.id === step.study_test_id) : undefined;
  const matrix =
    step?.kind === 'matrix'
      ? step
      : step?.kind === 'test' && test && isHedonic(test.configuration)
        ? hedonicMatrix(step, test)
        : undefined;
  const methodConfig = test && !isHedonic(test.configuration) ? test.configuration : null;
  const methodAssignment = useMemo(
    () => (methodConfig ? previewAssignment(methodConfig, samples) : null),
    [methodConfig, samples],
  );
  const terminal = current === 'complete' || current === 'screen_out';
  const ready =
    step?.kind === 'instruction'
      ? !step.acknowledgement_label || acknowledged
      : step?.kind === 'choice'
        ? selected.length > 0
        : matrix
          ? matrix.rows.every((row) => !row.required || answers[row.id] != null)
          : methodConfig
            ? methodReady
            : false;

  function restart() {
    setRevision((previous) => previous + 1);
    setCurrent(singleStep?.id ?? form.steps[0]?.id ?? 'complete');
    setValues({});
    setSelected([]);
    setAcknowledged(false);
    setAnswers({});
    setVisited([]);
    setError('');
    setMethodReady(false);
  }
  function continueStep() {
    if (!step || !ready) return;
    const value: StepValue =
      step.kind === 'choice'
        ? { state: 'answered', selected }
        : step.kind === 'matrix'
          ? { state: 'matrix', answers }
          : { state: 'continued', acknowledged };
    const updated = { ...values, [step.id]: value };
    try {
      const destination = singleStep ? 'complete' : nextStep(form, step, updated);
      if (
        !['complete', 'screen_out'].includes(destination) &&
        !form.steps.some((item) => item.id === destination)
      )
        throw new Error('This route refers to a missing block. Choose another destination.');
      setVisited([...visited, step.id]);
      setCurrent(destination);
      setValues(updated);
      setSelected([]);
      setAcknowledged(false);
      setAnswers({});
      setMethodReady(false);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Check the routing rule.');
    }
  }
  function choose(id: string) {
    if (step?.kind !== 'choice') return;
    const option = step.options.find((option) => option.id === id)!;
    if (!step.multiple) setSelected([id]);
    else if (option.exclusive) setSelected(selected.includes(id) ? [] : [id]);
    else if (selected.includes(id)) setSelected(selected.filter((value) => value !== id));
    else
      setSelected([
        ...selected.filter(
          (value) => !step.options.find((option) => option.id === value)?.exclusive,
        ),
        id,
      ]);
  }
  function answer(row: string, value: Selection) {
    setAnswers({ ...answers, [row]: value });
  }

  return (
    <div className="flow-rehearsal" aria-label={singleStep ? 'Block preview' : 'Session preview'}>
      <div className="preview-toolbar">
        <span>{singleStep ? 'BLOCK PREVIEW' : 'SESSION PREVIEW'}</span>
        <button type="button" className="text-button" onClick={restart}>
          <RotateCcw size={15} /> Restart preview
        </button>
      </div>
      <p className="preview-caption">Preview answers stay here and are not collected.</p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {terminal ? (
        <div className="flow-ending" role="status">
          <span className="eyebrow">{current === 'screen_out' ? 'SCREENED OUT' : 'FINISHED'}</span>
          <h3>
            {singleStep
              ? 'Block preview complete'
              : current === 'screen_out'
                ? form.screen_out_message
                : form.completion_message}
          </h3>
        </div>
      ) : step ? (
        <div className="flow-screen">
          <span className="eyebrow">
            {singleStep ? 'ASSESSOR VIEW' : `SCREEN ${visited.length + 1}`}
          </span>
          <h2>{step.title || 'Untitled block'}</h2>
          {step.kind === 'instruction' && (
            <>
              <div className="instruction-body">
                {step.text || 'Instruction text will appear here.'}
              </div>
              {step.acknowledgement_label != null && (
                <label className="checkbox-label acknowledgement">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />{' '}
                  {step.acknowledgement_label || 'Acknowledgment wording'}
                </label>
              )}
            </>
          )}
          {step.kind === 'choice' && (
            <>
              <div className="instruction-body">{step.text}</div>
              <fieldset className="preview-choice">
                <legend>{step.prompt || 'Your question will appear here.'}</legend>
                {step.options.map((option) => (
                  <label
                    className={`choice-answer ${selected.includes(option.id) ? 'chosen' : ''}`}
                    key={option.id}
                  >
                    <input
                      type={step.multiple ? 'checkbox' : 'radio'}
                      name={`choice-${step.id}`}
                      checked={selected.includes(option.id)}
                      onChange={() => choose(option.id)}
                    />{' '}
                    {option.label || 'Choice label'}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {matrix &&
            (step.kind === 'matrix' || (step.kind === 'test' && step.layout === 'matrix')) && (
              <MatrixRenderer step={matrix} answers={answers} change={answer} />
            )}
          {matrix && step.kind === 'test' && step.layout === 'cards' && (
            <>
              <p className="instruction-body">{matrix.instructions}</p>
              {matrix.rows.map((row) => (
                <fieldset className="preview-question" key={row.id}>
                  <legend>
                    {row.prompt}
                    <span className="row-required">{row.required ? 'Required' : 'Optional'}</span>
                  </legend>
                  <div className="rating-grid">
                    {matrix.scale.map((option) => (
                      <label
                        className={`rating-option ${answers[row.id]?.option_id === option.id ? 'chosen' : ''}`}
                        key={option.id}
                      >
                        <input
                          type="radio"
                          name={`hedonic-${step.id}-${row.id}`}
                          checked={
                            answers[row.id]?.state === 'selected' &&
                            answers[row.id]?.option_id === option.id
                          }
                          onChange={() =>
                            answer(row.id, { state: 'selected', option_id: option.id })
                          }
                        />
                        <span className="rating-number">{option.id}</span>
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  {matrix.allow_skips && (
                    <label className="checkbox-label">
                      <input
                        type="radio"
                        name={`hedonic-${step.id}-${row.id}`}
                        checked={answers[row.id]?.state === 'skipped'}
                        onChange={() => answer(row.id, { state: 'skipped', option_id: null })}
                      />{' '}
                      Skip this question
                    </label>
                  )}
                </fieldset>
              ))}
            </>
          )}
          {step.kind === 'test' && methodConfig && methodAssignment && (
            <MethodRenderer
              key={`${step.id}-${revision}`}
              configuration={methodConfig}
              assignment={methodAssignment}
              change={methodChange}
            />
          )}
          {step.kind === 'test' && !test && (
            <p className="alert error">This configured test is missing from the version.</p>
          )}
          <div className="flow-continue">
            <span className="field-help">
              {ready
                ? 'Ready to continue'
                : step.kind === 'instruction'
                  ? 'Confirm that you have read and understood the text.'
                  : 'Complete the required answers to continue.'}
            </span>
            <button
              type="button"
              className="button primary"
              disabled={!ready}
              onClick={continueStep}
            >
              {step.kind === 'instruction' ? step.continue_label || 'Continue' : 'Continue'}
            </button>
          </div>
        </div>
      ) : (
        <div className="alert error">This block could not be found.</div>
      )}
      {!singleStep && visited.length > 0 && (
        <div className="preview-path">
          <span className="eyebrow">ROUTE TAKEN</span>
          <ol>
            {visited.map((id) => (
              <li key={id}>{form.steps.find((step) => step.id === id)?.title}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
