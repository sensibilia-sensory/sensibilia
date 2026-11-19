import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileText,
  LockKeyhole,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import {
  Api,
  type Method,
  type Study,
  type StudyTest,
  type Version,
  type Sample,
  type Configuration,
} from './api';
import { Modal } from './Modal';
import { StudyDetails } from './StudyDetails';
import { TestEditor } from './TestEditor';
import { NewMethodEditor } from './NewMethodEditor';
import { SamplePanel } from './SamplePanel';
import { testQuestions } from './methods';
import { FlowEditor } from './FlowEditor';

type Navigate = (action: () => void) => void;

export function StudyWorkspace({
  id,
  api,
  methods,
  back,
  navigate,
  onDirty,
  onBusy,
}: {
  id: string;
  api: Api;
  methods: Method[];
  back: () => void;
  navigate: Navigate;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [study, setStudy] = useState<Study | null>(null);
  const [versionId, setVersionId] = useState('');
  const [samples, setSamples] = useState<Sample[]>([]);
  const [newMethod, setNewMethod] = useState('hedonic-9-v1');
  const [configured, setConfigured] = useState<StudyTest[]>([]);
  const [selected, setSelected] = useState('details');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<'publish' | 'remove' | null>(null);
  const [reload, setReload] = useState(0);
  const updateDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api
      .study(id, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setStudy(data);
        setVersionId((previous) =>
          data.versions.some((item) => item.id === previous) ? previous : data.versions.at(-1)!.id,
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [api, id, reload]);

  useEffect(() => {
    if (!versionId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      api.tests(id, versionId, controller.signal),
      api.samples(id, versionId, controller.signal),
    ])
      .then(([data, catalog]) => {
        if (controller.signal.aborted) return;
        setConfigured(data);
        setSamples(catalog);
        setSelected(data[0]?.id ?? 'details');
        setLoading(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [api, id, versionId, reload]);

  const version = study?.versions.find((item) => item.id === versionId);
  const readOnly = !!version?.published_at;
  const currentDraft = study?.versions.find((item) => !item.published_at);
  const selectedTest = configured.find((test) => test.id === selected);
  const method = methods.find((item) => item.id === (selectedTest?.test_type_id ?? newMethod));

  async function perform<T>(operation: () => Promise<T>): Promise<T> {
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    try {
      return await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The operation could not be completed.');
      throw error;
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  async function publish() {
    try {
      await perform(async () => {
        const published = await api.publish(id);
        setStudy((previous) =>
          previous
            ? {
                ...previous,
                status: 'active',
                versions: previous.versions.map((item) =>
                  item.id === published.id ? published : item,
                ),
              }
            : null,
        );
        setNotice(
          `Version ${published.version_number} published. This configuration is now frozen.`,
        );
        setConfirmation(null);
        updateDirty(false);
      });
    } catch {
      setConfirmation(null);
    }
  }
  async function newDraft() {
    if (currentDraft) {
      navigate(() => setVersionId(currentDraft.id));
      return;
    }
    try {
      await perform(async () => {
        const created = await api.draft(id);
        setStudy((previous) =>
          previous ? { ...previous, versions: [...previous.versions, created] } : null,
        );
        setVersionId(created.id);
        setNotice(`Draft version ${created.version_number} is ready to edit.`);
      });
    } catch {
      /* Error displayed in the workspace. */
    }
  }
  async function removeTest() {
    if (!selectedTest) return;
    try {
      await perform(async () => {
        await api.deleteTest(id, selectedTest.id);
        const remaining = await api.tests(id, versionId);
        setConfigured(remaining);
        setSelected(remaining[0]?.id ?? 'details');
        updateDirty(false);
        setNotice('Test removed from this draft.');
        setConfirmation(null);
      });
    } catch {
      setConfirmation(null);
    }
  }

  if (!study || !version)
    return (
      <div className="page">
        <button className="back-link" onClick={back}>
          <ArrowLeft size={16} /> Study library
        </button>
        <h1>Study setup</h1>
        {error ? (
          <div className="alert error" role="alert">
            {error}{' '}
            <button className="text-button" onClick={() => setReload(reload + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <div className="empty-state">
            <div className="spinner" />
            <p>Opening study…</p>
          </div>
        )}
      </div>
    );

  function selectVersion(value: Version) {
    navigate(() => {
      setNotice('');
      setVersionId(value.id);
    });
  }
  return (
    <div className="page workspace-page">
      <button className="back-link" onClick={back} disabled={busy}>
        <ArrowLeft size={16} /> Study library
      </button>
      <div className="page-heading workspace-heading">
        <div>
          <div className="heading-eyebrow">
            <span className={`pill ${readOnly ? 'published' : 'draft'}`}>
              {readOnly ? 'Published' : 'Draft'}
            </span>
          </div>
          <h1>{version.title}</h1>
        </div>
        <div className="workspace-actions">
          <label className="version-selector">
            <span className="sr-only">Study version</span>
            <select
              aria-label="Study version"
              value={versionId}
              disabled={busy || loading}
              onChange={(event) =>
                selectVersion(study.versions.find((item) => item.id === event.target.value)!)
              }
            >
              {[...study.versions].reverse().map((item) => (
                <option key={item.id} value={item.id}>
                  Version {item.version_number} · {item.published_at ? 'Published' : 'Draft'}
                </option>
              ))}
            </select>
          </label>
          {readOnly ? (
            <button className="button primary" onClick={newDraft} disabled={busy || loading}>
              <Plus size={16} />
              {currentDraft ? 'Open current draft' : 'Create new draft'}
            </button>
          ) : (
            <button
              className="button primary"
              onClick={() => setConfirmation('publish')}
              disabled={
                dirty || busy || loading || (!configured.length && !version.form?.steps.length)
              }
            >
              <Send size={16} /> Publish study
            </button>
          )}
        </div>
      </div>
      {readOnly && (
        <div className="publication-note">
          <LockKeyhole size={18} />
          <span>
            Published on{' '}
            {new Date(version.published_at!).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
            . Create a new draft to make changes.
          </span>
        </div>
      )}
      {!readOnly && dirty && (
        <p className="publish-hint">Save your changes before publishing this version.</p>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => navigate(() => setReload(reload + 1))}>
            Reload study
          </button>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
      <div className="workspace-navigation" aria-label="Study sections">
        <button
          className={selected === 'flow' ? 'section-tab active' : 'section-tab'}
          onClick={() => {
            if (selected !== 'flow') navigate(() => setSelected('flow'));
          }}
          disabled={busy || loading}
        >
          <ClipboardList size={16} /> Session flow
        </button>
        <button
          className={selected === 'details' ? 'section-tab active' : 'section-tab'}
          onClick={() => {
            if (selected !== 'details') navigate(() => setSelected('details'));
          }}
          disabled={busy || loading}
        >
          <FileText size={16} /> Study details
        </button>
        <button
          className={selected === 'samples' ? 'section-tab active' : 'section-tab'}
          disabled={busy || loading}
          onClick={() => {
            if (selected !== 'samples') navigate(() => setSelected('samples'));
          }}
        >
          Coded samples
        </button>
        {configured.map((test) => (
          <button
            className={selected === test.id ? 'section-tab active' : 'section-tab'}
            key={test.id}
            onClick={() => {
              if (selected !== test.id) navigate(() => setSelected(test.id));
            }}
            disabled={busy || loading}
          >
            <ClipboardList size={16} /> Test {test.position + 1}
          </button>
        ))}
        {!readOnly && method && (
          <button
            className={selected === 'new' ? 'section-tab active' : 'section-tab add-test-tab'}
            onClick={() => {
              if (selected !== 'new') navigate(() => setSelected('new'));
            }}
            disabled={busy || loading}
          >
            <Plus size={16} /> Add test
          </button>
        )}
        {!readOnly && selectedTest && (
          <button
            className="text-button remove-test"
            disabled={busy || loading}
            onClick={() => setConfirmation('remove')}
          >
            <Trash2 size={15} /> Remove test
          </button>
        )}
      </div>
      {loading ? (
        <div className="empty-state">
          <div className="spinner" />
          <p>Loading configuration…</p>
        </div>
      ) : selected === 'flow' ? (
        <FlowEditor
          key={versionId + selected}
          version={version}
          tests={configured}
          samples={samples}
          busy={busy}
          onDirty={updateDirty}
          duplicateTest={(testId) =>
            perform(async () => {
              const original = configured.find((test) => test.id === testId)!;
              const clone = await api.saveTest(
                id,
                original.configuration,
                undefined,
                original.test_type_id,
              );
              setConfigured((previous) => [...previous, clone]);
              return clone;
            })
          }
          save={(form) =>
            perform(async () => {
              const saved = await api.saveForm(id, versionId, form);
              setStudy((previous) =>
                previous
                  ? {
                      ...previous,
                      versions: previous.versions.map((item) =>
                        item.id === saved.id ? saved : item,
                      ),
                    }
                  : null,
              );
              setNotice('Session flow saved.');
              updateDirty(false);
              return saved;
            })
          }
        />
      ) : selected === 'samples' ? (
        <SamplePanel
          samples={samples}
          onDirty={updateDirty}
          readOnly={readOnly}
          busy={busy}
          add={(code, label) =>
            perform(async () => {
              const sample = await api.addSample(id, code, label);
              setSamples((previous) => [...previous, sample]);
              setNotice('Coded sample saved.');
            })
          }
        />
      ) : selected === 'details' ? (
        <div className="details-layout">
          <StudyDetails
            key={versionId + selected}
            version={version}
            busy={busy}
            onDirty={updateDirty}
            save={(details) =>
              perform(async () => {
                setStudy(await api.updateStudy(id, details));
                setNotice('Study details saved.');
                updateDirty(false);
              })
            }
          />
          <div className="details-next-action">
            {!readOnly && configured.length === 0 && method && (
              <button className="button primary" onClick={() => navigate(() => setSelected('new'))}>
                <Plus size={16} /> Add your first test
              </button>
            )}
          </div>
        </div>
      ) : method && (selectedTest || selected === 'new') ? (
        <div className="method-editor-section">
          {selected === 'new' && (
            <label className="field-label method-selector">
              Test method
              <select
                aria-label="Test method"
                value={newMethod}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.value;
                  navigate(() => setNewMethod(value));
                }}
              >
                {methods.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {method.id === 'hedonic-9-v1' ? (
            <TestEditor
              key={versionId + selected}
              test={selectedTest as (StudyTest & { configuration: Configuration }) | undefined}
              method={method}
              readOnly={readOnly}
              busy={busy}
              onDirty={updateDirty}
              save={(config) =>
                perform(async () => {
                  const saved = await api.saveTest(id, config, selectedTest?.id);
                  setConfigured((previous) =>
                    selectedTest
                      ? previous.map((test) => (test.id === saved.id ? saved : test))
                      : [...previous, saved],
                  );
                  setSelected(saved.id);
                  setNotice('Test configuration saved.');
                  updateDirty(false);
                  return saved;
                })
              }
            />
          ) : (
            <NewMethodEditor
              key={versionId + selected + method.id}
              test={selectedTest}
              method={method}
              samples={samples}
              readOnly={readOnly}
              busy={busy}
              onDirty={updateDirty}
              save={(config) =>
                perform(async () => {
                  const saved = await api.saveTest(id, config, selectedTest?.id, method.id);
                  setConfigured((previous) =>
                    selectedTest
                      ? previous.map((test) => (test.id === saved.id ? saved : test))
                      : [...previous, saved],
                  );
                  setSelected(saved.id);
                  setNotice('Test configuration saved.');
                  updateDirty(false);
                  return saved;
                })
              }
            />
          )}
        </div>
      ) : (
        <div className="info-note">This method does not have a configuration editor yet.</div>
      )}
      {confirmation === 'publish' && (
        <Modal
          title={`Publish version ${version.version_number}?`}
          close={() => setConfirmation(null)}
          busy={busy}
        >
          <p>
            Publishing freezes the session flow, routes, instructions, questions, scale labels, and
            study details for this version. Future changes will use a new draft.
          </p>
          <div className="publish-summary">
            <strong>{version.title}</strong>
            <span>
              {configured.length} {configured.length === 1 ? 'test' : 'tests'} ·{' '}
              {configured.reduce((count, test) => count + testQuestions(test).length, 0)} questions
              {version.form ? ` · ${version.form.steps.length} flow blocks` : ''}
            </span>
          </div>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirmation(null)}
              disabled={busy}
            >
              Keep reviewing
            </button>
            <button className="button primary" onClick={publish} disabled={busy}>
              <Send size={16} />
              {busy ? 'Publishing…' : 'Publish version'}
            </button>
          </div>
        </Modal>
      )}
      {confirmation === 'remove' && (
        <Modal title="Remove this draft test?" close={() => setConfirmation(null)} busy={busy}>
          <p>
            This removes test {(selectedTest?.position ?? 0) + 1} and its configuration from the
            current draft. Published versions keep their original tests.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirmation(null)}
              disabled={busy}
            >
              Keep test
            </button>
            <button className="button danger" onClick={removeTest} disabled={busy}>
              {busy ? 'Removing…' : 'Remove test'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
