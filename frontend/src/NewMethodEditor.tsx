import { DataTable, Button, DragList, Field, RowGrip, SchemaFields, moveItem } from './ui';
import { useEffect, useState } from 'react';
import { Copy, Eye, Plus, Save, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { Method, NewConfiguration, Sample, StudyTest } from './api';
import { EditorTabs } from './EditorTabs';
import { CompactTextarea } from './CompactTextarea';
import { Modal } from './Modal';
import { MethodPreview } from './MethodRenderer';
import { defaultConfiguration } from './methods';
import { code } from './flow';
import type { components } from './api-schema';
import { SampleCreator } from './shared/nodes/SampleCreator';
import { setMethods } from './shared/methods/registry';

export function NewMethodEditor({
  test,
  method,
  samples,
  readOnly,
  busy,
  save,
  onDirty,
}: {
  test?: StudyTest;
  method: Method;
  samples: Sample[];
  readOnly: boolean;
  busy: boolean;
  save: (config: NewConfiguration) => Promise<StudyTest>;
  onDirty: (dirty: boolean) => void;
}) {
  const [config, setConfig] = useState<NewConfiguration>(
    () => (test?.configuration as NewConfiguration) ?? defaultConfiguration(method.id, samples),
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(config));
  const [panel, setPanel] = useState('content');
  const [preview, setPreview] = useState(false);
  const [bulk, setBulk] = useState('');
  const dirty = !readOnly && JSON.stringify(config) !== baseline;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const rating = config.kind === 'rata' || config.kind === 'jar';
  const attributes = 'questions' in config;
  const count = config.sample_ids.length;
  const pairOnly =
    config.kind === 'triangle' || config.kind === 'duo_trio' || config.kind === 'two_afc';
  const requiredSamples = pairOnly
    ? 2
    : config.kind === 'flash_profile' || config.kind === 'napping'
      ? 2
      : 0;
  const sampleLimit = pairOnly ? 2 : config.kind === 'flash_profile' ? 30 : 50;
  return (
    <div className="authoring-workbench sensory-editor">
      <form
        className="test-form"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const result = await save(config);
            setConfig(result.configuration as NewConfiguration);
            setBaseline(JSON.stringify(result.configuration));
          } catch {
            /* retain edits */
          }
        }}
      >
        <div className="workbench-toolbar">
          <h2>{test ? `Test ${test.position + 1}` : 'Configure a new test'}</h2>
          <span className="pill neutral">{method.name}</span>
          <span className={`save-indicator ${dirty ? 'unsaved' : ''}`}>
            {readOnly ? 'Published configuration' : dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <div className="toolbar-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setPreview(true)}
            >
              <Eye size={15} />
              Preview test
            </button>
            {!readOnly && (
              <button className="button primary" disabled={busy || (!!test && !dirty)}>
                <Save size={15} />
                {test ? 'Save test' : 'Add test to study'}
              </button>
            )}
          </div>
        </div>
        <EditorTabs
          tabs={[
            { id: 'content', label: attributes ? 'Attributes' : 'Content' },
            { id: 'samples', label: 'Samples' },
            ...(rating ? [{ id: 'scale', label: 'Response scale' }] : []),
            { id: 'settings', label: 'Settings' },
          ]}
          selected={panel}
          select={setPanel}
        >
          <fieldset disabled={readOnly || busy} className="editor-fields compact-fields">
            {panel === 'content' && (
              <>
                <label className="field-label">
                  Assessor instructions
                  <textarea
                    rows={3}
                    maxLength={10000}
                    required
                    value={config.instructions}
                    onChange={(event) => setConfig({ ...config, instructions: event.target.value })}
                  />
                </label>
                {'questions' in config && (
                  <section className="form-section">
                    <div className="section-row">
                      <h3>Attributes / questions</h3>
                      <span className="count-label">{config.questions.length} / 100</span>
                    </div>
                    <DragList
                      disabled={readOnly || busy}
                      onMove={(from, to) =>
                        setConfig({ ...config, questions: moveItem(config.questions, from, to) })
                      }
                    >
                      {({ rowProps, gripProps }) => (
                        <>
                          {config.questions.map((question, index) => (
                            <div className="question-card" key={index} {...rowProps(index)}>
                              <div className="question-heading">
                                <RowGrip {...gripProps(index)} />
                                <label htmlFor={`attribute-${index}`} className="field-label">
                                  Attribute {index + 1}
                                </label>
                                <div className="question-tools">
                                  {[-1, 1].map((direction) => (
                                    <button
                                      type="button"
                                      className="icon-button"
                                      key={direction}
                                      aria-label={`Move attribute ${index + 1} ${direction < 0 ? 'up' : 'down'}`}
                                      disabled={
                                        index + direction < 0 ||
                                        index + direction >= config.questions.length
                                      }
                                      onClick={() => {
                                        const questions = [...config.questions];
                                        [questions[index], questions[index + direction]] = [
                                          questions[index + direction],
                                          questions[index],
                                        ];
                                        setConfig({ ...config, questions });
                                      }}
                                    >
                                      {direction < 0 ? (
                                        <ArrowUp size={15} />
                                      ) : (
                                        <ArrowDown size={15} />
                                      )}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    className="icon-button danger-icon"
                                    aria-label={`Remove attribute ${index + 1}`}
                                    disabled={config.questions.length === 1}
                                    onClick={() =>
                                      setConfig({
                                        ...config,
                                        questions: config.questions.filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </div>
                              <CompactTextarea
                                id={`attribute-${index}`}
                                required
                                maxLength={2000}
                                value={question.prompt}
                                onChange={(event) =>
                                  setConfig({
                                    ...config,
                                    questions: config.questions.map((item, i) =>
                                      i === index ? { ...item, prompt: event.target.value } : item,
                                    ),
                                  })
                                }
                              />
                              <div className="question-settings">
                                {config.kind === 'jar' && (
                                  <label className="checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={question.required ?? true}
                                      onChange={(event) =>
                                        setConfig({
                                          ...config,
                                          questions: config.questions.map((item, i) =>
                                            i === index
                                              ? { ...item, required: event.target.checked }
                                              : item,
                                          ),
                                        })
                                      }
                                    />
                                    Answer required
                                  </label>
                                )}
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </DragList>
                    <button
                      type="button"
                      className="button subtle"
                      disabled={config.questions.length >= 100}
                      onClick={() =>
                        setConfig({
                          ...config,
                          questions: [
                            ...config.questions,
                            { id: code('attribute'), prompt: '', required: true },
                          ],
                        })
                      }
                    >
                      <Plus size={15} />
                      Add attribute
                    </button>
                    <details className="bulk-rows">
                      <summary>Add several attributes at once</summary>
                      <label className="field-label">
                        One attribute per line
                        <textarea
                          rows={4}
                          value={bulk}
                          onChange={(event) => setBulk(event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={
                          !bulk.trim() ||
                          config.questions.filter((q) => q.prompt.trim()).length +
                            bulk.split('\n').filter((line) => line.trim()).length >
                            100
                        }
                        onClick={() => {
                          setConfig({
                            ...config,
                            questions: [
                              ...config.questions.filter((q) => q.prompt.trim()),
                              ...bulk
                                .split('\n')
                                .map((line) => line.trim())
                                .filter(Boolean)
                                .map((prompt) => ({
                                  id: code('attribute'),
                                  prompt,
                                  required: true,
                                })),
                            ],
                          });
                          setBulk('');
                        }}
                      >
                        <Copy size={15} />
                        Add attributes
                      </button>
                    </details>
                  </section>
                )}
                {config.kind === 'flash_profile' && (
                  <>
                    <label className="field-label">
                      Descriptor-generation instructions
                      <textarea
                        rows={3}
                        required
                        value={config.descriptor_instructions}
                        onChange={(event) =>
                          setConfig({ ...config, descriptor_instructions: event.target.value })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Ranking instructions
                      <textarea
                        rows={3}
                        required
                        value={config.ranking_instructions}
                        onChange={(event) =>
                          setConfig({ ...config, ranking_instructions: event.target.value })
                        }
                      />
                    </label>
                    <p className="field-help">
                      Assessors supply their own non-hedonic descriptors. Every descriptor ranks the
                      full product set from low to high intensity.
                    </p>
                  </>
                )}
                {config.kind === 'napping' && (
                  <p className="field-help">
                    A blank digital 3:2 canvas records relative product positions in 60 × 40
                    cm-equivalent coordinates. Screen size varies; this is a digital adaptation of
                    the paper protocol.
                  </p>
                )}
                {(config.kind === 'triangle' ||
                  config.kind === 'duo_trio' ||
                  config.kind === 'two_afc') && (
                  <p className="field-help">
                    Forced choice; no “same” or “do not know” option. Actual balanced serving orders
                    and blind codes are assigned when the server provisions each session.
                  </p>
                )}
              </>
            )}
            {panel === 'samples' && (
              <>
                <div className="section-row">
                  <h3>Products to evaluate</h3>
                  <span className="count-label">
                    {count}
                    {requiredSamples === 2 ? (pairOnly ? ' / 2' : ' selected') : ' selected'}
                  </span>
                </div>
                <p className="field-help">
                  {requiredSamples
                    ? `Select ${sampleLimit === 2 ? 'exactly two' : 'at least two'} products.`
                    : 'Select coded products, or leave empty for a single evaluation without a sample assignment.'}{' '}
                  Add products in the study’s Coded samples section.
                </p>
                {samples.map((sample) => (
                  <label className="checkbox-label" key={sample.id}>
                    <input
                      type="checkbox"
                      checked={config.sample_ids.includes(sample.id)}
                      disabled={!config.sample_ids.includes(sample.id) && count >= sampleLimit}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          sample_ids: event.target.checked
                            ? [...config.sample_ids, sample.id]
                            : config.sample_ids.filter((id) => id !== sample.id),
                        })
                      }
                    />
                    <strong>{sample.code}</strong> {sample.label}
                  </label>
                ))}
                {!samples.length && <p>No coded samples yet.</p>}
              </>
            )}
            {panel === 'scale' && (config.kind === 'rata' || config.kind === 'jar') && (
              <>
                {config.kind === 'jar' && (
                  <label className="field-label">
                    JAR categories
                    <select
                      value={config.scale_labels?.length ?? 5}
                      onChange={(event) => {
                        const length = Number(event.target.value);
                        const labels =
                          length === 3
                            ? ['Too little', 'Just about right', 'Too much']
                            : length === 5
                              ? [
                                  'Much too little',
                                  'Too little',
                                  'Just about right',
                                  'Too much',
                                  'Much too much',
                                ]
                              : [
                                  'Much too little',
                                  'Moderately too little',
                                  'Slightly too little',
                                  'Just about right',
                                  'Slightly too much',
                                  'Moderately too much',
                                  'Much too much',
                                ];
                        setConfig({ ...config, scale_labels: labels });
                      }}
                    >
                      {[3, 5, 7].map((n) => (
                        <option value={n} key={n}>
                          {n} categories
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {config.kind === 'rata' && (
                  <>
                    <label className="field-label">
                      Rating target
                      <select
                        value={config.rating_target}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            rating_target: event.target.value as 'intensity' | 'applicability',
                          })
                        }
                      >
                        <option value="intensity">Intensity</option>
                        <option value="applicability">Applicability</option>
                      </select>
                    </label>
                    <label className="field-label">
                      RATA scale template
                      <select
                        value="custom"
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            rating_target:
                              event.target.value === '3' ? 'intensity' : 'applicability',
                            rating_min: 1,
                            scale_labels:
                              event.target.value === '3'
                                ? ['Low', 'Medium', 'High']
                                : ['Slightly applicable', '2', '3', '4', 'Very applicable'],
                          })
                        }
                      >
                        <option value="custom">Custom labels</option>
                        <option value="3">3-point intensity</option>
                        <option value="5">5-point applicability</option>
                      </select>
                    </label>
                  </>
                )}
                <div className="scale-labels">
                  {config.scale_labels?.map((label, index) => (
                    <label key={index}>
                      <span>{index + (config.kind === 'rata' ? (config.rating_min ?? 1) : 1)}</span>
                      <span className="sr-only">Rating {index + 1} label</span>
                      <input
                        required={
                          index === 0 ||
                          index === (config.scale_labels?.length ?? 0) - 1 ||
                          (config.kind === 'jar' &&
                            index === Math.floor((config.scale_labels?.length ?? 0) / 2))
                        }
                        placeholder="Unnamed"
                        maxLength={200}
                        value={label}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            scale_labels:
                              config.scale_labels?.map((old, i) =>
                                i === index ? event.target.value : old,
                              ) ?? [],
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                {config.kind === 'rata' && (
                  <div className="toolbar-actions">
                    <button
                      type="button"
                      className="button subtle"
                      disabled={config.scale_labels.length >= 11}
                      onClick={() =>
                        setConfig({ ...config, scale_labels: [...config.scale_labels, ''] })
                      }
                    >
                      Add scale category
                    </button>
                    <button
                      type="button"
                      className="button subtle"
                      disabled={config.scale_labels.length <= 2}
                      onClick={() =>
                        setConfig({ ...config, scale_labels: config.scale_labels.slice(0, -1) })
                      }
                    >
                      Remove last category
                    </button>
                  </div>
                )}
                {config.kind === 'jar' && (
                  <p className="field-help">
                    The centre category represents just about right; lower categories are too little
                    and higher categories too much. Review translated labels to preserve these
                    meanings.
                  </p>
                )}
              </>
            )}
            {panel === 'settings' && (
              <>
                {'allow_skips' in config && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={config.allow_skips ?? false}
                      onChange={(event) =>
                        setConfig({ ...config, allow_skips: event.target.checked })
                      }
                    />
                    Allow explicit skips
                  </label>
                )}
                {config.kind === 'rata' && (
                  <>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={config.require_ratings ?? true}
                        onChange={(event) =>
                          setConfig({ ...config, require_ratings: event.target.checked })
                        }
                      />
                      Require a rating for every selected attribute
                    </label>
                    <label className="field-label">
                      First scale value
                      <select
                        value={config.rating_min ?? 1}
                        onChange={(event) =>
                          setConfig({ ...config, rating_min: Number(event.target.value) })
                        }
                      >
                        <option value={1}>1 (usual convention)</option>
                        <option value={0}>0 (explicit study convention)</option>
                      </select>
                    </label>
                    <p className="field-help">
                      Unselected is stored separately from a selected rating of zero. If ratings are
                      optional, selected but unrated is preserved with a null rating.
                    </p>
                  </>
                )}
                {config.kind === 'two_afc' && (
                  <>
                    <label className="field-label">
                      Question asked
                      <input
                        type="text"
                        required
                        maxLength={500}
                        value={config.question}
                        placeholder="Which sample is sweeter?"
                        onChange={(event) => setConfig({ ...config, question: event.target.value })}
                      />
                    </label>
                    <label className="field-label">
                      Question type
                      <select
                        value={config.task ?? 'directional'}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            task: event.target.value as 'directional' | 'preference',
                            expected_sample_id:
                              event.target.value === 'directional'
                                ? (config.sample_ids[0] ?? null)
                                : null,
                          })
                        }
                      >
                        <option value="directional">
                          Directional (which has more of an attribute)
                        </option>
                        <option value="preference">Preference (which is preferred)</option>
                      </select>
                    </label>
                    {config.task === 'directional' && (
                      <label className="field-label">
                        Product expected to have more
                        <select
                          required
                          value={config.expected_sample_id ?? ''}
                          onChange={(event) =>
                            setConfig({ ...config, expected_sample_id: event.target.value })
                          }
                        >
                          <option value="">Choose product</option>
                          {samples
                            .filter((s) => config.sample_ids.includes(s.id))
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.code} · {s.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <p className="field-help">
                      Directional answers are scored against the expected product; preference
                      answers have no correct choice. Serving order (AB / BA) is balanced across
                      sessions.
                    </p>
                  </>
                )}
                {(config.kind === 'triangle' || config.kind === 'duo_trio') && (
                  <label className="field-label">
                    Study purpose
                    <select
                      value={config.purpose ?? 'difference'}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          purpose: event.target.value as 'difference' | 'similarity',
                        })
                      }
                    >
                      <option value="difference">Difference testing</option>
                      <option value="similarity">Similarity testing</option>
                    </select>
                  </label>
                )}
                {config.kind === 'duo_trio' && (
                  <>
                    <label className="field-label">
                      Reference technique
                      <select
                        value={config.reference_mode ?? 'balanced'}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            reference_mode: event.target.value as 'constant' | 'balanced',
                            reference_sample_id:
                              event.target.value === 'constant'
                                ? (config.sample_ids[0] ?? null)
                                : null,
                          })
                        }
                      >
                        <option value="balanced">Balanced reference</option>
                        <option value="constant">Constant reference</option>
                      </select>
                    </label>
                    {config.reference_mode === 'constant' && (
                      <label className="field-label">
                        Reference product
                        <select
                          required
                          value={config.reference_sample_id ?? ''}
                          onChange={(event) =>
                            setConfig({ ...config, reference_sample_id: event.target.value })
                          }
                        >
                          <option value="">Choose reference</option>
                          {samples
                            .filter((s) => config.sample_ids.includes(s.id))
                            .map((sample) => (
                              <option key={sample.id} value={sample.id}>
                                {sample.code} · {sample.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
                {config.kind === 'flash_profile' && (
                  <>
                    <label className="field-label">
                      Minimum descriptors
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={config.min_attributes ?? 1}
                        onChange={(event) =>
                          setConfig({ ...config, min_attributes: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Maximum descriptors
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={config.max_attributes ?? 20}
                        onChange={(event) =>
                          setConfig({ ...config, max_attributes: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={config.allow_ties ?? true}
                        onChange={(event) =>
                          setConfig({ ...config, allow_ties: event.target.checked })
                        }
                      />
                      Allow tied ranks
                    </label>
                    <p className="field-help">
                      Dense rank encoding: e.g. 1, 1, 2 when two samples tie for lowest. Each
                      descriptor must use consecutive ranks from 1. Analysis may transform this
                      encoding later.
                    </p>
                  </>
                )}
                {config.kind === 'napping' && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={config.collect_descriptions ?? false}
                      onChange={(event) =>
                        setConfig({ ...config, collect_descriptions: event.target.checked })
                      }
                    />
                    Collect optional sample descriptions after mapping
                  </label>
                )}
                {'questions' in config && (
                  <details className="block-code">
                    <summary>Attribute identifiers</summary>
                    <dl className="identifier-list">
                      {config.questions.map((q) => (
                        <div key={q.id}>
                          <dt>
                            <code>{q.id}</code>
                          </dt>
                          <dd>{q.prompt}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </>
            )}
          </fieldset>
        </EditorTabs>
      </form>
      {preview && (
        <Modal title="Preview sensory test" wide close={() => setPreview(false)}>
          <MethodPreview configuration={config} samples={samples} />
        </Modal>
      )}
    </div>
  );
}

/** Primitive-based embedding of the existing registered configuration editor. */
export function RegisteredMethodFields({
  method,
  config,
  samples,
  onChange,
  disabled = false,
  errors = {},
  prefix = 'method',
  quiet = false,
  onCreateSample,
}: {
  method: Method;
  config: NewConfiguration;
  samples: Sample[];
  onChange: (config: NewConfiguration) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
  prefix?: string;
  quiet?: boolean;
  onCreateSample?: (payload: components['schemas']['SampleCreate']) => Promise<Sample>;
}) {
  const schema = method.configuration_schema as {
    properties: Record<string, unknown>;
    required?: string[];
  };
  const setLevel = setMethods.has(config.kind.replaceAll('_', '-') + '-v1');
  const fields = {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).filter(
        ([k]) =>
          ![
            'kind',
            'multi_active',
            'capture',
            'sample_ids',
            'reference_sample_id',
            'expected_sample_id',
            'canvas_width',
            'canvas_height',
            'coordinate_units',
            'rank_direction',
            'rank_encoding',
          ].includes(k),
      ),
    ),
  };
  return (
    <div className="ui-stack">
      <SchemaFields
        schema={fields}
        value={config}
        disabled={disabled}
        errors={errors}
        labels={{
          questions: 'Attributes',
          attributes: 'Temporal attributes',
          start_instruction: 'Start instruction',
          duration_ms: 'Duration ms',
          required_tolerance_ms: 'Required timing tolerance ms',
          instructions: 'Instructions',
          scale_labels: 'Scale labels',
          allow_skips: 'Allow skips',
          require_ratings: 'Require ratings',
          rating_min: 'First scale value',
          rating_target: 'Rating target',
          reference_mode: 'Reference technique',
          purpose: 'Study purpose',
          task: 'Question type',
          question: 'Question asked',
        }}
        help={{
          required_tolerance_ms:
            'Required protocol tolerance; target-device timing is unverified. Concurrent selection, manual deselection, no fading.',
          rating_min: 'Selected zero, selected without a rating and unselected remain distinct.',
          allow_ties: 'Dense ranks: ties share a rank; use consecutive ranks from 1.',
          collect_descriptions:
            'Digital 60 × 40 cm equivalent; physical-sheet equivalence is unverified.',
        }}
        onChange={(v) => {
          const next = { ...config, ...(v as NewConfiguration) };
          if (next.kind === 'duo_trio' && next.reference_mode === 'balanced')
            next.reference_sample_id = null;
          if (next.kind === 'two_afc') {
            if (next.task === 'preference') next.expected_sample_id = null;
            else if (!next.expected_sample_id) next.expected_sample_id = next.sample_ids[0] ?? null;
          }
          onChange(next);
        }}
      />
      <p role={errors.sample_ids ? 'alert' : quiet ? undefined : 'status'}>
        {errors.sample_ids ??
          (setLevel
            ? config.sample_ids.length + ' products chosen.'
            : config.sample_ids.length
              ? config.sample_ids.length + ' samples fixed for this test.'
              : "No samples are fixed here. This test uses the samples of the 'Repeat for each sample' step it sits in, so you can add it now and add the samples later.")}
      </p>
      {setLevel && !errors.sample_ids && config.sample_ids.length < 2 && (
        <p className="ui-hint">
          This test compares specific products. Choose them below or create them here.
        </p>
      )}
      <DataTable
        id={prefix + '-samples'}
        selectable={false}
        label="Configured method samples"
        data={samples}
        getRowId={(s) => s.id}
        columns={[
          { accessorKey: 'code', header: 'Code' },
          { accessorKey: 'label', header: 'Private label' },
          {
            id: 'included',
            header: 'Included',
            accessorFn: (s) => (config.sample_ids.includes(s.id) ? 'Yes' : 'No'),
          },
        ]}
        rowActions={(s) => (
          <Button
            disabled={disabled}
            onClick={() =>
              onChange({
                ...config,
                sample_ids: config.sample_ids.includes(s.id)
                  ? config.sample_ids.filter((id) => id !== s.id)
                  : [...config.sample_ids, s.id],
              })
            }
          >
            {config.sample_ids.includes(s.id) ? 'Remove' : 'Include'}
          </Button>
        )}
      />
      {onCreateSample && (setLevel || config.sample_ids.length > 0) && (
        <SampleCreator
          title="Create a sample for this test"
          defaultOpen={setLevel && config.sample_ids.length < 2}
          disabled={disabled}
          onCreate={onCreateSample}
          onCreated={(sample) =>
            onChange({ ...config, sample_ids: [...config.sample_ids, sample.id] })
          }
        />
      )}
      {config.kind === 'two_afc' && config.task === 'directional' && (
        <Field
          label="Product expected to have more"
          kind="select"
          disabled={disabled}
          error={errors.expected_sample_id}
          value={config.expected_sample_id ?? ''}
          options={[
            { value: '', label: 'Choose product' },
            ...samples
              .filter((s) => config.sample_ids.includes(s.id))
              .map((s) => ({ value: s.id, label: s.code + ' · ' + s.label })),
          ]}
          onChange={(e) => onChange({ ...config, expected_sample_id: e.target.value })}
        />
      )}
      {config.kind === 'duo_trio' && config.reference_mode === 'constant' && (
        <Field
          label="Reference product"
          kind="select"
          disabled={disabled}
          error={errors.reference_sample_id}
          value={config.reference_sample_id ?? ''}
          options={[
            { value: '', label: 'Choose reference' },
            ...samples
              .filter((s) => config.sample_ids.includes(s.id))
              .map((s) => ({ value: s.id, label: s.code + ' · ' + s.label })),
          ]}
          onChange={(e) => onChange({ ...config, reference_sample_id: e.target.value })}
        />
      )}
    </div>
  );
}
