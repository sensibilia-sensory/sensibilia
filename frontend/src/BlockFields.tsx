import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { FormStep, MatrixStep, StudyForm, StudyTest } from './api';
import { testSummary } from './methods';
import { code } from './flow';
import { CompactTextarea } from './CompactTextarea';

export const agreementLabels = [
  'Disagree strongly',
  'Disagree',
  'Disagree slightly',
  'Neither agree nor disagree',
  'Agree slightly',
  'Agree',
  'Agree strongly',
];
const frequencyLabels = [
  'Never',
  'Less than once a month',
  '1–3 times a month',
  '1–3 times a week',
  '4–6 times a week',
  'Once a day',
  '2 or more times a day',
];
const familiarityLabels = [
  'I do not recognize the product',
  'I recognize it, but have not tasted it',
  'I have tasted it, but do not consume it',
  'Less than once a month',
  '1–3 times a month',
  '1–3 times a week',
  '4–6 times a week',
  'Once a day or more',
];

function Tools({
  label,
  index,
  count,
  move,
  remove,
}: {
  label: string;
  index: number;
  count: number;
  move: (direction: number) => void;
  remove: () => void;
}) {
  return (
    <div className="question-tools">
      <button
        type="button"
        className="icon-button"
        aria-label={`Move ${label} ${index + 1} up`}
        disabled={index === 0}
        onClick={() => move(-1)}
      >
        <ArrowUp size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`Move ${label} ${index + 1} down`}
        disabled={index === count - 1}
        onClick={() => move(1)}
      >
        <ArrowDown size={16} />
      </button>
      <button
        type="button"
        className="icon-button danger-icon"
        aria-label={`Remove ${label} ${index + 1}`}
        disabled={count <= (label === 'row' ? 1 : 2)}
        onClick={remove}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function moved<T>(items: T[], index: number, direction: number): T[] {
  const result = [...items];
  [result[index], result[index + direction]] = [result[index + direction], result[index]];
  return result;
}

function MatrixFields({
  step,
  form,
  change,
  panel,
}: {
  panel: string;
  step: MatrixStep;
  form: StudyForm;
  change: (step: MatrixStep) => void;
}) {
  const [bulk, setBulk] = useState('');
  const [showCodes, setShowCodes] = useState(false);
  const batteries = form.steps.filter(
    (item): item is MatrixStep => item.kind === 'matrix' && item.id !== step.id,
  );
  return (
    <>
      {panel === 'content' && (
        <>
          <label className="field-label">
            Battery instructions
            <textarea
              required
              rows={3}
              maxLength={10000}
              value={step.instructions}
              placeholder="e.g. Please state your agreement with each statement."
              onChange={(event) => change({ ...step, instructions: event.target.value })}
            />
          </label>
          <section className="form-section">
            <div className="section-row">
              <h3>Questions / matrix rows</h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showCodes}
                  onChange={(event) => setShowCodes(event.target.checked)}
                />
                Show row codes
              </label>
              <span className="count-label">{step.rows.length} / 100</span>
            </div>
            <p className="field-help">Each row uses the shared response scale below.</p>
            {step.rows.map((row, index) => (
              <div className="question-card" key={index}>
                <div className="question-heading">
                  <label className="field-label" htmlFor={`matrix-row-${row.id}`}>
                    Row {index + 1}
                  </label>
                  <Tools
                    label="row"
                    index={index}
                    count={step.rows.length}
                    move={(direction) =>
                      change({ ...step, rows: moved(step.rows, index, direction) })
                    }
                    remove={() =>
                      change({ ...step, rows: step.rows.filter((_, i) => i !== index) })
                    }
                  />
                </div>
                <CompactTextarea
                  id={`matrix-row-${row.id}`}
                  required
                  rows={1}
                  maxLength={2000}
                  value={row.prompt}
                  onChange={(event) =>
                    change({
                      ...step,
                      rows: step.rows.map((item, i) =>
                        i === index ? { ...item, prompt: event.target.value } : item,
                      ),
                    })
                  }
                />
                <div className="question-settings">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={row.required}
                      onChange={(event) =>
                        change({
                          ...step,
                          rows: step.rows.map((item, i) =>
                            i === index ? { ...item, required: event.target.checked } : item,
                          ),
                        })
                      }
                    />{' '}
                    Answer required
                  </label>
                  {showCodes && (
                    <details className="question-code" open>
                      <summary>Row code</summary>
                      <label className="sr-only" htmlFor={`row-code-${row.id}`}>
                        Row {index + 1} code
                      </label>
                      <input
                        id={`row-code-${row.id}`}
                        required
                        pattern="[A-Za-z0-9_-]+"
                        maxLength={100}
                        value={row.id}
                        onChange={(event) =>
                          change({
                            ...step,
                            rows: step.rows.map((item, i) =>
                              i === index ? { ...item, id: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </details>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="button subtle"
              disabled={step.rows.length >= 100}
              onClick={() =>
                change({
                  ...step,
                  rows: [...step.rows, { id: code('row'), prompt: '', required: true }],
                })
              }
            >
              <Plus size={16} /> Add row
            </button>
            <details className="bulk-rows">
              <summary>Add several rows at once</summary>
              <label className="field-label">
                One statement per line
                <textarea
                  rows={3}
                  maxLength={200000}
                  value={bulk}
                  onChange={(event) => setBulk(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={
                  !bulk.trim() ||
                  step.rows.filter((row) => row.prompt.trim()).length +
                    bulk.split('\n').filter((line) => line.trim()).length >
                    100
                }
                onClick={() => {
                  change({
                    ...step,
                    rows: [
                      ...step.rows.filter((row) => row.prompt.trim()),
                      ...bulk
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((prompt) => ({ id: code('row'), prompt, required: true })),
                    ],
                  });
                  setBulk('');
                }}
              >
                Add statements
              </button>
            </details>
          </section>
        </>
      )}
      {panel === 'scale' && (
        <section className="form-section">
          <div className="section-row">
            <h3>Shared response scale</h3>
            <span className="pill neutral">{step.scale.length} options</span>
          </div>
          <p className="field-help">
            Edit these labels once for the whole battery. Scores are optional and are exported
            without automatic reverse scoring.
          </p>
          <label className="field-label">
            Scale template
            <select
              value="custom"
              onChange={(event) => {
                const labels =
                  event.target.value === 'agreement'
                    ? agreementLabels
                    : event.target.value === 'frequency'
                      ? frequencyLabels
                      : familiarityLabels;
                change({
                  ...step,
                  scale: labels.map((label, i) => ({ id: `option_${i + 1}`, label, score: null })),
                });
              }}
            >
              <option value="custom">Custom labels</option>
              <option value="agreement">Agreement · 7 options</option>
              <option value="frequency">Consumption frequency · 7 options</option>
              <option value="familiarity">Familiarity / consumption · 8 options</option>
            </select>
          </label>
          {batteries.length > 0 && (
            <label className="field-label">
              Copy scale from another battery
              <select
                value=""
                onChange={(event) => {
                  const source = batteries.find((item) => item.id === event.target.value);
                  if (source)
                    change({ ...step, scale: source.scale.map((option) => ({ ...option })) });
                }}
              >
                <option value="">Choose a battery</option>
                {batteries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="scale-option-list">
            {step.scale.map((option, index) => (
              <div className="scale-editor-option" key={option.id}>
                <label className="field-label">
                  Option {index + 1} label
                  <input
                    required
                    maxLength={500}
                    value={option.label}
                    onChange={(event) =>
                      change({
                        ...step,
                        scale: step.scale.map((item, i) =>
                          i === index ? { ...item, label: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="field-label score-field">
                  Score
                  <input
                    type="number"
                    step={1}
                    aria-label={`Option ${index + 1} score`}
                    value={option.score ?? ''}
                    placeholder="None"
                    onChange={(event) =>
                      change({
                        ...step,
                        scale: step.scale.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                score:
                                  event.target.value === '' ? null : Number(event.target.value),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <Tools
                  label="scale option"
                  index={index}
                  count={step.scale.length}
                  move={(direction) =>
                    change({ ...step, scale: moved(step.scale, index, direction) })
                  }
                  remove={() =>
                    change({ ...step, scale: step.scale.filter((_, i) => i !== index) })
                  }
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button subtle"
            disabled={step.scale.length >= 11}
            onClick={() =>
              change({
                ...step,
                scale: [...step.scale, { id: code('option'), label: '', score: null }],
              })
            }
          >
            <Plus size={16} /> Add scale option
          </button>
        </section>
      )}
      {panel === 'settings' && (
        <section className="form-section">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={step.allow_skips}
              onChange={(event) => change({ ...step, allow_skips: event.target.checked })}
            />{' '}
            Allow explicit skips for matrix rows
          </label>
          <details className="block-code">
            <summary>Row and scale identifiers</summary>
            <dl className="identifier-list">
              {step.rows.map((row) => (
                <div key={row.id}>
                  <dt>
                    <code>{row.id}</code>
                  </dt>
                  <dd>{row.prompt || 'Untitled row'}</dd>
                </div>
              ))}
              {step.scale.map((option) => (
                <div key={option.id}>
                  <dt>
                    <code>{option.id}</code>
                  </dt>
                  <dd>{option.label}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      )}
    </>
  );
}

export function BlockFields({
  step,
  form,
  tests,
  change,
  panel,
}: {
  panel: string;
  step: FormStep;
  form: StudyForm;
  tests: StudyTest[];
  change: (step: FormStep) => void;
}) {
  return (
    <>
      {panel === 'content' && (
        <label className="field-label">
          Block title
          <input
            required
            maxLength={250}
            value={step.title}
            onChange={(event) => change({ ...step, title: event.target.value })}
          />
        </label>
      )}
      {panel === 'settings' && (
        <details className="block-code" open>
          <summary>Block identifier</summary>
          <code>{step.id}</code>
          <p className="field-help">
            This stable code identifies the block in published packages and exports.
          </p>
        </details>
      )}
      {step.kind === 'instruction' && panel === 'content' && (
        <>
          <label className="field-label">
            Instruction text
            <textarea
              required
              rows={4}
              maxLength={30000}
              value={step.text}
              placeholder="Write the text the assessor should read before continuing."
              onChange={(event) => change({ ...step, text: event.target.value })}
            />
          </label>
        </>
      )}
      {step.kind === 'instruction' && panel === 'settings' && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={step.acknowledgement_label != null}
              onChange={(event) =>
                change({
                  ...step,
                  acknowledgement_label: event.target.checked
                    ? 'I have read and understood these instructions.'
                    : null,
                })
              }
            />{' '}
            Require acknowledgment before continuing
          </label>
          {step.acknowledgement_label != null && (
            <label className="field-label">
              Acknowledgment wording
              <input
                required
                maxLength={500}
                value={step.acknowledgement_label}
                onChange={(event) => change({ ...step, acknowledgement_label: event.target.value })}
              />
            </label>
          )}
          <label className="field-label">
            Continue button label
            <input
              required
              maxLength={100}
              value={step.continue_label}
              onChange={(event) => change({ ...step, continue_label: event.target.value })}
            />
          </label>
        </>
      )}
      {step.kind === 'choice' && panel === 'content' && (
        <>
          <label className="field-label">
            Introductory text
            <textarea
              rows={3}
              maxLength={30000}
              value={step.text}
              placeholder="e.g. Participant information or the ingredients used in this study."
              onChange={(event) => change({ ...step, text: event.target.value })}
            />
          </label>
          <label className="field-label">
            Choice question
            <textarea
              required
              rows={1}
              maxLength={2000}
              value={step.prompt}
              onChange={(event) => change({ ...step, prompt: event.target.value })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={step.multiple}
              onChange={(event) => change({ ...step, multiple: event.target.checked })}
            />{' '}
            Allow multiple selections
          </label>
          <p className="field-help">
            An answer is required. For multiple choices, mark “None” or a similar answer as
            exclusive.
          </p>
          {step.options.map((option, index) => (
            <div className="choice-editor-option" key={option.id}>
              <div className="section-row">
                <label className="field-label" htmlFor={`choice-option-${option.id}`}>
                  Choice option {index + 1}
                </label>
                <Tools
                  label="choice option"
                  index={index}
                  count={step.options.length}
                  move={(direction) =>
                    change({ ...step, options: moved(step.options, index, direction) })
                  }
                  remove={() =>
                    change({ ...step, options: step.options.filter((_, i) => i !== index) })
                  }
                />
              </div>
              <input
                id={`choice-option-${option.id}`}
                required
                maxLength={500}
                value={option.label}
                onChange={(event) =>
                  change({
                    ...step,
                    options: step.options.map((item, i) =>
                      i === index ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
              {step.multiple && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={option.exclusive}
                    onChange={(event) =>
                      change({
                        ...step,
                        options: step.options.map((item, i) =>
                          i === index ? { ...item, exclusive: event.target.checked } : item,
                        ),
                      })
                    }
                  />{' '}
                  Exclusive answer
                </label>
              )}
              <span className="field-help">Code: {option.id}</span>
            </div>
          ))}
          <button
            type="button"
            className="button subtle"
            disabled={step.options.length >= 100}
            onClick={() =>
              change({
                ...step,
                options: [...step.options, { id: code('choice'), label: '', exclusive: false }],
              })
            }
          >
            <Plus size={16} /> Add choice option
          </button>
        </>
      )}
      {step.kind === 'matrix' && (
        <MatrixFields key={step.id} step={step} form={form} change={change} panel={panel} />
      )}
      {step.kind === 'test' && panel === 'content' && (
        <>
          <label className="field-label">
            Configured sensory test
            <select
              value={step.study_test_id}
              onChange={(event) =>
                change({
                  ...step,
                  study_test_id: event.target.value,
                  layout:
                    tests.find((test) => test.id === event.target.value)?.test_type_id ===
                    'hedonic-9-v1'
                      ? step.layout
                      : 'cards',
                })
              }
            >
              {tests.map((test) => (
                <option value={test.id} key={test.id}>
                  Test {test.position + 1} · {testSummary(test)}
                </option>
              ))}
            </select>
          </label>
          {tests.find((test) => test.id === step.study_test_id)?.test_type_id ===
            'hedonic-9-v1' && (
            <label className="field-label">
              Question presentation
              <select
                value={step.layout}
                onChange={(event) =>
                  change({ ...step, layout: event.target.value as 'cards' | 'matrix' })
                }
              >
                <option value="cards">Individual question cards</option>
                <option value="matrix">Matrix with one shared nine-point scale</option>
              </select>
            </label>
          )}
          <p className="field-help">
            Edit the method configuration in the test editor. Additional methods use their own
            renderer; the matrix setting applies to hedonic tests. This block controls their
            position and presentation in the session.
          </p>
        </>
      )}
    </>
  );
}
