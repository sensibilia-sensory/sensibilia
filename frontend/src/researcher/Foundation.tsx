import type { components } from '../api-schema';
import { RegisteredMethodFields } from '../NewMethodEditor';
import { defaultConfiguration } from '../methods';
import {
  configurationErrors,
  registeredMethods,
  setMethods as setLevelMethods,
  type Configuration,
} from '../shared/methods/registry';
import {
  SampleBattery,
  batteryProblems,
  batteryRequest,
  emptyBattery,
  isBlank,
  type Battery,
} from './SampleBattery';
import { themeOptions, useResearcherTheme } from './theme';
import {
  ArchivedStudies,
  LifecyclePanel,
  studyColumns,
  type LifecycleMode,
} from './StudyLifecycle';
import { Rooms } from './Operations';
import { AssetEditor } from './Assets';
import { AssetScope } from '../shared/nodes/AssetScope';
import type { Asset } from '../shared/assets';
import { SamplesDesign } from './SamplesDesign';
import { settingHelp } from '../shared/nodes/settingHelp';
import { Templates } from './Templates';
import { QuestionnaireBlocks } from './QuestionnaireBlocks';
import { QuestionnaireEditor } from '../shared/nodes/QuestionnaireEditor';
import { ScaleBuilder, ScaleLayoutField, layoutOptions } from '../shared/nodes/ScaleSettings';
import { InfoTextEditor } from '../shared/nodes/InfoTextEditor';
import { StudyChecklist, StudyHelp } from './Usability';
import { StepMenu } from './StepMenu';
import { QuestionnaireFile, type BankItem } from './QuestionnaireFile';
import { insertNodes } from '../shared/nodes/questionnaireFile';
import { StepPreview } from './StepPreview';
import { kindLabel } from '../shared/lexicon';
import { Terminals } from './Terminals';
import { RunStudy } from './RunStudy';
import { Data } from './Data';
import { Analyses } from './Analyses';
import { Sessions } from './Sessions';
import { FlowCheck, PublicationSnapshot, type Issue } from './FlowCheck';
import { MethodTextEditor } from '../shared/nodes/MethodTextEditor';
import { methodTextFields, reconcileMethodText, removeLanguage } from '../shared/flow/text';
import { LoopProperties } from '../shared/nodes/LoopProperties';
import type { Sample } from '../shared/flow';
import { GuardProperties } from '../shared/nodes/GuardProperties';
import {
  nodeKinds,
  newNode,
  nodeFields,
  changeAnswerType,
  bindMethods,
  cloneNode,
} from '../shared/nodes/authoring';
import {
  outline,
  updateNode,
  siblingEdit,
  conditionText,
  moveNodeTo,
  insertNear,
  methodTestsInLoops,
  type Node,
} from '../shared/flow';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Archive,
  BookOpen,
  ExternalLink,
  FlaskConical,
  LayoutTemplate,
  LogOut,
  Play,
  Tablet,
  type LucideIcon,
} from 'lucide-react';
import {
  AppShell,
  Button,
  DataTable,
  Field,
  OutlineTable,
  Popover,
  technical,
  PropertyGrid,
  SchemaFields,
  SidePanel,
  StatusText,
  Tabs,
  Toolbar,
  type ScaleLayout,
} from '../ui';
import { Link, navigate, useRoute, setNavigationGuard } from '../router';
import {
  ApiError,
  Client,
  type Method,
  type Study,
  type Version,
  type Test,
  type Flow,
  type Report,
} from './client';
import { editorLabels } from '../shared/methods/hedonic_acceptance_9';
import { LinearPreview } from '../shared/nodes/LinearPreview';

const root = '/researcher';
const available = (m: Method) => registeredMethods.has(m.id);
const workspace = (s: string, v: string) => root + '/studies/' + s + '/versions/' + v;
const message = (error: unknown) => (error instanceof Error ? error.message : 'Request failed.');
function Heading({ children }: { children: ReactNode }) {
  return <h1 tabIndex={-1}>{children}</h1>;
}
function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="ui-stack">
      <p role="alert">
        {message(error)}
        {error instanceof ApiError && error.retryAfter
          ? ' Retry after ' + error.retryAfter + ' seconds.'
          : ''}
      </p>
      {error instanceof ApiError && error.fieldErrors.length > 0 && (
        <DataTable
          id="field-errors"
          label="Field errors"
          data={error.fieldErrors.map((field, i) => ({ ...field, id: String(i) }))}
          getRowId={(field) => field.id}
          columns={[
            { id: 'path', header: 'Field', accessorFn: (field) => field.path.join(' → ') },
            { accessorKey: 'code', header: 'Code' },
            { accessorKey: 'message', header: 'Message' },
          ]}
        />
      )}
      {retry && <Button onClick={retry}>Retry read</Button>}
    </div>
  );
}
export function Foundation() {
  const route = useRoute();
  const [signedIn, setSignedIn] = useState(false);
  const [input, setInput] = useState('');
  const [authNeeded, setAuthNeeded] = useState(false);
  const [client] = useState(() => new Client('', '', () => setAuthNeeded(true)));
  const [theme, setTheme] = useResearcherTheme();
  useEffect(() => {
    document.querySelector<HTMLElement>('h1')?.focus();
  }, [route, signedIn]);
  const item = (path: string, label: string, Icon: LucideIcon) => (
    <Button
      variant="quiet"
      aria-current={
        route === root + path || route.startsWith(root + path + '/') ? 'page' : undefined
      }
      onClick={() => navigate(root + path)}
    >
      <Icon /> {label}
    </Button>
  );
  const nav = (
    <>
      <div className="ui-nav-group">
        <p className="ui-nav-label">Laboratory</p>
        {item('/studies', 'Studies', FlaskConical)}
        {item('/run', 'Run study', Play)}
        {item('/archive', 'Archive', Archive)}
        {item('/templates', 'Study templates', LayoutTemplate)}
        {item('/terminals', 'Laboratory terminals', Tablet)}
      </div>
      <div className="ui-nav-group">
        <p className="ui-nav-label">Reference</p>
        {item('/methods', 'Method reference', BookOpen)}
        <Link className="ui-button ui-button--quiet" href="/operator">
          <ExternalLink /> Operator dashboard
        </Link>
      </div>
      <div className="ui-nav-group ui-nav-footer">
        <Field
          kind="select"
          stacked
          label="Theme"
          value={theme}
          options={themeOptions}
          onChange={(e) => setTheme(e.target.value as (typeof themeOptions)[number]['value'])}
        />
        {signedIn && (
          <Button
            variant="quiet"
            onClick={() => {
              client.setResearcherToken('');
              setSignedIn(false);
              setInput('');
              setAuthNeeded(false);
            }}
          >
            <LogOut /> Sign out
          </Button>
        )}
      </div>
    </>
  );
  return (
    <AppShell
      navigationLabel="Researcher sections"
      breadcrumbs={[{ label: 'Laboratory', href: root + '/studies' }, { label: 'Researcher' }]}
      navigation={nav}
    >
      {authNeeded && signedIn && (
        <form
          className="ui-stack"
          onSubmit={(e) => {
            e.preventDefault();
            client.setResearcherToken(input);
            setInput('');
            setAuthNeeded(false);
          }}
        >
          <p role="alert">Access key was rejected. Re-enter it, then retry the read or save.</p>
          <Field
            kind="password"
            label="Replacement access key"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button type="submit">Update access key</Button>
        </form>
      )}
      {!signedIn ? (
        <form
          className="ui-stack"
          onSubmit={(e) => {
            e.preventDefault();
            client.setResearcherToken(input);
            setAuthNeeded(false);
            setSignedIn(true);
            setInput('');
          }}
        >
          <Heading>Researcher sign-in</Heading>
          <Field
            kind="password"
            label="Access key"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button variant="primary" type="submit">
            Sign in
          </Button>
        </form>
      ) : (
        <ResearcherRoutes client={client} route={route} />
      )}
    </AppShell>
  );
}
function ResearcherRedirect() {
  useEffect(() => {
    navigate(root + '/studies', true);
  }, []);
  return null;
}
/** The booth board and Run day became Run study; old links keep working. */
function BoardRedirect() {
  useEffect(() => {
    navigate(root + '/run', true);
  }, []);
  return null;
}
function ResearcherRoutes({ client, route }: { client: Client; route: string }) {
  const url = new URL(route, location.origin);
  const path = url.pathname;
  if (path === root + '/' || path === root) return <ResearcherRedirect />;
  if (path === root + '/methods' || path.startsWith(root + '/methods/'))
    return <Methods client={client} selected={path.split('/')[3]} />;
  if (path === root + '/templates') return <Templates client={client} />;
  if (path === root + '/run')
    return <RunStudy client={client} view={url.searchParams.get('view') ?? undefined} />;
  if (path === root + '/archive')
    return (
      <ArchivedStudies client={client} open={(study) => navigate(root + '/studies/' + study.id)} />
    );
  if (path === root + '/board') return <BoardRedirect />;
  if (path === root + '/rooms') return <Rooms client={client} />;
  if (path === root + '/terminals') return <Terminals client={client} />;
  if (path === root + '/studies/new') return <NewStudy client={client} />;
  if (path === root + '/studies')
    return (
      <Studies
        client={client}
        search={url.searchParams.get('search') ?? ''}
        offset={Number(url.searchParams.get('offset') ?? 0)}
      />
    );
  const parts = path.split('/');
  if (parts[2] === 'studies' && parts[3] && parts.length === 4)
    return <ResolveStudy client={client} id={parts[3]} />;
  if (
    parts[2] === 'studies' &&
    parts[4] === 'versions' &&
    parts[5] &&
    (!parts[6] ||
      [
        'details',
        'flow',
        'preview',
        'publish',
        'sessions',
        'data',
        'analyses',
        'samples',
        'design',
        'blinding',
      ].includes(parts[6]))
  )
    return (
      <Workspace
        key={parts[3] + '/' + parts[5]}
        client={client}
        s={parts[3]}
        v={parts[5]}
        tab={parts[6] ?? 'details'}
        nodeId={parts[7]}
        panel={url.searchParams.get('panel') ?? undefined}
        issueLanguage={url.searchParams.get('language') ?? undefined}
        issueField={url.searchParams.get('field') ?? undefined}
      />
    );
  return <Heading>Not found.</Heading>;
}
function Methods({ client, selected }: { client: Client; selected?: string }) {
  const [methods, setMethods] = useState<Method[]>([]);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(true);
  const load = () => {
    setBusy(true);
    setError(undefined);
    client
      .methods()
      .then(setMethods)
      .catch(setError)
      .finally(() => setBusy(false));
  };
  useEffect(load, [client]);
  const chosen = methods.find((m) => m.id === selected);
  const columns: ColumnDef<Method>[] = [
    { accessorKey: 'key', header: 'Key', meta: technical },
    { accessorKey: 'name', header: 'Name' },
    {
      id: 'description',
      header: 'Description',
      accessorFn: (m) => String(m.method_metadata.description ?? m.method_metadata.citation ?? ''),
    },
    {
      id: 'implementation',
      header: 'Implementation',
      meta: technical,
      accessorFn: (m) => (available(m) ? 'Authoring + preview' : 'Authoring planned'),
    },
    { accessorKey: 'schema_version', header: 'Schema v.', meta: technical },
    { id: 'status', header: 'Status', accessorFn: (m) => (available(m) ? 'Available' : 'Planned') },
    {
      id: 'reference',
      header: 'Ref.',
      cell: ({ row }) =>
        typeof row.original.method_metadata.source_url === 'string' ? (
          <a href={row.original.method_metadata.source_url} target="_blank" rel="noreferrer">
            Source
          </a>
        ) : (
          '—'
        ),
      enableSorting: false,
    },
  ];
  return (
    <section aria-busy={busy}>
      <Toolbar
        label="Method reference actions"
        secondary={
          <Button onClick={load} disabled={busy}>
            Refresh
          </Button>
        }
      >
        <Heading>Method reference</Heading>
      </Toolbar>
      <p className="ui-hint">
        Registered sensory methods and their literature references. Add a method to a study from the
        study's Add step menu.
      </p>
      <ErrorNotice error={error} retry={load} />
      {busy && <p role="status">Loading methods…</p>}
      <DataTable
        id="methods-table"
        label="Methods"
        columns={columns}
        data={methods}
        getRowId={(m) => m.id}
        selectable={false}
        onActivate={(m) => navigate(root + '/methods/' + m.id)}
      />
      {selected && !busy && !chosen && (
        <p role="alert">
          Method not found. <Link href={root + '/methods'}>Return to the method reference</Link>
        </p>
      )}
      {chosen && (
        <SidePanel title={chosen.name} onClose={() => navigate(root + '/methods')}>
          <p>
            Key: {chosen.key} · schema {chosen.schema_version}
          </p>
          <p>{String(chosen.method_metadata.citation ?? '')}</p>
          <details>
            <summary>Technical details</summary>
            <pre>{JSON.stringify(chosen.configuration_schema, null, 2)}</pre>
          </details>
        </SidePanel>
      )}
    </section>
  );
}
function Studies({ client, search, offset }: { client: Client; search: string; offset: number }) {
  const [data, setData] = useState<Study[]>([]);
  const [query, setQuery] = useState(search);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>();
  const load = () => {
    setBusy(true);
    setError(undefined);
    client
      .studies(search, offset)
      .then(setData)
      .catch(setError)
      .finally(() => setBusy(false));
  };
  useEffect(load, [client, search, offset]);
  useEffect(() => setQuery(search), [search]);
  const [panel, setPanel] = useState<{ study: Study; mode: LifecycleMode } | null>(null);
  const reopen = async (study: Study) => {
    setBusy(true);
    try {
      await client.studyAction(study.id, 'reopen');
      load();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const columns = studyColumns(data.some((s) => s.open_assessments > 0));
  return (
    <section aria-busy={busy}>
      <Toolbar label="Studies actions">
        <Heading>Studies</Heading>
        <Button variant="primary" onClick={() => navigate(root + '/studies/new')}>
          New study
        </Button>
        <Button onClick={load} disabled={busy}>
          Refresh
        </Button>
      </Toolbar>
      <form
        className="ui-inline"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(root + '/studies?' + new URLSearchParams({ search: query, offset: '0' }));
        }}
      >
        <Field label="Search studies" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      <ErrorNotice error={error} retry={load} />
      {busy && <p role="status">Loading studies…</p>}
      <div className={panel ? 'ui-split' : undefined}>
        <div className="ui-split-main ui-stack">
          <DataTable
            id="studies-table"
            label="Studies"
            emptyText={busy ? 'Loading studies…' : 'No studies yet. Use New study to start one.'}
            data={data}
            columns={columns}
            getRowId={(s) => s.id}
            onActivate={(s) => navigate(root + '/studies/' + s.id)}
            rowActions={(s) => (
              <div className="ui-inline">
                <Button variant="quiet" onClick={() => navigate(root + '/studies/' + s.id)}>
                  Open
                </Button>
                {s.status === 'active' && (
                  <Button compact onClick={() => setPanel({ study: s, mode: 'close' })}>
                    Close
                  </Button>
                )}
                {s.closed_at && (
                  <Button compact disabled={busy} onClick={() => void reopen(s)}>
                    Reopen
                  </Button>
                )}
                <Button compact onClick={() => setPanel({ study: s, mode: 'archive' })}>
                  Archive
                </Button>
              </div>
            )}
          />
        </div>
        {panel && (
          <div className="ui-split-side">
            <LifecyclePanel
              client={client}
              study={panel.study}
              mode={panel.mode}
              onClose={() => setPanel(null)}
              onDone={() => {
                setPanel(null);
                load();
              }}
            />
          </div>
        )}
      </div>
      <Toolbar>
        <Button
          disabled={offset === 0 || busy}
          onClick={() =>
            navigate(
              root +
                '/studies?' +
                new URLSearchParams({ search, offset: String(Math.max(0, offset - 50)) }),
            )
          }
        >
          Previous page
        </Button>
        <Button
          disabled={data.length < 50 || busy}
          onClick={() =>
            navigate(
              root + '/studies?' + new URLSearchParams({ search, offset: String(offset + 50) }),
            )
          }
        >
          Next page
        </Button>
      </Toolbar>
    </section>
  );
}
function NewStudy({ client }: { client: Client }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [battery, setBattery] = useState<Battery>(emptyBattery);
  const [methods, setMethods] = useState<Method[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => {
    client.methods().then(setMethods, setError);
  }, [client]);
  return (
    <form
      className="ui-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const found = isBlank(battery) ? [] : batteryProblems(battery);
        setProblems(found);
        if (found.length) return;
        setBusy(true);
        setError(undefined);
        try {
          const study = isBlank(battery)
            ? await client.create({ title, description })
            : await client.createFromSamples(batteryRequest(battery, methods, title, description));
          navigate(workspace(study.id, study.versions[0].id) + '/flow');
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Toolbar>
        <Heading>New study</Heading>
        <Button onClick={() => navigate(root + '/studies')}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy || !title.trim()}>
          Create draft
        </Button>
      </Toolbar>
      <ErrorNotice error={error} />
      <PropertyGrid
        sections={[
          {
            title: 'Study identity',
            defaultOpen: true,
            children: (
              <>
                <Field
                  label="Title"
                  placeholder="Enter study title"
                  disabled={busy}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  error={title.length > 250 ? 'Maximum 250 characters.' : undefined}
                />
                <Field
                  label="Description"
                  kind="textarea"
                  rows={3}
                  placeholder="Optional study description"
                  disabled={busy}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </>
            ),
          },
          {
            title: 'Samples and methods (optional)',
            defaultOpen: true,
            children: (
              <>
                <p className="field-help">
                  Start from a set of samples, such as four cheeses, and the methods each sample is
                  evaluated with. The draft contains one step that repeats those methods for every
                  sample; refine them in Build.
                </p>
                <SampleBattery
                  value={battery}
                  methods={methods}
                  disabled={busy}
                  onChange={setBattery}
                />
                {problems.length > 0 && (
                  <ul role="alert">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </>
            ),
          },
        ]}
      />
    </form>
  );
}
function ResolveStudy({ client, id }: { client: Client; id: string }) {
  const [error, setError] = useState<unknown>();
  const load = () =>
    client
      .study(id)
      .then((s) => {
        const v = s.versions.find((v) => !v.published_at) ?? s.versions.at(-1);
        if (v) navigate(workspace(s.id, v.id) + '/details', true);
        else setError(new Error('Study has no versions.'));
      })
      .catch(setError);
  useEffect(() => {
    load();
  }, [client, id]);
  return (
    <>
      <Heading>Study</Heading>
      <p role="status">Resolving version…</p>
      <ErrorNotice error={error} retry={load} />
    </>
  );
}

function Workspace({
  client,
  s,
  v,
  tab,
  nodeId,
  panel,
  issueLanguage,
  issueField,
}: {
  client: Client;
  s: string;
  v: string;
  tab: string;
  nodeId?: string;
  panel?: string;
  issueLanguage?: string;
  issueField?: string;
}) {
  const [version, setVersion] = useState<Version>();
  const [versions, setVersions] = useState<Version[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [assets, setAssets] = useState<components['schemas']['AssetRead'][]>([]);
  const loadAsset = useCallback(
    (asset: Asset) => client.assetBytes(s, v, asset.id),
    [client, s, v],
  );
  const [methods, setMethods] = useState<Method[]>([]);
  const [method, setMethod] = useState<Method>();
  const [newMethodId, setNewMethodId] = useState(
    () => new URL(location.href).searchParams.get('method_id') ?? 'hedonic-9-v1',
  );
  const [flow, setFlow] = useState<Flow>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>();
  const [dirty, setDirty] = useState(false);
  const [destination, setDestination] = useState<string>();
  const creatingMethod = useRef(false);
  // The step that was selected when the method was chosen: the new step is placed next to it.
  const methodAnchor = useRef<string | undefined>(undefined);
  const [config, setConfig] = useState<Configuration>();
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({});
  const [nodeErrors, setNodeErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Report>();
  const [ack, setAck] = useState(false);
  const [warningCodes, setWarningCodes] = useState<string[]>([]);
  const [editorLanguage, setEditorLanguage] = useState('en');
  const [languageInput, setLanguageInput] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [notice, setNotice] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [serverComparison, setServerComparison] = useState<Version>();
  const [auditRows, setAuditRows] = useState<Awaited<ReturnType<Client['audit']>>>(),
    [auditError, setAuditError] = useState(''),
    [auditBusy, setAuditBusy] = useState(false);
  const [saveState, setSaveState] = useState('Saved');
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyPanel, setCopyPanel] = useState(false),
    [copyTitle, setCopyTitle] = useState(''),
    [copyAck, setCopyAck] = useState(false);
  const [templatePanel, setTemplatePanel] = useState(false),
    [templateName, setTemplateName] = useState(''),
    [templateNotes, setTemplateNotes] = useState('');
  const [blockPanel, setBlockPanel] = useState(false);
  const [filePanel, setFilePanel] = useState(false);
  const [bankItems, setBankItems] = useState<BankItem[]>([]);
  const [bankBusy, setBankBusy] = useState(false);
  const [bankError, setBankError] = useState('');
  const loadBank = async () => {
    setBankBusy(true);
    try {
      setBankItems(await client.questionnaireItems());
      setBankError('');
    } catch (e) {
      setBankError(e instanceof Error ? e.message : 'The item bank could not be read');
    } finally {
      setBankBusy(false);
    }
  };
  useEffect(() => {
    if (filePanel) void loadBank();
    // Read the bank each time the panel opens.
  }, [filePanel]);
  type Buffer = { flow: Flow; tests: Test[]; title: string; description: string };
  const history = useRef<Buffer[]>([]),
    cursor = useRef(-1),
    applying = useRef(false),
    saving = useRef<Promise<boolean> | null>(null),
    latest = useRef({ flow, config, title, description });
  latest.current = { flow, config, title, description };
  const [saveTick, setSaveTick] = useState(0);
  const [, setHistoryTick] = useState(0);
  const base = workspace(s, v);
  useEffect(() => {
    if (panel !== 'check') return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      navigate(base + '/flow');
      requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>('[data-flow-check-trigger]')?.focus(),
      );
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [panel, s, v]);
  const legacy = version?.form?.schema_version === 1;
  const readOnly = !!version?.published_at || legacy || !!archivedAt;
  const entries = flow ? outline(flow.nodes) : [];
  const selectedEntry = entries.find((e) => e.node.id === nodeId);
  const selected = selectedEntry?.node;
  const parent = entries.find((e) => e.node.id === selectedEntry?.ancestors.at(-1))?.node;
  const siblings =
    parent?.kind === 'group' || parent?.kind === 'loop_samples'
      ? parent.data.children
      : (flow?.nodes ?? []);
  const previousSibling = siblings[siblings.findIndex((n) => n.id === selected?.id) - 1];
  const canIndent =
    (previousSibling?.kind === 'group' || previousSibling?.kind === 'loop_samples') &&
    entries
      .filter((e) => e.node.id === selected?.id || e.ancestors.includes(selected?.id ?? ''))
      .every((e) => e.ancestors.length < 3);
  const editConfiguration = (next: Configuration) => {
    if (flow && config && selectedTest && flow.method_text?.[selectedTest.id])
      changed({
        ...flow,
        method_text: {
          ...flow.method_text,
          [selectedTest.id]: reconcileMethodText(
            config,
            next,
            flow.method_text[selectedTest.id],
            flow.default_language,
          ),
        },
      });
    setConfig(next);
    setError(undefined);
    setSaveState('Not saved');
    setReview(undefined);
    setAck(false);
    setDirty(true);
  };
  const changeSelected = (node: Node) =>
    flow && changed({ ...flow, nodes: updateNode(flow.nodes, node.id, () => node) });
  const selectedTest =
    selected?.kind === 'embedded_method'
      ? tests.find((t) => t.id === selected.data.study_test_id)
      : undefined;
  const load = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const [ver, inventory, met, study, sampleInventory, assetInventory] = await Promise.all([
        client.version(s, v),
        client.tests(s, v),
        client.methods(),
        client.study(s),
        client.samples(s, v),
        client.assets(s, v),
      ]);
      setVersion(ver);
      setEditorLanguage(ver.form?.schema_version === 2 ? ver.form.default_language : 'en');
      setTests(inventory);
      setSamples(sampleInventory);
      setAssets(assetInventory);
      setMethods(met);
      setMethod(met.find((m) => m.id === newMethodId));
      setVersions(study.versions);
      setArchivedAt(study.archived_at ?? null);
      setTitle(ver.title);
      setDescription(ver.description);
      setFlow(
        ver.form?.schema_version === 2
          ? ver.form
          : { schema_version: 2, languages: ['en'], default_language: 'en', nodes: [] },
      );
      setDirty(false);
      setSaveState('Saved');
      history.current = [];
      cursor.current = -1;
      setReview(undefined);
      setAck(false);
      setWarningCodes([]);
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, [client, s, v]);
  useEffect(() => {
    // Deselecting a step to add a method must not discard the new method's settings.
    if (creatingMethod.current && !selectedTest) return;
    setConfig(selectedTest?.configuration as Configuration | undefined);
    if (selectedTest) setMethod(methods.find((m) => m.id === selectedTest.test_type_id));
    setConfigErrors({});
  }, [selectedTest, methods]);
  useEffect(() => {
    if (!issueField) setNodeErrors({});
  }, [selected?.id, issueField]);
  useEffect(() => {
    setNavigationGuard((href) => {
      if (!dirty) return true;
      setDestination(href);
      return false;
    });
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      setNavigationGuard(undefined);
      window.removeEventListener('beforeunload', unload);
    };
  }, [dirty]);
  useEffect(() => {
    const saveKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!readOnly && !busy) void save();
      }
    };
    window.addEventListener('keydown', saveKey);
    return () => window.removeEventListener('keydown', saveKey);
  });
  const checkSaved = async () => {
    if (saving.current && !(await saving.current)) return;
    else if (dirty && !(await save())) return;
    if (!version || legacy) return;
    setReviewBusy(true);
    setError(undefined);
    setReviewError('');
    setWarningCodes([]);
    setAck(false);
    try {
      const [snapshot, inventory, assigned, result, savedAssets] = await Promise.all([
        client.version(s, v),
        client.tests(s, v),
        client.samples(s, v),
        client.report(s, v),
        client.assets(s, v),
      ]);
      if (snapshot.revision_hash !== result.revision_hash)
        throw new Error('Draft changed during review; check the saved snapshot again.');
      setVersion(snapshot);
      setTests(inventory);
      setSamples(assigned);
      setAssets(savedAssets);
      setFlow(snapshot.form?.schema_version === 2 ? snapshot.form : flow);
      setTitle(snapshot.title);
      setDescription(snapshot.description);
      setReview(result);
    } catch (e) {
      setReview(undefined);
      setReviewError(message(e));
    } finally {
      setReviewBusy(false);
    }
  };
  useEffect(() => {
    if (panel === 'check' && version && !dirty) void checkSaved();
  }, [panel, version?.revision_hash]);
  const issueStep = (issue: Issue) => {
    const entry = entries.find(
      (e) =>
        e.node.id === issue.node_id ||
        (!!issue.study_test_id &&
          e.node.kind === 'embedded_method' &&
          e.node.data.study_test_id === issue.study_test_id),
    );
    return entry
      ? entry.number + ' ' + (entry.node.title[flow?.default_language ?? 'en'] ?? '')
      : '';
  };
  const openIssue = (issue: Issue) => {
    const id =
      issue.node_id ??
      entries.find(
        (e) =>
          e.node.kind === 'embedded_method' && e.node.data.study_test_id === issue.study_test_id,
      )?.node.id;
    const language = issue.path.at(-1);
    const lang =
      typeof language === 'string' && flow?.languages.includes(language)
        ? language
        : (flow?.default_language ?? 'en');
    let field =
      issue.path[0] === 'method_text'
        ? String(issue.path[2] ?? '')
        : issue.path
            .slice(issue.path.indexOf(id ?? '') + 1)
            .filter((p) => p !== lang)
            .join('.');
    if (!id) field = String(issue.path[0] ?? '');
    setNodeErrors({ [field.replace(/^data\./, '')]: issue.message });
    navigate(
      base +
        (id ? '/flow/' + id : '/details') +
        '?' +
        new URLSearchParams({ language: lang, field }),
    );
  };
  useEffect(() => {
    if (issueLanguage && flow?.languages.includes(issueLanguage)) setEditorLanguage(issueLanguage);
    if (!issueField) return;
    requestAnimationFrame(() => {
      const field = issueField.replace(/^data\./, '');
      if (field === 'guard') {
        const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Show only if"]');
        if (trigger?.getAttribute('aria-expanded') === 'false') trigger.click();
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>('[aria-label="Answer or setting 1"],[aria-label="Show if"]')
            ?.focus(),
        );
        return;
      }
      let el = issueField.startsWith('/')
        ? document.getElementById(
            'method-text-' + issueField + '-' + (issueLanguage ?? editorLanguage),
          )
        : field === 'title'
          ? document.getElementById('node-title')
          : [...document.querySelectorAll<HTMLElement>('[id]')].find((el) =>
              el.id.endsWith('-schema-' + field),
            );
      if (!el)
        el = document.querySelector<HTMLElement>(
          field === 'languages'
            ? '[aria-label="Declared languages"]'
            : field === 'otherwise'
              ? '[aria-label="If condition is not met target"],[aria-label="If condition is not met"]'
              : '[aria-label="Step title"]',
        );
      if (el) {
        for (let p = el.parentElement; p; p = p.parentElement)
          if (p instanceof HTMLDetailsElement) p.open = true;
        el.focus();
      }
    });
  }, [issueField, issueLanguage, selected?.id, editorLanguage]);
  const changed = (next: Flow) => {
    setFlow({ ...next, nodes: bindMethods(next.nodes) });
    setError(undefined);
    setSaveState('Not saved');
    setDirty(true);
    setReview(undefined);
    setAck(false);
    setWarningCodes([]);
  };
  // Autosave (quiet) runs while the researcher may still be typing: it must not disable fields
  // (a disabled input drops focus), must not move focus to an invalid field, and must not
  // overwrite edits made while the request was in flight.
  const performSave = async (quiet = false) => {
    if (!flow || !version) return false;
    if (config && !selectedTest) {
      setError(new Error('Add the configured method before saving the flow.'));
      return false;
    }
    if (config) {
      const errs = configurationErrors(config);
      setConfigErrors(errs);
      if (Object.keys(errs).length) {
        setError(new Error('Correct the method fields before saving.'));
        if (!quiet)
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
          );
        return false;
      }
    }
    const sent = { flow, config, title, description };
    if (!quiet) setBusy(true);
    setSaveState('Saving');
    setError(undefined);
    setNodeErrors({});
    try {
      const inventory = tests.map((t) => ({
        id: t.id,
        test_type_id: t.test_type_id,
        configuration: t.id === selectedTest?.id && config ? config : t.configuration,
      }));
      let savedFlow = structuredClone(flow);
      if (config && selectedTest && savedFlow.method_text?.[selectedTest.id]) {
        savedFlow.method_text[selectedTest.id] = Object.fromEntries(
          Object.entries(methodTextFields(config)).map(([pointer, text]) => [
            pointer,
            {
              ...savedFlow.method_text?.[selectedTest.id]?.[pointer],
              [flow.default_language]: text,
            },
          ]),
        );
      }
      const ver = await client.saveDraft(s, v, {
        title,
        description,
        form: savedFlow,
        tests: inventory,
        revision_hash: version.revision_hash,
      });
      setVersion(ver);
      setTests(await client.tests(s, v));
      const now = latest.current;
      if (
        quiet &&
        (now.flow !== sent.flow ||
          now.config !== sent.config ||
          now.title !== sent.title ||
          now.description !== sent.description)
      ) {
        // Edited during the request: keep the local edits and save them next.
        setSaveState('Not saved');
        setSaveTick((n) => n + 1);
        return true;
      }
      setFlow(ver.form?.schema_version === 2 ? ver.form : flow);
      setSaveState('Saved');
      setDirty(false);
      setNotice('Saved');
      return true;
    } catch (e) {
      setError(e);
      setSaveState('Not saved');
      if (e instanceof ApiError && e.fieldErrors.length) {
        const localErrors: Record<string, string> = {};
        for (const field of e.fieldErrors) {
          const index = field.path.lastIndexOf('data');
          if (index >= 0)
            localErrors[
              field.path
                .slice(index + 1)
                .filter((p) => p !== flow.default_language)
                .join('.')
            ] = field.message;
          else if (field.path.includes('title')) localErrors.title = field.message;
        }
        setNodeErrors(localErrors);
        setConfigErrors(
          Object.fromEntries(
            e.fieldErrors.map((f) => [
              f.path.slice(f.path.indexOf('configuration') + 1).join('.'),
              f.message,
            ]),
          ),
        );
        if (!quiet)
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
          );
      }
      return false;
    } finally {
      if (!quiet) setBusy(false);
    }
  };
  const save = (quiet = false) => {
    if (saving.current) return saving.current;
    const pending = performSave(quiet);
    saving.current = pending;
    void pending.finally(() => {
      saving.current = null;
    });
    return pending;
  };
  useEffect(() => {
    if (!flow || !version || busy || readOnly) return;
    const buffer: Buffer = {
      flow: structuredClone(flow),
      tests: structuredClone(
        tests.map((t) =>
          t.id === selectedTest?.id && config ? { ...t, configuration: config } : t,
        ),
      ),
      title,
      description,
    };
    if (applying.current) {
      applying.current = false;
      return;
    }
    if (JSON.stringify(history.current[cursor.current]) === JSON.stringify(buffer)) return;
    history.current = [...history.current.slice(0, cursor.current + 1), buffer].slice(-100);
    cursor.current = history.current.length - 1;
    setHistoryTick((n) => n + 1);
  }, [flow, tests, title, description, config, busy, readOnly]);
  const undo = (direction: number) => {
    const next = cursor.current + direction,
      buffer = history.current[next];
    if (!buffer || readOnly || busy) return;
    cursor.current = next;
    applying.current = true;
    setFlow(structuredClone(buffer.flow));
    setTests(structuredClone(buffer.tests));
    setTitle(buffer.title);
    setDescription(buffer.description);
    setConfig(
      buffer.tests.find((t) => t.id === selectedTest?.id)?.configuration as
        Configuration | undefined,
    );
    setDirty(true);
    setSaveState('Not saved');
    setError(undefined);
    setReview(undefined);
    setAck(false);
    setWarningCodes([]);
    setHistoryTick((n) => n + 1);
  };
  useEffect(() => {
    if (!dirty || busy || readOnly || error || (config && !selectedTest)) return;
    const timer = setTimeout(() => {
      void save(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, flow, config, title, description, busy, error, readOnly, saveTick]);
  const addMethod = async (id: string = newMethodId) => {
    if (!version || !flow) return;
    const chosen = methods.find((m) => m.id === id);
    if (!chosen) return;
    creatingMethod.current = true;
    methodAnchor.current = selected?.id;
    navigate(base + '/flow');
    setMethod(chosen);
    setBusy(true);
    setError(undefined);
    try {
      const configuration: Configuration =
        chosen.id === 'hedonic-9-v1'
          ? {
              instructions: '',
              questions: [{ id: 'overall_liking', prompt: '', required: true }],
              scale_labels: chosen.default_scale_labels!,
              allow_skips: false,
            }
          : defaultConfiguration(chosen.id, setLevelMethods.has(chosen.id) ? samples : []);
      // A valid method is created only after researcher supplies text in the schema editor.
      setConfig(configuration);
      setDirty(true);
      setNotice('Configure the new method, then Add configured method.');
    } finally {
      setBusy(false);
    }
  };
  const commitNewMethod = async () => {
    if (!config || !version || !flow) return;
    const errs = configurationErrors(config);
    setConfigErrors(errs);
    if (Object.keys(errs).length) {
      setError(new Error('Correct the method fields before adding.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const test = await client.saveTest(s, {
        test_type_id: method!.id,
        configuration: config,
        revision_hash: version.revision_hash,
      });
      const ver = await client.version(s, v);
      setVersion(ver);
      setTests([...tests, test]);
      const lang = flow.default_language;
      const node: Flow['nodes'][number] = {
        id: crypto.randomUUID(),
        kind: 'embedded_method',
        title: { [lang]: method!.name },
        data: {
          study_test_id: test.id,
          sample_binding: setLevelMethods.has(method!.id) ? 'set' : 'none',
        },
      };
      const placed = insertNear(flow.nodes, node, methodAnchor.current);
      changed({
        ...flow,
        nodes: flow.nodes.some((n) => n.kind === 'end')
          ? placed
          : [
              ...placed,
              {
                id: crypto.randomUUID(),
                kind: 'end' as const,
                title: { [lang]: 'Finish' },
                data: {
                  body: { [lang]: 'Thank you for participating.' },
                  outcome: 'completed' as const,
                },
              },
            ],
      });
      setConfig(undefined);
      creatingMethod.current = false;
      setNotice('Method added. Save flow.');
      openNode(node.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const selectNode = (id: string) => {
    const hasMethodEdits =
      config &&
      (!selectedTest || JSON.stringify(config) !== JSON.stringify(selectedTest.configuration));
    if (hasMethodEdits) {
      navigate(base + '/flow/' + id);
      return;
    }
    openNode(id);
  };
  const openNode = (id: string) => {
    // Node fields are already in the whole-flow buffer; selection preserves that buffer.
    setNavigationGuard(undefined);
    navigate(base + '/flow' + (id ? '/' + id : ''));
    setNavigationGuard((href) => {
      if (!dirty) return true;
      setDestination(href);
      return false;
    });
  };
  const insertNode = (node: Node) => {
    if (!flow) return;
    const nodes = insertNear(flow.nodes, node, selected?.id);
    changed({ ...flow, nodes });
    selectNode(node.id);
  };
  const addNode = (kind: (typeof nodeKinds)[number]) => {
    if (flow) insertNode(newNode(kind, flow.default_language));
  };
  const moveNode = (id: string, direction: -1 | 1) => {
    if (!flow) return;
    changed({
      ...flow,
      nodes: siblingEdit(flow.nodes, id, (nodes, i) => {
        if (nodes[i + direction])
          [nodes[i], nodes[i + direction]] = [nodes[i + direction], nodes[i]];
        return nodes;
      }),
    });
  };
  const dropNode = (id: string, targetId: string, position: 'before' | 'after' | 'inside') => {
    if (!flow) return;
    const nodes = moveNodeTo(flow.nodes, id, targetId, position);
    if (!nodes) return;
    changed({ ...flow, nodes });
    releaseLoopSamples(nodes, id);
  };
  /**
   * An attribute test moved into a sample loop takes the loop's samples. A list of its own would
   * only restrict them (and must cover them), so it is cleared and the researcher is told.
   */
  const releaseLoopSamples = (nodes: Node[], movedId: string) => {
    const inLoops = new Set(methodTestsInLoops(nodes, movedId));
    const fixed = tests.filter(
      (t) =>
        inLoops.has(t.id) &&
        !setLevelMethods.has(t.test_type_id) &&
        'sample_ids' in t.configuration &&
        !!t.configuration.sample_ids?.length,
    );
    if (!fixed.length) return;
    const cleared = (t: Test) =>
      fixed.some((f) => f.id === t.id)
        ? ({ ...t, configuration: { ...t.configuration, sample_ids: [] } } as Test)
        : t;
    setTests(tests.map(cleared));
    if (config && selectedTest && fixed.some((f) => f.id === selectedTest.id))
      setConfig({ ...config, sample_ids: [] } as Configuration);
    setNotice(
      fixed.length === 1
        ? 'This test now uses the samples of the loop it is in.'
        : fixed.length + ' tests now use the samples of the loop they are in.',
    );
  };
  const nestNode = (out = false) => {
    if (!flow || !selected) return;
    if (!out) {
      const nodes = siblingEdit(flow.nodes, selected.id, (nodes, i) => {
        const previous = nodes[i - 1];
        if (previous?.kind !== 'group' && previous?.kind !== 'loop_samples') return nodes;
        nodes[i - 1] = {
          ...previous,
          data: { ...previous.data, children: [...previous.data.children, nodes[i]] },
        } as Node;
        nodes.splice(i, 1);
        return nodes;
      });
      changed({ ...flow, nodes });
      releaseLoopSamples(nodes, selected.id);
    } else {
      const parentId = selectedEntry?.ancestors.at(-1);
      if (!parentId) return;
      changed({
        ...flow,
        nodes: siblingEdit(flow.nodes, parentId, (nodes, i) => {
          const parent = nodes[i];
          if (parent.kind !== 'group' && parent.kind !== 'loop_samples') return nodes;
          nodes[i] = {
            ...parent,
            data: {
              ...parent.data,
              children: parent.data.children.filter((n) => n.id !== selected.id),
            },
          } as Node;
          nodes.splice(i + 1, 0, selected);
          return nodes;
        }),
      });
    }
  };
  const duplicateNode = async () => {
    if (!flow || !selected || !version) return;
    setBusy(true);
    setError(undefined);
    try {
      const cloned = cloneNode(selected),
        subtree = outline([cloned]);
      let ver = version;
      const inventory = [...tests];
      for (const entry of subtree) {
        const node = entry.node;
        if (node.kind === 'embedded_method') {
          const original = tests.find((t) => t.id === node.data.study_test_id)!;
          const test = await client.saveTest(s, {
            test_type_id: original.test_type_id,
            configuration: original.configuration,
            revision_hash: ver.revision_hash,
          });
          node.data.study_test_id = test.id;
          inventory.push(test);
          ver = await client.version(s, v);
        }
      }
      cloned.title = {
        ...cloned.title,
        [flow.default_language]: 'Copy of ' + cloned.title[flow.default_language],
      };
      setTests(inventory);
      setVersion(ver);
      changed({
        ...flow,
        nodes: siblingEdit(flow.nodes, selected.id, (nodes, i) => {
          nodes.splice(i + 1, 0, cloned);
          return nodes;
        }),
      });
      selectNode(cloned.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const deleteNode = async () => {
    if (!flow || !selected || !version) return;
    const methodIds = outline([selected]).flatMap((e) =>
      e.node.kind === 'embedded_method' ? [e.node.data.study_test_id] : [],
    );
    const next = structuredClone(flow);
    next.nodes = siblingEdit(next.nodes, selected.id, (nodes, i) => {
      nodes.splice(i, 1);
      return nodes;
    });
    for (const id of methodIds) delete next.method_text?.[id];
    changed(next);
    setTests(tests.filter((t) => !methodIds.includes(t.id)));
    setConfig(undefined);
    setConfirmDelete(false);
    setNavigationGuard(undefined);
    navigate(base + '/flow');
  };
  const newVersion = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const study = await client.study(s);
      const draft = study.versions.find((ver) => !ver.published_at);
      const next = draft ?? (await client.createDraft(s, !!legacy || !version?.form));
      navigate(workspace(s, next.id) + '/flow');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const formEditor = (
    <div className="ui-stack">
      <Toolbar
        label="Flow actions"
        secondary={
          <>
            <Button
              disabled={busy || legacy}
              onClick={() => {
                setBlockPanel(false);
                setFilePanel(true);
              }}
            >
              Save or load questions
            </Button>
            <Button
              data-flow-check-trigger
              disabled={busy || legacy}
              onClick={async () => {
                if (!dirty || (await save())) {
                  setNavigationGuard(undefined);
                  navigate(base + '/flow?panel=check');
                }
              }}
            >
              Check study
            </Button>
          </>
        }
      >
        <StepMenu
          methods={methods.filter(available)}
          disabled={busy || readOnly || (!!config && !selectedTest)}
          onMethod={(id) => {
            setNewMethodId(id);
            void addMethod(id);
          }}
          onKind={addNode}
          onBlock={() => {
            setFilePanel(false);
            setBlockPanel(true);
          }}
        />
        <Button disabled={busy || readOnly || !dirty} onClick={() => void save()}>
          Save flow
        </Button>
        <Button disabled={busy || !dirty} onClick={() => void load()}>
          Discard
        </Button>
      </Toolbar>
      <div className="ui-split">
        <div className="ui-split-main ui-stack">
          {flow && (
            <OutlineTable
              rows={entries.map((e) => {
                const n = e.node;
                const siblings = e.ancestors.length
                  ? entries.find((p) => p.node.id === e.ancestors.at(-1))?.node
                  : undefined;
                const nodes =
                  siblings?.kind === 'group' || siblings?.kind === 'loop_samples'
                    ? siblings.data.children
                    : flow.nodes;
                const i = nodes.findIndex((p) => p.id === n.id);
                const target =
                  n.otherwise && 'target_id' in n.otherwise
                    ? entries.find(
                        (p) => p.node.id === (n.otherwise as { target_id: string }).target_id,
                      )
                    : undefined;
                return {
                  id: n.id,
                  title: n.title[flow.default_language] ?? '',
                  kind: kindLabel(n.kind),
                  method:
                    n.kind === 'embedded_method'
                      ? (() => {
                          const id = tests.find((t) => t.id === n.data.study_test_id)?.test_type_id;
                          return methods.find((m) => m.id === id)?.name ?? id ?? 'Missing';
                        })()
                      : '—',
                  version: n.kind === 'embedded_method' ? '1' : '—',
                  state: readOnly ? 'Published' : 'Draft',
                  guard: conditionText(n.guard, flow, tests),
                  otherwise:
                    (n.otherwise?.action ?? 'continue') +
                    (target
                      ? ' → ' + target.number + ' ' + target.node.title[flow.default_language]
                      : ''),
                  number: e.number,
                  depth: e.ancestors.length,
                  ancestors: e.ancestors,
                  container: n.kind === 'group' || n.kind === 'loop_samples',
                  canMoveUp: i > 0,
                  canMoveDown: i < nodes.length - 1,
                };
              })}
              readOnly={readOnly || busy}
              selectedId={selected?.id}
              targetId={
                selected?.otherwise && 'target_id' in selected.otherwise
                  ? selected.otherwise.target_id
                  : undefined
              }
              onSelect={selectNode}
              onMove={moveNode}
              onDrop={dropNode}
              canDrop={(id, targetId, position) =>
                moveNodeTo(flow.nodes, id, targetId, position) !== undefined
              }
            />
          )}
          {nodeId && !selected && !busy && (
            <p role="alert">
              Node not found in this version. <Link href={base + '/flow'}>Return to flow</Link>
            </p>
          )}
        </div>
        <div className="ui-split-side">
          {!selected && !config && !blockPanel && !filePanel && (
            <p className="ui-hint">
              Select a step to edit it here, or use Add step. Sensory methods open their settings
              here as soon as you add them.
            </p>
          )}
          {blockPanel && flow && (
            <QuestionnaireBlocks
              client={client}
              target={flow}
              onClose={() => setBlockPanel(false)}
              onInsert={(node) => {
                setBlockPanel(false);
                insertNode(node);
              }}
            />
          )}
          {filePanel && flow && (
            <QuestionnaireFile
              flow={flow}
              selectedId={selected?.id}
              bank={{
                items: bankItems,
                busy: bankBusy,
                error: bankError,
                onSave: async (item) => {
                  await client.saveQuestionnaireItem(item);
                  await loadBank();
                },
                onArchive: async (id) => {
                  await client.archiveQuestionnaireItem(id);
                  await loadBank();
                },
              }}
              readOnly={readOnly}
              onClose={() => setFilePanel(false)}
              onInsert={(added) => {
                setFilePanel(false);
                changed({ ...flow, nodes: insertNodes(flow.nodes, added, selected?.id) });
                selectNode(added[0].id);
              }}
            />
          )}
          {selected && flow && !blockPanel && !filePanel && (
            <SidePanel title="Step settings" onClose={() => navigate(base + '/flow')}>
              <Tabs
                label="Node text language"
                value={editorLanguage}
                onChange={setEditorLanguage}
                tabs={flow.languages.map((lang) => ({ id: lang, label: lang, content: null }))}
              />
              <PropertyGrid
                sections={[
                  {
                    title: 'Step',
                    defaultOpen: true,
                    children: (
                      <>
                        <Field
                          id="node-title"
                          label="Step title"
                          error={nodeErrors.title}
                          value={selected.title[editorLanguage] ?? ''}
                          disabled={readOnly || busy}
                          onChange={(e) =>
                            changeSelected({
                              ...selected,
                              title: { ...selected.title, [editorLanguage]: e.target.value },
                            })
                          }
                        />
                        <details>
                          <summary>Technical details</summary>
                          <p className="mono">Step ID {selected.id}</p>
                        </details>
                      </>
                    ),
                  },
                ]}
              />
              <PropertyGrid
                sections={[
                  {
                    title: 'Preview as participant',
                    defaultOpen: true,
                    children: (
                      <StepPreview
                        node={selected}
                        tests={tests.map((t) =>
                          t.id === selectedTest?.id && config
                            ? { ...t, configuration: config as typeof t.configuration }
                            : t,
                        )}
                        flow={flow}
                        language={editorLanguage}
                      />
                    ),
                  },
                ]}
              />
              <GuardProperties
                flow={flow}
                node={selected}
                tests={tests}
                disabled={readOnly || busy}
                errors={nodeErrors}
                onChange={changeSelected}
              />
              {selected.kind === 'serve_gate' && selected.data.sample_binding === 'set' && (
                <Field
                  label="Frozen method serving plan"
                  kind="select"
                  value={selected.data.study_test_id ?? ''}
                  disabled={readOnly || busy}
                  options={[
                    { value: '', label: 'Explicit unrestricted samples' },
                    ...tests
                      .filter((t) => setLevelMethods.has(t.test_type_id))
                      .map((t) => ({
                        value: t.id,
                        label: methods.find((m) => m.id === t.test_type_id)?.name ?? t.test_type_id,
                      })),
                  ]}
                  onChange={(e) =>
                    changeSelected({
                      ...selected,
                      data: {
                        ...selected.data,
                        study_test_id: e.target.value || null,
                        sample_ids: [],
                      },
                    })
                  }
                />
              )}
              {selected.kind === 'serve_gate' &&
                selected.data.sample_binding === 'set' &&
                !selected.data.study_test_id && (
                  <DataTable
                    id="serving-set-samples"
                    label="Serving set samples"
                    data={samples}
                    getRowId={(s) => s.id}
                    columns={[
                      { accessorKey: 'code', header: 'Code' },
                      { accessorKey: 'label', header: 'Private label' },
                      {
                        id: 'included',
                        header: 'Included',
                        accessorFn: (s) =>
                          selected.data.sample_ids?.includes(s.id) ? 'Yes' : 'No',
                      },
                    ]}
                    rowActions={(sample) => (
                      <Button
                        compact
                        disabled={readOnly || busy}
                        onClick={() =>
                          changeSelected({
                            ...selected,
                            data: {
                              ...selected.data,
                              sample_ids: selected.data.sample_ids?.includes(sample.id)
                                ? selected.data.sample_ids.filter((id) => id !== sample.id)
                                : [...(selected.data.sample_ids ?? []), sample.id],
                            },
                          })
                        }
                      >
                        {selected.data.sample_ids?.includes(sample.id) ? 'Remove' : 'Include'}
                      </Button>
                    )}
                  />
                )}
              {selected.kind === 'loop_samples' && (
                <LoopProperties
                  node={selected}
                  samples={samples}
                  disabled={readOnly || busy}
                  onChange={changeSelected}
                  onCreate={async (payload) => {
                    const sample = await client.createSample(s, payload);
                    setSamples([...samples, sample]);
                    setVersion(await client.version(s, v));
                    return sample;
                  }}
                />
              )}
              {selected.kind === 'info' && (
                <InfoTextEditor
                  node={selected}
                  language={editorLanguage}
                  disabled={readOnly || busy}
                  inLoop={
                    selectedEntry?.ancestors.some(
                      (a) => entries.find((e) => e.node.id === a)?.node.kind === 'loop_samples',
                    ) ?? false
                  }
                  error={nodeErrors['body']}
                  onChange={changeSelected}
                />
              )}
              {selected.kind !== 'embedded_method' &&
                selected.kind !== 'group' &&
                selected.kind !== 'loop_samples' &&
                (() => {
                  const fields = nodeFields(
                    selected,
                    editorLanguage,
                    selected.kind === 'matrix_question',
                  );
                  return (
                    <SchemaFields
                      help={settingHelp}
                      schema={fields.schema}
                      value={fields.value}
                      errors={nodeErrors}
                      disabled={readOnly || busy}
                      onChange={(data) =>
                        changeSelected(
                          changeAnswerType(selected, {
                            ...selected,
                            data: fields.restore(data),
                          } as Node),
                        )
                      }
                    />
                  );
                })()}
              {selected.kind === 'info' && (
                <AssetEditor
                  assets={assets}
                  ids={selected.data.asset_ids ?? []}
                  languages={flow.languages}
                  language={editorLanguage}
                  disabled={readOnly || busy}
                  uploadDisabled={dirty}
                  onChange={(ids) =>
                    changeSelected({ ...selected, data: { ...selected.data, asset_ids: ids } })
                  }
                  onUpload={async (data) => {
                    const asset = await client.uploadAsset(s, v, {
                      ...data,
                      revision_hash: version!.revision_hash,
                    });
                    setAssets((current) => [...current, asset]);
                    setVersion(await client.version(s, v));
                    setReview(undefined);
                    setAck(false);
                  }}
                />
              )}
              {selected.kind === 'matrix_question' && (
                <QuestionnaireEditor
                  key={selected.id}
                  node={selected}
                  language={editorLanguage}
                  disabled={readOnly || busy}
                  errors={nodeErrors}
                  focusField={(issueField ?? '').replace(/^data\./, '')}
                  onChange={changeSelected}
                />
              )}
              {selected.kind === 'question' && selected.data.answer_type === 'single' && (
                <>
                  <ScaleLayoutField
                    node={selected}
                    disabled={readOnly || busy}
                    onChange={changeSelected}
                  />
                  <ScaleBuilder
                    node={selected}
                    language={editorLanguage}
                    disabled={readOnly || busy}
                    onChange={changeSelected}
                  />
                </>
              )}
              {selected.kind === 'question' && selected.data.answer_type === 'multiple' && (
                <Field
                  label="Restriction source"
                  kind="checkbox"
                  checked={flow.restriction_source_id === selected.id}
                  disabled={readOnly || busy}
                  hint="Requires a required question, no skips, and one exclusive none option."
                  onChange={(e) =>
                    changed({
                      ...flow,
                      restriction_source_id: e.target.checked ? selected.id : null,
                    })
                  }
                />
              )}
              {selected.id === flow.restriction_source_id && selected.kind === 'question' && (
                <PropertyGrid
                  sections={[
                    {
                      title: 'Restriction tag mapping',
                      defaultOpen: true,
                      children: selected.data.options
                        ?.filter((o) => !o.exclusive)
                        .map((o) => (
                          <Field
                            key={o.id}
                            label={'Tags for ' + o.id}
                            value={flow.restriction_tag_map?.[o.id]?.join(', ') ?? ''}
                            disabled={readOnly || busy}
                            hint="Exact ingredient tags, comma-separated."
                            onChange={(e) =>
                              changed({
                                ...flow,
                                restriction_tag_map: {
                                  ...flow.restriction_tag_map,
                                  [o.id]: e.target.value
                                    .split(',')
                                    .map((t) => t.trim())
                                    .filter(Boolean),
                                },
                              })
                            }
                          />
                        )),
                    },
                  ]}
                />
              )}
              {(selected.kind === 'group' || selected.kind === 'loop_samples') &&
                !selected.data.children.length && (
                  <p>Empty group. Add a node while this group is selected.</p>
                )}
              <Toolbar label="Node actions">
                <Button disabled={readOnly || busy || dirty} onClick={() => void duplicateNode()}>
                  Duplicate step
                </Button>
                <Button disabled={readOnly || busy || !canIndent} onClick={() => nestNode()}>
                  Move into group above
                </Button>
                <Button
                  disabled={
                    readOnly ||
                    busy ||
                    (parent?.kind !== 'group' && parent?.kind !== 'loop_samples')
                  }
                  onClick={() => nestNode(true)}
                >
                  Move out of group
                </Button>
                <Button
                  variant="danger"
                  disabled={readOnly || busy || dirty}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete step
                </Button>
              </Toolbar>
              {confirmDelete && (
                <Toolbar label="Confirm step deletion">
                  <p>
                    Delete this draft step and its children? Undo can restore it in this workspace.
                    Publications and answers are unaffected.
                  </p>
                  <Button variant="danger" onClick={() => void deleteNode()}>
                    Confirm delete step
                  </Button>
                  <Button onClick={() => setConfirmDelete(false)}>Cancel deletion</Button>
                </Toolbar>
              )}
              <DataTable
                id="node-references"
                label="Referenced by"
                data={entries
                  .filter(
                    (e) =>
                      e.node.id !== selected.id &&
                      ((JSON.stringify(e.node.guard) ?? '').includes(selected.id) ||
                        (flow.restriction_source_id === selected.id &&
                          (JSON.stringify(e.node.guard) ?? '').includes('assessor.restrictions')) ||
                        (e.node.otherwise &&
                          'target_id' in e.node.otherwise &&
                          e.node.otherwise.target_id === selected.id)),
                  )
                  .map((e) => ({
                    id: e.node.id,
                    number: e.number,
                    title: e.node.title[flow.default_language],
                    field:
                      e.node.otherwise &&
                      'target_id' in e.node.otherwise &&
                      e.node.otherwise.target_id === selected.id
                        ? 'If condition is not met'
                        : 'Show if',
                  }))}
                columns={[
                  { accessorKey: 'number', header: 'No.' },
                  { accessorKey: 'title', header: 'Title' },
                  { accessorKey: 'field', header: 'Field' },
                ]}
                getRowId={(r) => r.id}
                onActivate={(r) => selectNode(r.id)}
                rowActions={(r) => (
                  <Button variant="quiet" onClick={() => selectNode(r.id)}>
                    Open
                  </Button>
                )}
              />
              {selectedTest && config && method && (
                <MethodTextEditor
                  flow={flow}
                  testId={selectedTest.id}
                  configuration={config}
                  language={editorLanguage}
                  onLanguage={setEditorLanguage}
                  onChange={changed}
                  disabled={readOnly || busy}
                  errors={Object.fromEntries(
                    Object.entries(nodeErrors).filter(([k]) => k.startsWith('/')),
                  )}
                />
              )}
              {selectedTest &&
                config &&
                method &&
                editorLanguage === flow.default_language &&
                ('kind' in config ? (
                  <RegisteredMethodFields
                    onCreateSample={async (payload) => {
                      const sample = await client.createSample(s, payload);
                      setSamples([...samples, sample]);
                      setVersion(await client.version(s, v));
                      return sample;
                    }}
                    method={method}
                    config={config}
                    samples={samples}
                    disabled={readOnly || busy}
                    errors={configErrors}
                    onChange={editConfiguration}
                  />
                ) : (
                  <SchemaFields
                    help={settingHelp}
                    schema={method.configuration_schema}
                    value={config}
                    disabled={readOnly || busy}
                    labels={editorLabels}
                    errors={configErrors}
                    onChange={(v) => editConfiguration(v as Configuration)}
                  />
                ))}
              {selected.kind === 'embedded_method' && config && 'scale_labels' in config && (
                <Field
                  kind="select"
                  label="Scale display"
                  value={selected.data.scale_layout ?? 'vertical'}
                  disabled={readOnly || busy}
                  options={layoutOptions}
                  hint="How the rating scale looks on the tablet. A setting of this step: the method itself and its exports are unchanged, and every option keeps its full text even when only the ends are shown."
                  onChange={(e) =>
                    changeSelected({
                      ...selected,
                      data: { ...selected.data, scale_layout: e.target.value as ScaleLayout },
                    })
                  }
                />
              )}
            </SidePanel>
          )}
          {!selected && config && method && (
            <SidePanel
              title={method.id === 'hedonic-9-v1' ? 'New hedonic method' : 'New ' + method.name}
              onClose={() => {
                creatingMethod.current = false;
                setConfig(undefined);
                setConfigErrors({});
              }}
            >
              {'kind' in config ? (
                <RegisteredMethodFields
                  onCreateSample={async (payload) => {
                    const sample = await client.createSample(s, payload);
                    setSamples([...samples, sample]);
                    setVersion(await client.version(s, v));
                    return sample;
                  }}
                  method={method}
                  config={config}
                  samples={samples}
                  disabled={busy || readOnly}
                  errors={configErrors}
                  onChange={setConfig}
                />
              ) : (
                <SchemaFields
                  help={settingHelp}
                  schema={method.configuration_schema}
                  value={config}
                  labels={editorLabels}
                  errors={configErrors}
                  disabled={busy || readOnly}
                  onChange={(v) => setConfig(v as Configuration)}
                />
              )}
              <Button
                variant="primary"
                disabled={busy || readOnly}
                onClick={() => void commitNewMethod()}
              >
                Add configured method
              </Button>
            </SidePanel>
          )}
        </div>
      </div>
    </div>
  );
  const warnings = [
    ...new Set(review?.issues.filter((i) => i.severity === 'warning').map((i) => i.code) ?? []),
  ];
  const publish = (
    <div className="ui-stack">
      {version && (
        <PublicationSnapshot
          version={version}
          tests={tests}
          samples={samples}
          assets={assets}
          loading={busy}
        />
      )}
      {readOnly && (
        <p>Published at {version?.published_at}. The administered version is read-only.</p>
      )}
      <Button disabled={busy || reviewBusy || legacy} onClick={() => void checkSaved()}>
        Review saved snapshot
      </Button>
      <FlowCheck
        prefix="publish"
        report={review}
        loading={reviewBusy}
        error={reviewError}
        onOpen={openIssue}
        stepName={issueStep}
        onRetry={reviewError ? () => void checkSaved() : undefined}
      />
      {!readOnly && review && (
        <>
          {warnings.map((code) => (
            <Field
              key={code}
              label={'Acknowledge warning: ' + code}
              kind="checkbox"
              checked={warningCodes.includes(code)}
              disabled={busy || dirty || !review.valid}
              onChange={(e) =>
                setWarningCodes(
                  e.target.checked
                    ? [...warningCodes, code]
                    : warningCodes.filter((c) => c !== code),
                )
              }
            />
          ))}
          <Field
            label="Acknowledge freeze"
            kind="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            disabled={!review.valid || busy || dirty}
          />
          <Button
            variant="primary"
            disabled={
              busy ||
              reviewBusy ||
              dirty ||
              !review.valid ||
              !ack ||
              warnings.some((c) => !warningCodes.includes(c))
            }
            onClick={async () => {
              if (saving.current || dirty) {
                await checkSaved();
                return;
              }
              setBusy(true);
              setError(undefined);
              try {
                const ver = await client.publish(s, {
                  study_version_id: v,
                  revision_hash: review.revision_hash,
                  acknowledged_warning_codes: warningCodes,
                });
                setVersion(ver);
                setNotice('Published');
              } catch (e) {
                setError(e);
                if (e instanceof ApiError && e.status === 409) {
                  setReview(undefined);
                  setAck(false);
                  setWarningCodes([]);
                  setReviewError('Draft changed; review the saved snapshot again.');
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Release for collection
          </Button>
        </>
      )}
    </div>
  );
  return (
    <section aria-busy={busy}>
      <Toolbar
        label="Study header"
        secondary={
          version && flow ? (
            <>
              <Button disabled={readOnly || busy || !dirty} onClick={() => void save()}>
                Save draft
              </Button>
              <Button disabled={readOnly || busy || cursor.current < 1} onClick={() => undo(-1)}>
                Undo
              </Button>
              <Button
                disabled={readOnly || busy || cursor.current >= history.current.length - 1}
                onClick={() => undo(1)}
              >
                Redo
              </Button>
              <Button onClick={() => void load()} disabled={busy || dirty}>
                Reload
              </Button>
              <Popover label="Help" align="right">
                <StudyHelp open />
              </Popover>
              <Popover label="More actions" closeOnSelect align="right">
                <Button
                  className="ui-popover-item"
                  disabled={auditBusy}
                  onClick={async () => {
                    setAuditBusy(true);
                    setAuditError('');
                    try {
                      setAuditRows(await client.audit(s, v));
                    } catch (e) {
                      setAuditError(message(e));
                    } finally {
                      setAuditBusy(false);
                    }
                  }}
                >
                  Read draft audit
                </Button>
                {version.published_at && (
                  <>
                    <Button
                      className="ui-popover-item"
                      onClick={() => {
                        setCopyPanel(true);
                        setCopyTitle('Copy of ' + version.title);
                        setCopyAck(false);
                      }}
                    >
                      Duplicate study
                    </Button>
                    <Button
                      className="ui-popover-item"
                      onClick={() => {
                        setTemplatePanel(true);
                        setTemplateName(version.title);
                      }}
                    >
                      Register template
                    </Button>
                  </>
                )}
                <details>
                  <summary>Technical details</summary>
                  <p className="mono">Version ID {v}</p>
                  <Button
                    onClick={() => void navigator.clipboard?.writeText(v).catch(() => undefined)}
                  >
                    Copy version ID
                  </Button>
                </details>
              </Popover>
            </>
          ) : undefined
        }
      >
        <Heading>{version?.title ?? 'Study workspace'}</Heading>
        {version && <StatusText status={version.published_at ? 'published' : 'draft'} />}
        {version && (
          <Field
            label="Version"
            kind="select"
            compact
            value={v}
            onChange={(e) => navigate(workspace(s, e.target.value) + '/details')}
            options={versions.map((ver) => ({
              value: ver.id,
              label:
                'v' +
                ver.version_number +
                ' · ' +
                (ver.published_at || (ver.id === version.id && version.published_at)
                  ? 'Published'
                  : 'Draft'),
            }))}
          />
        )}
        <span role="status" className="ui-hint">
          {saveState}
          {notice ? ' · ' + notice : ''}
          {dirty ? ' · Unsaved changes' : ''}
        </span>
        {version?.published_at && (
          <Button disabled={busy} onClick={() => void newVersion()}>
            {versions.some((ver) => ver.id !== v && !ver.published_at)
              ? 'Open draft'
              : legacy
                ? 'Revise study and convert legacy flow'
                : 'Revise study'}
          </Button>
        )}
      </Toolbar>
      {version && flow && (
        <StudyChecklist
          details={false}
          version={version}
          dirty={dirty}
          report={review}
          onNext={async (target) => {
            if (!dirty || (await save())) {
              setNavigationGuard(undefined);
              navigate(base + '/' + target);
            }
          }}
        />
      )}
      {auditBusy && <p role="status">Loading draft audit…</p>}
      {auditError && <p role="alert">{auditError}</p>}
      {auditRows && (
        <PropertyGrid
          sections={[
            {
              title: 'Draft audit',
              defaultOpen: true,
              children: (
                <DataTable
                  id="draft-audit"
                  label="Draft audit"
                  data={auditRows}
                  getRowId={(r) => r.id}
                  columns={[
                    { accessorKey: 'action', header: 'Action' },
                    { accessorKey: 'principal', header: 'Credential principal' },
                    { accessorKey: 'revision_hash', header: 'Saved revision' },
                    { accessorKey: 'recorded_at', header: 'Recorded' },
                  ]}
                  emptyText="No draft changes recorded for this historical version."
                />
              ),
            },
          ]}
        />
      )}
      {copyPanel && version && (
        <SidePanel title="Duplicate published study" onClose={() => setCopyPanel(false)}>
          <Field
            label="New study title"
            value={copyTitle}
            onChange={(e) => setCopyTitle(e.target.value)}
          />
          <Field
            label="Review wording, restrictions, sample codes and translations before release"
            kind="checkbox"
            checked={copyAck}
            onChange={(e) => setCopyAck(e.target.checked)}
          />
          <Button
            disabled={busy || !copyTitle.trim() || !copyAck}
            onClick={async () => {
              setBusy(true);
              try {
                const copy = await client.duplicate({
                  title: copyTitle,
                  description: version.description,
                  source_version_id: v,
                  reviewed_content: true,
                });
                setNavigationGuard(undefined);
                navigate(workspace(copy.id, copy.versions[0].id) + '/flow');
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create duplicate
          </Button>
        </SidePanel>
      )}
      {templatePanel && version && (
        <SidePanel title="Register reviewed template" onClose={() => setTemplatePanel(false)}>
          <Field
            label="Template name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />
          <Field
            label="Template review notes"
            kind="textarea"
            value={templateNotes}
            onChange={(e) => setTemplateNotes(e.target.value)}
            hint="Record methodology review and what must be reviewed in each copy: wording, restrictions, codes and translations."
          />
          <Button
            disabled={busy || !templateName.trim() || !templateNotes.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await client.registerTemplate({
                  source_version_id: v,
                  name: templateName,
                  review_notes: templateNotes,
                });
                setTemplatePanel(false);
                setNotice('Template registered');
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm template registration
          </Button>
        </SidePanel>
      )}
      <ErrorNotice error={error} retry={error && !dirty ? () => void load() : undefined} />
      {error instanceof ApiError && error.status === 409 && dirty && (
        <PropertyGrid
          sections={[
            {
              title: 'Compare conflicting draft',
              defaultOpen: true,
              children: (
                <>
                  <p>
                    Local edits are retained. Reload discards them and reads the current server
                    draft. Review before copying edits back.
                  </p>
                  <Button
                    onClick={async () => {
                      try {
                        const remote = await client.version(s, v);
                        setServerComparison(remote);
                        setNotice(
                          'Server title: ' +
                            remote.title +
                            ' · description: ' +
                            remote.description +
                            ' · verification ID: ' +
                            remote.revision_hash,
                        );
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Read server revision for comparison
                  </Button>
                  <Button onClick={() => void load()}>Reload and discard local edits</Button>
                </>
              ),
            },
          ]}
        />
      )}
      {serverComparison && dirty && (
        <DataTable
          id="draft-comparison"
          label="Local and server draft comparison"
          data={[
            { id: 'title', local: title, server: serverComparison.title },
            { id: 'description', local: description, server: serverComparison.description },
            {
              id: 'sequence',
              local: JSON.stringify(flow),
              server: JSON.stringify(serverComparison.form),
            },
          ]}
          getRowId={(r) => r.id}
          columns={[
            { accessorKey: 'id', header: 'Field' },
            { accessorKey: 'local', header: 'Retained local edit' },
            { accessorKey: 'server', header: 'Server value' },
          ]}
        />
      )}
      {archivedAt && (
        <p role="status">
          This study is archived and read-only. Restore it from the Archive list to edit it or start
          assessments.
        </p>
      )}
      {busy && <p role="status">Loading / saving…</p>}
      {destination && (
        <Toolbar label="Unsaved navigation">
          <p>Unsaved changes</p>
          <Button
            onClick={async () => {
              if (await save()) {
                const href = destination;
                setDestination(undefined);
                setNavigationGuard(undefined);
                navigate(href);
              }
            }}
          >
            Save and continue
          </Button>
          <Button
            onClick={async () => {
              const href = destination;
              if (await load()) {
                setDestination(undefined);
                setNavigationGuard(undefined);
                navigate(href);
              }
            }}
          >
            Discard and continue
          </Button>
          <Button onClick={() => setDestination(undefined)}>Keep editing</Button>
        </Toolbar>
      )}
      {!version && busy && tab === 'flow' && (
        <OutlineTable rows={[]} onSelect={() => {}} readOnly />
      )}
      {version && flow && (
        <Tabs
          label="Study workspace"
          value={tab}
          onChange={(id) => navigate(base + '/' + id)}
          tabs={[
            {
              id: 'details',
              label: 'Details',
              content: (
                <div className="ui-stack">
                  <PropertyGrid
                    sections={[
                      {
                        title: 'Version metadata',
                        defaultOpen: true,
                        children: (
                          <>
                            <Field
                              label="Title"
                              value={title}
                              disabled={readOnly || busy}
                              onChange={(e) => {
                                setTitle(e.target.value);
                                setError(undefined);
                                setSaveState('Not saved');
                                setReview(undefined);
                                setAck(false);
                                setDirty(true);
                              }}
                            />
                            <Field
                              label="Description"
                              kind="textarea"
                              value={description}
                              disabled={readOnly || busy}
                              onChange={(e) => {
                                setDescription(e.target.value);
                                setError(undefined);
                                setSaveState('Not saved');
                                setReview(undefined);
                                setAck(false);
                                setDirty(true);
                              }}
                            />
                            <Field
                              label="Declared languages"
                              value={flow.languages.join(', ')}
                              disabled
                              onChange={() => {}}
                            />
                            <Field
                              label="New language"
                              value={languageInput}
                              disabled={readOnly || busy}
                              onChange={(e) => setLanguageInput(e.target.value)}
                              hint="Language code, e.g. sv. Added text remains unreviewed until filled."
                            />
                            <Button
                              disabled={
                                readOnly ||
                                busy ||
                                flow.languages.length >= 10 ||
                                !/^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/.test(languageInput) ||
                                flow.languages.includes(languageInput)
                              }
                              onClick={() => {
                                changed({ ...flow, languages: [...flow.languages, languageInput] });
                                setLanguageInput('');
                              }}
                            >
                              Add language
                            </Button>
                            <Field
                              label="Default language"
                              kind="select"
                              value={flow.default_language}
                              options={flow.languages.map((value) => ({ value, label: value }))}
                              disabled={readOnly || busy}
                              onChange={(e) =>
                                changed({ ...flow, default_language: e.target.value })
                              }
                              hint="Changing default requires complete reviewed method text; the save replaces default strings atomically."
                            />
                            {flow.languages
                              .filter((lang) => lang !== flow.default_language)
                              .map((lang) => (
                                <Button
                                  key={lang}
                                  disabled={readOnly || busy}
                                  onClick={() => {
                                    changed(removeLanguage(flow, lang));
                                    setEditorLanguage(flow.default_language);
                                  }}
                                >
                                  Remove language {lang}
                                </Button>
                              ))}
                          </>
                        ),
                      },
                    ]}
                  />
                  <Button disabled={busy || readOnly || !dirty} onClick={() => void save()}>
                    Save details
                  </Button>
                </div>
              ),
            },
            {
              id: 'flow',
              label: 'Study sequence',
              content:
                panel === 'check' ? (
                  <SidePanel
                    title="Check study"
                    onClose={() => {
                      navigate(base + '/flow');
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLButtonElement>('[data-flow-check-trigger]')
                          ?.focus(),
                      );
                    }}
                  >
                    <FlowCheck
                      report={review}
                      loading={reviewBusy}
                      error={reviewError}
                      onRetry={() => void checkSaved()}
                      onOpen={openIssue}
                      stepName={issueStep}
                    />
                  </SidePanel>
                ) : (
                  formEditor
                ),
            },
            ...(['samples', 'design', 'blinding'] as const).map((id) => ({
              id,
              label: id[0].toUpperCase() + id.slice(1),
              content: (
                <SamplesDesign
                  key={id + v}
                  client={client}
                  studyId={s}
                  version={version}
                  samples={samples}
                  tests={tests}
                  tab={id}
                  active={tab === id}
                  blocked={dirty || busy}
                  onChanged={load}
                />
              ),
            })),
            {
              id: 'preview',
              label: 'Preview',
              content:
                version.form?.schema_version === 2 ? (
                  <AssetScope assets={assets} flow={version.form} load={loadAsset}>
                    <LinearPreview
                      key={version.revision_hash}
                      flow={version.form}
                      tests={tests}
                      samples={samples}
                    />
                  </AssetScope>
                ) : (
                  <p>
                    Save a flow first. <Link href={base + '/flow'}>Open Flow</Link>
                  </p>
                ),
            },
            { id: 'publish', label: 'Release', content: publish },
            {
              id: 'sessions',
              label: 'Assessments',
              content: <Sessions key={v} client={client} studyId={s} version={version} />,
            },
            {
              id: 'data',
              label: 'Results',
              content: (
                <Data
                  key={v}
                  client={client}
                  studyId={s}
                  version={version}
                  active={tab === 'data'}
                />
              ),
            },
            {
              id: 'analyses',
              label: 'Analyses',
              content: (
                <Analyses
                  key={v}
                  client={client}
                  studyId={s}
                  version={version}
                  active={tab === 'analyses'}
                />
              ),
            },
          ]}
        />
      )}
      {version?.form?.schema_version === 1 && (
        <p>
          Legacy Form v1 publication is preserved. Create a new version with explicit conversion to
          author it as Flow v2. Existing v1 drafts remain available through the legacy API.
        </p>
      )}
    </section>
  );
}
