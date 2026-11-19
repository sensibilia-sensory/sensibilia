import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  LayoutGrid,
  LogOut,
  Plus,
} from 'lucide-react';
import { Api, type Method } from './api';
import { Modal } from './Modal';
import { StudyLibrary } from './StudyLibrary';
import { StudyWorkspace } from './StudyWorkspace';

function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <i />
        <i />
        <i />
      </span>
      <span>
        Sensibilia<span className="brand-subtitle">RESEARCH WORKSPACE</span>
      </span>
    </div>
  );
}

export function App() {
  const [token, setToken] = useState('');
  const [methods, setMethods] = useState<Method[]>([]);
  const api = useMemo(() => new Api(token), [token]);
  if (!token)
    return (
      <SignIn
        connect={(credential, registered) => {
          setMethods(registered);
          setToken(credential);
        }}
      />
    );
  return (
    <ResearcherApp
      api={api}
      methods={methods}
      signOut={() => {
        setToken('');
        setMethods([]);
      }}
    />
  );
}

function SignIn({ connect }: { connect: (token: string, methods: Method[]) => void }) {
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="signin-layout">
      <aside className="signin-story" aria-label="About Sensibilia">
        <Brand />
        <div className="signin-copy">
          <span className="eyebrow">BUILT FOR YOUR LABORATORY</span>
          <h1>
            Good research starts
            <br />
            with a well-designed study.
          </h1>
          <p>
            A considered workspace for configuring sensory studies, reviewing the assessor
            experience, and preparing for collection.
          </p>
          <div className="signin-steps">
            <span>
              01 <strong>Configure</strong>
            </span>
            <span>
              02 <strong>Preview</strong>
            </span>
            <span>
              03 <strong>Publish</strong>
            </span>
          </div>
        </div>
        <div className="signin-footer">
          <span className="tiny-dot" /> Your laboratory. Your research.
        </div>
      </aside>
      <main className="signin-main">
        <form
          className="signin-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              const key = credential.trim();
              const registered = await new Api(key).methods();
              setCredential('');
              connect(key, registered);
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not connect.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="signin-icon">
            <KeyRound size={23} />
          </span>
          <span className="eyebrow">RESEARCHER ACCESS</span>
          <h2>Welcome to your workspace</h2>
          <p className="muted">Connect with your laboratory researcher access key.</p>
          <label className="field-label" htmlFor="access-key">
            Researcher access key
          </label>
          <input
            id="access-key"
            type="password"
            value={credential}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="Enter your access key, or leave empty if none is set"
            disabled={busy}
          />
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary signin-button" disabled={busy}>
            {busy ? 'Connecting…' : 'Open workspace'}
            <ArrowRight size={18} />
          </button>
          <p className="signin-help">
            Your administrator can provide the key. It stays in this page’s memory; sign in again
            after a reload.
          </p>
        </form>
      </main>
    </div>
  );
}

function ResearcherApp({
  api,
  methods,
  signOut,
}: {
  api: Api;
  methods: Method[];
  signOut: () => void;
}) {
  const [view, setView] = useState<'studies' | 'methods'>('studies');
  const [studyId, setStudyId] = useState<string | null>(() =>
    new URL(location.href).searchParams.get('study'),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);

  function navigate(action: () => void) {
    if (busy) return;
    if (dirty) setDiscardAction(() => action);
    else action();
  }
  function openStudy(id: string | null) {
    setStudyId(id);
    setView('studies');
    setDirty(false);
    const url = new URL(location.href);
    if (id) url.searchParams.set('study', id);
    else url.searchParams.delete('study');
    history.replaceState(null, '', url);
  }
  function newStudy() {
    navigate(() => {
      setTitle('');
      setDescription('');
      setError('');
      setCreating(true);
    });
  }

  return (
    <div className="app-layout">
      <header className="researcher-header">
        <Brand />
        <nav aria-label="Main navigation">
          <button
            className={view === 'studies' ? 'nav-item active' : 'nav-item'}
            disabled={busy}
            onClick={() => navigate(() => openStudy(null))}
          >
            <LayoutGrid size={19} /> Studies
          </button>
          <button
            className={view === 'methods' ? 'nav-item active' : 'nav-item'}
            disabled={busy}
            onClick={() =>
              navigate(() => {
                setView('methods');
                setDirty(false);
              })
            }
          >
            <BookOpen size={19} /> Method library
          </button>
        </nav>
        <button
          className="button subtle account-button"
          aria-label="Sign out"
          disabled={busy}
          onClick={() => navigate(signOut)}
        >
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </header>
      <div className="app-main">
        <main>
          {view === 'methods' ? (
            <MethodLibrary methods={methods} createStudy={newStudy} />
          ) : studyId ? (
            <StudyWorkspace
              key={studyId}
              id={studyId}
              api={api}
              methods={methods}
              back={() => navigate(() => openStudy(null))}
              navigate={navigate}
              onDirty={setDirty}
              onBusy={setBusy}
            />
          ) : (
            <StudyLibrary
              api={api}
              openStudy={(id) => navigate(() => openStudy(id))}
              createStudy={newStudy}
            />
          )}
        </main>
      </div>
      {creating && (
        <Modal
          title="Create a study"
          close={() => {
            setCreating(false);
            setError('');
          }}
          busy={busy}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                const study = await api.createStudy({ title, description });
                setCreating(false);
                openStudy(study.id);
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Could not create the study.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Start with a name and a little context. You can refine both while the study is a
              draft.
            </p>
            <fieldset className="editor-fields" disabled={busy}>
              <label className="field-label" htmlFor="new-title">
                Study title
              </label>
              <input
                id="new-title"
                autoFocus
                required
                maxLength={250}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Oat drink acceptance"
              />
              <label className="field-label" htmlFor="new-description">
                Description <span className="optional">Optional</span>
              </label>
              <textarea
                id="new-description"
                maxLength={10000}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this study exploring?"
              />
            </fieldset>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy || !title.trim()}>
                <Plus size={16} />
                {busy ? 'Creating…' : 'Create draft study'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {discardAction && (
        <Modal title="Discard unsaved changes?" close={() => setDiscardAction(null)}>
          <p>
            Your latest edits have not been saved. Keep editing to save them, or discard them to
            continue.
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDiscardAction(null)}>
              Keep editing
            </button>
            <button
              className="button danger"
              onClick={() => {
                const action = discardAction;
                setDiscardAction(null);
                setDirty(false);
                action();
              }}
            >
              Discard changes
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MethodLibrary({ methods, createStudy }: { methods: Method[]; createStudy: () => void }) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ESTABLISHED SENSORY METHODS</span>
          <h1>Method library</h1>
          <p className="muted">Reusable methods, configured for your study.</p>
        </div>
      </div>
      <div className="method-grid">
        {methods.map((method) => (
          <article className="method-card" key={method.id}>
            <div className="section-row">
              <span className="method-symbol">
                <FlaskConical size={27} />
              </span>
              <span className="pill published">
                <CheckCircle2 size={13} /> Available
              </span>
            </div>
            <span className="eyebrow">{method.key.replaceAll('_', ' ')}</span>
            <h2>{method.name}</h2>
            <p>
              {typeof method.method_metadata.description === 'string'
                ? method.method_metadata.description
                : 'Measure liking with nine ordered response categories. Configure questions, instructions and reviewed scale labels.'}
            </p>
            <dl>
              <div>
                <dt>Implementation</dt>
                <dd>Configuration, preview and response validation</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{method.schema_version}</dd>
              </div>
            </dl>
            {typeof method.method_metadata.source_url === 'string' && (
              <a
                className="method-source"
                href={method.method_metadata.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Read the methodological reference <ArrowRight size={15} />
              </a>
            )}
            <button className="button primary" onClick={createStudy}>
              <Plus size={16} /> Create a study
            </button>
          </article>
        ))}
      </div>
      <p className="method-footnote">
        Methods include collection and researcher rehearsal. Statistical analyses and the offline
        assessor PWA remain separate development stages.
      </p>
    </div>
  );
}
