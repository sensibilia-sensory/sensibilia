import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, Eye, Plus, Save, Settings, Trash2 } from 'lucide-react';
import type { FormStep, StudyForm, StudyTest, Version, Sample } from './api';
import { BlockFields, agreementLabels } from './BlockFields';
import { FlowPreview } from './FlowPreview';
import { EditorTabs } from './EditorTabs';
import { RouteEditor } from './RouteEditor';
import { Modal } from './Modal';
import { code, defaultForm, defaultRoute, flowErrors } from './flow';

export function FlowEditor({
  version,
  tests,
  samples,
  busy,
  onDirty,
  save,
  duplicateTest,
}: {
  duplicateTest: (testId: string) => Promise<StudyTest>;
  version: Version;
  tests: StudyTest[];
  samples: Sample[];
  busy: boolean;
  onDirty: (dirty: boolean) => void;
  save: (form: StudyForm) => Promise<Version>;
}) {
  const [form, setForm] = useState<StudyForm>(() => version.form ?? defaultForm(tests));
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const [selected, setSelected] = useState(form.steps[0]?.id ?? '');
  const [preview, setPreview] = useState<'session' | 'block' | null>(null);
  const [panel, setPanel] = useState('content');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [endings, setEndings] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const outline = useRef<HTMLOListElement>(null);
  const [remove, setRemove] = useState<FormStep | null>(null);
  const [attempted, setAttempted] = useState(false);
  const readOnly = !!version.published_at;
  const dirty = !readOnly && JSON.stringify(form) !== baseline;
  const step = form.steps.find((item) => item.id === selected);
  const errors = flowErrors(form, tests, false);
  const unusedTests = tests.filter(
    (test) => !form.steps.some((step) => step.kind === 'test' && step.study_test_id === test.id),
  );
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useLayoutEffect(() => {
    function resize() {
      if (!body.current) return;
      const top = body.current.getBoundingClientRect().top + window.scrollY;
      body.current.style.height =
        window.innerWidth > 700
          ? `${Math.max(320, Math.min(850, window.innerHeight - top - 24))}px`
          : '';
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  });
  useLayoutEffect(() => {
    const list = outline.current;
    const active = list?.querySelector<HTMLElement>('.active');
    if (!list || !active) return;
    const offset = active.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (offset < 0) list.scrollTop += offset;
    else if (offset + active.offsetHeight > list.clientHeight)
      list.scrollTop += offset + active.offsetHeight - list.clientHeight;
  }, [selected, search]);

  function updateStep(updated: FormStep) {
    setForm({ ...form, steps: form.steps.map((item) => (item.id === selected ? updated : item)) });
  }
  function add(kind: FormStep['kind'] | 'consent') {
    const base = { id: code('block'), title: 'Instructions', route: defaultRoute() };
    const next: FormStep =
      kind === 'instruction'
        ? { ...base, kind, text: '', acknowledgement_label: null, continue_label: 'Continue' }
        : kind === 'matrix'
          ? {
              ...base,
              kind,
              title: 'Question battery',
              instructions: '',
              rows: [{ id: code('row'), prompt: '', required: true }],
              scale: agreementLabels.map((label, i) => ({
                id: `option_${i + 1}`,
                label,
                score: null,
              })),
              allow_skips: false,
            }
          : kind === 'test'
            ? {
                ...base,
                kind,
                title: `Test ${unusedTests[0].position + 1}`,
                study_test_id: unusedTests[0].id,
                layout: 'cards',
              }
            : {
                ...base,
                kind: 'choice',
                title: kind === 'consent' ? 'Consent' : 'Screening question',
                text: '',
                prompt: kind === 'consent' ? 'Do you agree to participate in this study?' : '',
                multiple: false,
                options: [
                  { id: 'yes', label: kind === 'consent' ? 'I agree' : 'Yes', exclusive: false },
                  {
                    id: 'no',
                    label: kind === 'consent' ? 'I do not agree' : 'No',
                    exclusive: false,
                  },
                ],
              };
    if (kind === 'consent')
      next.route = {
        condition: { source_step_id: next.id, option_ids: ['yes'], match: 'any' },
        then: 'next',
        otherwise: 'screen_out',
      };
    const index =
      kind === 'consent'
        ? 0
        : Math.max(0, form.steps.findIndex((item) => item.id === selected) + 1);
    setForm({ ...form, steps: [...form.steps.slice(0, index), next, ...form.steps.slice(index)] });
    setAdding(false);
    setSearch('');
    setPanel('content');
    setSelected(next.id);
    setAttempted(false);
  }
  function move(index: number, direction: number) {
    const steps = [...form.steps];
    [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]];
    setForm({ ...form, steps });
  }
  async function duplicate() {
    if (!step || busy || duplicating || readOnly || form.steps.length >= 100) return;
    setDuplicating(true);
    try {
      const clone = structuredClone(step);
      clone.id = code('block');
      clone.title = `${step.title.slice(0, 240)} (copy)`;
      if (clone.route?.condition?.source_step_id === step.id)
        clone.route.condition.source_step_id = clone.id;
      if (clone.kind === 'test')
        clone.study_test_id = (await duplicateTest(clone.study_test_id)).id;
      const index = form.steps.indexOf(step) + 1;
      setForm({
        ...form,
        steps: [...form.steps.slice(0, index), clone, ...form.steps.slice(index)],
      });
      setSelected(clone.id);
      setSearch('');
      setPanel('content');
    } catch {
      /* Workspace displays the error; retain the original block. */
    } finally {
      setDuplicating(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (errors.length) return;
    try {
      const saved = await save(form);
      setForm(saved.form!);
      setBaseline(JSON.stringify(saved.form));
      setAttempted(false);
    } catch {
      /* Retain edits; workspace shows the server error. */
    }
  }
  const locked = busy || duplicating;
  const tabs = [
    { id: 'content', label: 'Content' },
    ...(step?.kind === 'matrix' ? [{ id: 'scale', label: 'Response scale' }] : []),
    { id: 'routing', label: 'Routing' },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <div className="session-flow authoring-workbench">
      <form onSubmit={submit} noValidate>
        <div className="workbench-toolbar">
          <h2>
            Session flow <span className="count-label">{form.steps.length} blocks</span>
          </h2>
          <span className={`save-indicator ${dirty ? 'unsaved' : ''}`}>
            {readOnly ? (
              'Published flow'
            ) : dirty ? (
              'Unsaved changes'
            ) : version.form ? (
              <>
                <Check size={14} /> Saved
              </>
            ) : (
              'Flow not saved'
            )}
          </span>
          <div className="toolbar-actions">
            <button
              type="button"
              className="button subtle"
              disabled={locked}
              onClick={() => setEndings(true)}
            >
              <Settings size={15} /> Session endings
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!!errors.length || locked}
              onClick={() => setPreview('session')}
            >
              <Eye size={15} /> Preview session
            </button>
            {!readOnly && (
              <button
                type="submit"
                className="button primary"
                disabled={locked || (!dirty && !!version.form)}
              >
                <Save size={15} />
                {busy ? 'Saving…' : 'Save flow'}
              </button>
            )}
          </div>
        </div>
        <div className="workbench-body" ref={body}>
          <aside className="block-outline" aria-label="Screen order">
            <div className="outline-toolbar">
              <input
                aria-label="Find a block"
                placeholder="Find a block…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {!readOnly && (
                <details
                  className="add-block-menu"
                  open={adding}
                  onToggle={(event) => setAdding(event.currentTarget.open)}
                >
                  <summary>
                    <Plus size={15} /> Add block
                  </summary>
                  <div aria-label="Add form blocks">
                    {(['consent', 'choice', 'instruction', 'matrix', 'test'] as const).map(
                      (kind) => (
                        <button
                          type="button"
                          className="button subtle"
                          key={kind}
                          disabled={
                            locked ||
                            form.steps.length >= 100 ||
                            (kind === 'test' && !unusedTests.length)
                          }
                          onClick={() => add(kind)}
                        >
                          {kind === 'consent'
                            ? 'Add consent'
                            : kind === 'choice'
                              ? 'Add choice'
                              : kind === 'instruction'
                                ? 'Add instructions'
                                : kind === 'matrix'
                                  ? 'Add question battery'
                                  : 'Add sensory test'}
                        </button>
                      ),
                    )}
                  </div>
                </details>
              )}
            </div>
            <ol className="compact-outline" ref={outline}>
              {form.steps.map(
                (item, index) =>
                  item.title.toLowerCase().includes(search.toLowerCase()) && (
                    <li key={item.id} className={item.id === selected ? 'active' : ''}>
                      <button
                        type="button"
                        className="block-select"
                        aria-pressed={item.id === selected}
                        disabled={locked}
                        onClick={() => {
                          setSelected(item.id);
                          setPanel('content');
                          setAttempted(false);
                        }}
                      >
                        <span className="block-number">{index + 1}</span>
                        <span>
                          <strong>{item.title || 'Untitled block'}</strong>
                          <small>
                            {item.kind === 'matrix'
                              ? `${item.rows.length} rows · shared scale`
                              : item.kind === 'test'
                                ? 'Sensory test'
                                : item.kind === 'choice'
                                  ? 'Choice / screening'
                                  : 'Text / instructions'}
                            {item.route?.condition ? ' · If / else' : ''}
                          </small>
                        </span>
                      </button>
                    </li>
                  ),
              )}
            </ol>
            {search &&
              !form.steps.some((item) =>
                item.title.toLowerCase().includes(search.toLowerCase()),
              ) && <p className="field-help">No matching blocks.</p>}
            {!form.steps.length && <p className="field-help">Add a block to begin.</p>}
          </aside>
          <div className="block-inspector">
            {step ? (
              <>
                <div className="inspector-heading">
                  <h3>
                    Screen {form.steps.indexOf(step) + 1}{' '}
                    <span className="pill neutral">{step.kind}</span>
                  </h3>
                  <div className="inspector-tools">
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Move block ${form.steps.indexOf(step) + 1} up`}
                          disabled={locked || form.steps.indexOf(step) === 0}
                          onClick={() => move(form.steps.indexOf(step), -1)}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Move block ${form.steps.indexOf(step) + 1} down`}
                          disabled={locked || form.steps.indexOf(step) === form.steps.length - 1}
                          onClick={() => move(form.steps.indexOf(step), 1)}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          className="button subtle"
                          disabled={locked || form.steps.length >= 100}
                          onClick={duplicate}
                        >
                          <Copy size={15} />
                          Duplicate block
                        </button>
                        <button
                          type="button"
                          className="icon-button danger-icon"
                          aria-label={`Remove block ${form.steps.indexOf(step) + 1}`}
                          disabled={locked}
                          onClick={() => setRemove(step)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="button subtle"
                      disabled={locked}
                      onClick={() => setPreview('block')}
                    >
                      <Eye size={15} />
                      Preview block
                    </button>
                  </div>
                </div>
                <EditorTabs tabs={tabs} selected={panel} select={setPanel}>
                  <fieldset className="editor-fields compact-fields" disabled={readOnly || locked}>
                    {panel === 'routing' ? (
                      <RouteEditor
                        form={form}
                        step={step}
                        change={(route) => updateStep({ ...step, route })}
                      />
                    ) : (
                      <BlockFields
                        key={step.id}
                        step={step}
                        form={form}
                        tests={tests}
                        change={updateStep}
                        panel={panel}
                      />
                    )}
                  </fieldset>
                </EditorTabs>
              </>
            ) : (
              <div className="empty-state">
                <h3>Start with a screen</h3>
                <p>Add instructions, a consent choice, or a question battery.</p>
              </div>
            )}
          </div>
        </div>
        {unusedTests.length > 0 && (
          <p className="flow-warning">
            {unusedTests.length} configured{' '}
            {unusedTests.length === 1 ? 'test needs a block' : 'tests need blocks'} before
            publishing. Use “Add sensory test”.
          </p>
        )}
        {errors.length > 0 && (attempted || dirty) && (
          <div className="alert error flow-errors" role="alert">
            <strong>Review the flow</strong>
            <ul>
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>
        )}
      </form>
      {endings && (
        <Modal title="Session endings" close={() => setEndings(false)} busy={locked}>
          <fieldset className="editor-fields" disabled={readOnly || locked}>
            <label className="field-label">
              Completion message
              <textarea
                rows={3}
                required
                maxLength={10000}
                value={form.completion_message}
                onChange={(event) => setForm({ ...form, completion_message: event.target.value })}
              />
            </label>
            <label className="field-label">
              Screen-out message
              <textarea
                rows={3}
                required
                maxLength={10000}
                value={form.screen_out_message}
                onChange={(event) => setForm({ ...form, screen_out_message: event.target.value })}
              />
            </label>
          </fieldset>
          <div className="modal-actions">
            <button type="button" className="button primary" onClick={() => setEndings(false)}>
              Done
            </button>
          </div>
          {!readOnly && (
            <p className="field-help">Use Save flow to save these messages with your blocks.</p>
          )}
        </Modal>
      )}
      {preview && (
        <Modal
          title={preview === 'session' ? 'Preview session flow' : 'Preview form block'}
          wide
          close={() => setPreview(null)}
        >
          {preview === 'block' ? (
            <aside aria-label="Form block preview">
              <FlowPreview form={form} tests={tests} samples={samples} singleStep={step} />
            </aside>
          ) : (
            <FlowPreview form={form} tests={tests} samples={samples} />
          )}
        </Modal>
      )}
      {remove && (
        <Modal title="Remove this flow block?" close={() => setRemove(null)}>
          <p>
            Remove “{remove.title}” from this draft flow? Review any routes that refer to it. A
            sensory test's configuration remains in the test editor.
          </p>
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={() => setRemove(null)}>
              Keep block
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => {
                const steps = form.steps.filter((item) => item.id !== remove.id);
                setForm({ ...form, steps });
                if (selected === remove.id) setSelected(steps[0]?.id ?? '');
                setRemove(null);
              }}
            >
              Remove block
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
