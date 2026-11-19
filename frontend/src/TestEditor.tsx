import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Eye, Plus, Save, Trash2 } from 'lucide-react';
import type { Configuration, Method, Question, StudyTest } from './api';
import { Modal } from './Modal';
import { EditorTabs } from './EditorTabs';
import { HedonicPreview } from './HedonicPreview';
import { CompactTextarea } from './CompactTextarea';
import { scaleNamesValid } from './shared/methods/registry';

function freshQuestion(): Question {
  return { id: `q_${crypto.randomUUID().replaceAll('-', '')}`, prompt: '', required: true };
}

export function TestEditor({
  test,
  method,
  readOnly,
  busy,
  save,
  onDirty,
}: {
  test?: StudyTest & { configuration: Configuration };
  method: Method;
  readOnly: boolean;
  busy: boolean;
  save: (config: Configuration) => Promise<StudyTest>;
  onDirty: (dirty: boolean) => void;
}) {
  const [config, setConfig] = useState<Configuration>(
    () =>
      test?.configuration ?? {
        instructions: '',
        questions: [{ id: 'overall', prompt: '', required: true }],
        scale_labels: method.default_scale_labels ?? [],
        allow_skips: false,
      },
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(config));
  const [validation, setValidation] = useState('');
  const [panel, setPanel] = useState('content');
  const [preview, setPreview] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const dirty = !readOnly && JSON.stringify(config) !== baseline;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  function questionChange(index: number, updates: Partial<Question>) {
    setConfig((previous) => ({
      ...previous,
      questions: previous.questions.map((question, i) =>
        i === index ? { ...question, ...updates } : question,
      ),
    }));
  }
  function move(index: number, direction: number) {
    const questions = [...config.questions];
    [questions[index], questions[index + direction]] = [
      questions[index + direction],
      questions[index],
    ];
    setConfig({ ...config, questions });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setValidation('');
    if (new Set(config.questions.map((question) => question.id)).size !== config.questions.length) {
      setValidation('Each question needs a different question code.');
      return;
    }
    if (
      config.questions.some((question) => !question.prompt.trim()) ||
      !config.instructions.trim() ||
      (config.scale_labels && !scaleNamesValid(config.scale_labels, false))
    ) {
      setValidation(
        'Complete the instructions and question wording, and name the first and last scale step.',
      );
      return;
    }
    try {
      const saved = await save(config);
      setConfig(saved.configuration as Configuration);
      setBaseline(JSON.stringify(saved.configuration));
    } catch {
      /* Workspace displays the server error; retain the unsaved form. */
    }
  }

  return (
    <div className="sensory-editor authoring-workbench">
      <form className="test-form" onSubmit={submit} noValidate>
        <div className="workbench-toolbar">
          <div>
            <h2>{test ? `Test ${test.position + 1}` : 'Configure a new test'}</h2>
          </div>
          <span className={`save-indicator ${dirty ? 'unsaved' : ''}`}>
            {readOnly ? (
              'Published configuration'
            ) : dirty ? (
              'Unsaved changes'
            ) : (
              <>
                <Check size={14} /> Saved
              </>
            )}
          </span>
          <div className="toolbar-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setPreview(true)}
            >
              <Eye size={15} /> Preview test
            </button>
            {!readOnly && (
              <button className="button primary" type="submit" disabled={busy || !dirty}>
                <Save size={16} />
                {busy ? 'Saving…' : test ? 'Save test' : 'Add test to study'}
              </button>
            )}
          </div>
        </div>
        {validation && (
          <div className="alert error" role="alert">
            {validation}
          </div>
        )}
        <EditorTabs
          tabs={[
            { id: 'content', label: 'Questions' },
            { id: 'scale', label: 'Response scale' },
            { id: 'settings', label: 'Settings' },
          ]}
          selected={panel}
          select={setPanel}
        >
          <fieldset disabled={readOnly || busy} className="editor-fields compact-fields">
            <div hidden={panel !== 'content'}>
              <section className="form-section">
                <label className="field-label" htmlFor="instructions">
                  Assessor instructions
                </label>
                <p className="field-help">Guide assessors through this evaluation.</p>
                <textarea
                  id="instructions"
                  required
                  maxLength={10000}
                  rows={2}
                  value={config.instructions}
                  placeholder="e.g. Taste the sample, then tell us how much you like it."
                  onChange={(event) => setConfig({ ...config, instructions: event.target.value })}
                />
              </section>
              <section className="form-section">
                <div className="section-row">
                  <h3>Questions</h3>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={showCodes}
                      onChange={(event) => setShowCodes(event.target.checked)}
                    />
                    Show question codes
                  </label>
                  <span className="count-label">{config.questions.length} / 100</span>
                </div>
                <p className="field-help">Each question uses the same nine-point liking scale.</p>
                <div className="question-list">
                  {config.questions.map((question, index) => (
                    <div className="question-card" key={index}>
                      <div className="question-heading">
                        <label htmlFor={`prompt-${index}`} className="field-label">
                          Question {index + 1}
                        </label>
                        {!readOnly && (
                          <div className="question-tools">
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Move question ${index + 1} up`}
                              disabled={index === 0}
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Move question ${index + 1} down`}
                              disabled={index === config.questions.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDown size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-button danger-icon"
                              aria-label={`Remove question ${index + 1}`}
                              disabled={config.questions.length === 1}
                              onClick={() =>
                                setConfig({
                                  ...config,
                                  questions: config.questions.filter((_, i) => i !== index),
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                      <CompactTextarea
                        id={`prompt-${index}`}
                        required
                        maxLength={2000}
                        rows={1}
                        value={question.prompt}
                        placeholder="e.g. How much do you like this sample?"
                        onChange={(event) => questionChange(index, { prompt: event.target.value })}
                      />
                      <div className="question-settings">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={question.required ?? true}
                            onChange={(event) =>
                              questionChange(index, { required: event.target.checked })
                            }
                          />{' '}
                          Answer required
                        </label>
                        {showCodes && (
                          <details className="question-code" open>
                            <summary>Question code</summary>
                            <label htmlFor={`code-${index}`} className="sr-only">
                              Question {index + 1} code
                            </label>
                            <input
                              id={`code-${index}`}
                              required
                              maxLength={100}
                              pattern="[A-Za-z0-9_-]+"
                              value={question.id}
                              onChange={(event) =>
                                questionChange(index, { id: event.target.value })
                              }
                            />
                            <p className="field-help">
                              Identifies this question in exports. Letters, numbers, underscores,
                              and hyphens.
                            </p>
                          </details>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="button subtle add-question"
                    disabled={config.questions.length >= 100}
                    onClick={() =>
                      setConfig({ ...config, questions: [...config.questions, freshQuestion()] })
                    }
                  >
                    <Plus size={16} /> Add question
                  </button>
                )}
              </section>
            </div>
            <div hidden={panel !== 'scale'}>
              <section className="form-section">
                <div className="section-row">
                  <h3>Response scale</h3>
                  <span className="pill neutral">9 points · 1–9</span>
                </div>
                <p className="field-help">
                  From dislike extremely to like extremely. Review any translated or adapted labels
                  for the same meaning.
                </p>
                <details className="scale-details">
                  <summary>
                    Customize scale labels <span>{readOnly ? 'View labels' : 'Optional'}</span>
                  </summary>
                  <div className="scale-labels">
                    {config.scale_labels?.map((label, index) => (
                      <label key={index}>
                        <span>{index + 1}</span>
                        <span className="sr-only">Rating {index + 1} label</span>
                        <input
                          required={index === 0 || index === (config.scale_labels?.length ?? 0) - 1}
                          placeholder={`Unnamed (shows ${index + 1})`}
                          maxLength={200}
                          value={label}
                          onChange={(event) =>
                            setConfig({
                              ...config,
                              scale_labels: config.scale_labels?.map((previous, i) =>
                                i === index ? event.target.value : previous,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </details>
              </section>
            </div>
            <div hidden={panel !== 'settings'}>
              <section className="form-section skip-setting">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.allow_skips ?? false}
                    onChange={(event) =>
                      setConfig({ ...config, allow_skips: event.target.checked })
                    }
                  />{' '}
                  Allow assessors to skip questions
                </label>
                <p className="field-help">
                  An explicit skip is recorded separately from an unanswered question. Allowed skips
                  count toward completion.
                </p>
                <details className="block-code">
                  <summary>Question identifiers</summary>
                  <dl className="identifier-list">
                    {config.questions.map((question) => (
                      <div key={question.id}>
                        <dt>
                          <code>{question.id}</code>
                        </dt>
                        <dd>{question.prompt || 'Untitled question'}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </section>
            </div>
          </fieldset>
        </EditorTabs>
      </form>
      {preview && (
        <Modal title="Preview sensory test" wide close={() => setPreview(false)}>
          <HedonicPreview configuration={config} />
        </Modal>
      )}
    </div>
  );
}
