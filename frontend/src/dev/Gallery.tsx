import { SnapshotsGallery } from './SnapshotsGallery';
import { AnalysesGallery } from './AnalysesGallery';
import { WideExportGallery } from './WideExportGallery';
import { AssetsGallery } from './AssetsGallery';
import { TemporalGallery } from './TemporalGallery';
import { MethodsGallery } from './MethodsGallery';
import { QuestionnaireGallery } from './QuestionnaireGallery';
import { RoomsGallery } from './RoomsGallery';
import { OperationsGallery } from './OperationsGallery';
import { SamplesDesignGallery } from './SamplesDesignGallery';
import { UsabilityGallery } from './UsabilityGallery';
import { TerminalsGallery } from './TerminalsGallery';
import { RunStudyGallery } from './RunStudyGallery';
import { StudyLifecycleGallery } from './StudyLifecycleGallery';
import { DataGallery } from './DataGallery';
import { SessionsGallery } from './SessionsGallery';
import { FlowCheckGallery } from './FlowCheckGallery';
import { SampleLoopGallery } from './SampleLoopGallery';
import { GuardsGallery } from './GuardsGallery';
import { FoundationGallery } from './FoundationGallery';
import { useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ExternalLink, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  AppShell,
  Button,
  DataTable,
  Dialog,
  Field,
  PropertyGrid,
  SidePanel,
  StatusText,
  Tabs,
  Toolbar,
  type Status,
} from '../ui';
import {
  designSets,
  testTypes,
  virtualSets,
  type DesignSetFixture,
  type TestTypeFixture,
} from './fixtures';

const methodColumns: ColumnDef<TestTypeFixture>[] = [
  { accessorKey: 'key', header: 'Key' },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'version', header: 'Schema v.' },
  { accessorKey: 'implementation', header: 'Implementation' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusText status={row.original.status} />,
  },
  {
    accessorKey: 'reference',
    header: 'Ref.',
    enableSorting: false,
    cell: ({ row }) => (
      <a
        className="ui-reference"
        href="#fixture-reference"
        aria-label={`Reference for ${row.original.name}`}
        title={row.original.reference}
      >
        <ExternalLink aria-hidden="true" />
      </a>
    ),
  },
];
const setColumns: ColumnDef<DesignSetFixture>[] = [
  { accessorKey: 'set', header: 'Set' },
  { accessorKey: 'set_code', header: 'Set code' },
  { accessorKey: 'sequence', header: 'Sequence no.' },
  { accessorKey: 'product', header: 'Product no.' },
  { accessorKey: 'blinding_code', header: 'Blinding code' },
];
const sections = [
  ['test-types', 'Test-types table'],
  ['controls', 'Buttons & toolbar'],
  ['properties', 'Fields & property grid'],
  ['statuses', 'Status text & tabs'],
  ['design-sets', 'Design sets'],
  ['table-states', 'Empty & virtual tables'],
  ['dialogs', 'Dialogs & side panel'],
  ['foundation', 'Flow foundation'],
  ['guards', 'Guards and Otherwise'],
  ['sample-loop', 'Fixed sample loop'],
  ['flow-check', 'Check study'],
  ['sessions', 'Sessions and offline'],
  ['terminals', 'Laboratory terminals'],
  ['run-study', 'Run study'],
  ['study-lifecycle', 'Study lifecycle'],
  ['usability', 'Study usability'],
  ['samples-design', 'Samples and design'],
  ['operations', 'Operator and serving'],
  ['rooms-gallery', 'Room layouts'],
  ['v2-methods', 'Registered methods'],
  ['questionnaire-gallery', 'Questionnaire blocks'],
  ['assets-gallery', 'Assets'],
  ['temporal-gallery', 'Temporal methods'],
  ['data', 'Data'],
  ['wide-export-gallery', 'Wide export'],
  ['snapshots-gallery', 'Snapshots and analysis'],
  ['analyses-gallery', 'Analyses (add-on)'],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="ui-gallery-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}

function QuestionProperties() {
  const [question, setQuestion] = useState('How intense is the oat aroma?');
  const [type, setType] = useState('line');
  const [mandatory, setMandatory] = useState(true);
  const [left, setLeft] = useState('0');
  const [right, setRight] = useState('100');
  const [leftAnchor, setLeftAnchor] = useState('Not perceptible');
  const [rightAnchor, setRightAnchor] = useState('Very intense');
  const [defaultValue, setDefaultValue] = useState('');
  const [extra, setExtra] = useState('Assess aroma before tasting.');
  const [code, setCode] = useState('aroma_intensity');
  const [showValue, setShowValue] = useState(false);
  const [invalid, setInvalid] = useState('101');
  return (
    <PropertyGrid
      sections={[
        {
          title: 'Standard settings',
          defaultOpen: true,
          children: (
            <>
              <Field
                label="Question text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                required
              />
              <Field
                kind="select"
                label="Type"
                value={type}
                onChange={(event) => setType(event.target.value)}
                options={[
                  { value: 'line', label: 'Line scale' },
                  { value: 'numeric', label: 'Numeric scale' },
                ]}
              />
              <Field
                kind="toggle"
                label="Mandatory"
                checked={mandatory}
                onChange={(event) => setMandatory(event.target.checked)}
              />
              <Field
                kind="number"
                label="Left value"
                value={left}
                onChange={(event) => setLeft(event.target.value)}
              />
              <Field
                kind="number"
                label="Right value"
                value={right}
                onChange={(event) => setRight(event.target.value)}
              />
              <Field
                label="Left anchor label"
                value={leftAnchor}
                onChange={(event) => setLeftAnchor(event.target.value)}
              />
              <Field
                label="Right anchor label"
                value={rightAnchor}
                onChange={(event) => setRightAnchor(event.target.value)}
              />
              <Field
                kind="number"
                label="Default"
                value={defaultValue}
                onChange={(event) => setDefaultValue(event.target.value)}
                hint="Empty means no preset response; zero is a numeric value."
              />
              <Field
                kind="textarea"
                label="Extra info"
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
              />
            </>
          ),
        },
        {
          title: 'Advanced settings',
          children: (
            <>
              <Field
                label="Question key"
                mono
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Field
                kind="checkbox"
                label="Show numeric value"
                checked={showValue}
                onChange={(event) => setShowValue(event.target.checked)}
              />
              <Field
                label="Published key"
                mono
                value="aroma_intensity_v1"
                onChange={() => {}}
                disabled
                hint="Disabled field example."
              />
              <Field
                kind="number"
                label="Error example"
                value={invalid}
                onChange={(event) => setInvalid(event.target.value)}
                error="Enter a value between 0 and 100."
              />
            </>
          ),
        },
      ]}
    />
  );
}

export function Gallery() {
  const [activeSection, setActiveSection] = useState('test-types');
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState('configuration');
  const [dialog, setDialog] = useState<'destructive' | 'generate' | null>(null);
  const [count, setCount] = useState('60');
  const [notice, setNotice] = useState<ReactNode>('Gallery fixtures · no server writes');
  const [selected, setSelected] = useState<TestTypeFixture | null>(null);
  function showMethod(row: TestTypeFixture) {
    setSelected(row);
    setPanel(true);
    setNotice(
      <>
        Selected fixture: <span className="mono">{row.key}</span>
      </>,
    );
  }
  return (
    <AppShell
      breadcrumbs={[{ label: 'Development', href: '/dev/ui' }, { label: 'UI gallery' }]}
      navigation={
        <div className="ui-stack">
          {sections.map(([id, label]) => (
            <Button
              key={id}
              variant="quiet"
              aria-current={activeSection === id ? 'page' : undefined}
              onClick={() => {
                setActiveSection(id);
                document.getElementById(id)?.scrollIntoView({ block: 'start' });
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      }
      properties={
        panel ? (
          <SidePanel title="Properties" onClose={() => setPanel(false)}>
            <div className="ui-stack">
              {selected && <p className="mono">{selected.key}</p>}
              <QuestionProperties />
            </div>
          </SidePanel>
        ) : undefined
      }
    >
      <Toolbar
        label="Gallery actions"
        secondary={
          <Button
            onClick={() => {
              setSelected(null);
              setPanel(!panel);
            }}
          >
            {panel ? 'Hide properties' : 'Show properties'}
          </Button>
        }
      >
        <h1>UI gallery</h1>
        <span className="ui-hint" role="status">
          {notice}
        </span>
      </Toolbar>
      <Section id="test-types" title="DataTable · test types (fixtures)">
        <DataTable
          id="test-types-table"
          label="Test types"
          data={testTypes}
          columns={methodColumns}
          getRowId={(row) => row.key}
          selectable
          initialSelection={{ cata: true }}
          onActivate={showMethod}
          rowActions={(row) => (
            <Button variant="quiet" onClick={() => showMethod(row)}>
              Create study
            </Button>
          )}
        />
      </Section>
      <Section id="controls" title="Button & Toolbar">
        <div className="ui-gallery-examples ui-stack">
          <Toolbar
            secondary={
              <Button variant="quiet" onClick={() => setNotice('Fixture export requested')}>
                Export
              </Button>
            }
          >
            <Button variant="primary" onClick={() => setNotice('New question fixture')}>
              <Plus aria-hidden="true" />
              Add question
            </Button>
            <Button onClick={() => setNotice('Fixture saved')}>Save</Button>
            <Button variant="quiet" onClick={() => setNotice('Preview fixture')}>
              Preview
            </Button>
            <Button variant="danger" onClick={() => setDialog('destructive')}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
            <Button
              size="icon"
              aria-label="Reset gallery notice"
              onClick={() => setNotice('Gallery fixtures · no server writes')}
            >
              <RotateCcw aria-hidden="true" />
            </Button>
          </Toolbar>
          <div className="ui-inline ui-wrap">
            <Button variant="primary" disabled>
              Primary disabled
            </Button>
            <Button disabled>Default disabled</Button>
            <Button variant="quiet" disabled>
              Quiet disabled
            </Button>
            <Button variant="danger" disabled>
              Danger disabled
            </Button>
            <Button size="icon" disabled aria-label="Reset unavailable">
              <RotateCcw aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Section>
      <Section id="properties" title="Field & PropertyGrid · line-scale fixture">
        <div className="ui-gallery-examples">
          <QuestionProperties />
        </div>
      </Section>
      <Section id="statuses" title="StatusText & Tabs">
        <div className="ui-gallery-examples ui-stack">
          <div className="ui-inline ui-wrap">
            {(['published', 'draft', 'deprecated', 'synced', 'pending'] as Status[]).map(
              (status) => (
                <StatusText key={status} status={status} />
              ),
            )}
          </div>
          <Tabs
            label="Question fixture tabs"
            value={tab}
            onChange={setTab}
            tabs={[
              {
                id: 'configuration',
                label: 'Configuration',
                content: <p>Line scale · required response · no preset value</p>,
              },
              {
                id: 'preview',
                label: 'Preview',
                content: <p>How intense is the oat aroma? · Not perceptible → Very intense</p>,
              },
              {
                id: 'validation',
                label: 'Validation',
                content: <p>Fixture range: 0–100. Numeric zero is retained.</p>,
              },
            ]}
          />
        </div>
      </Section>
      <Section id="design-sets" title="DataTable · 60 sets × 3 products">
        <DataTable
          id="design-sets-table"
          label="Design sets"
          data={designSets}
          columns={setColumns}
          getRowId={(row) => row.id}
          compact
          onActivate={(row) =>
            setNotice(
              <>
                Set fixture: <span className="mono">{row.set_code}</span>, product {row.product}
              </>,
            )
          }
        />
      </Section>
      <Section id="table-states" title="DataTable · empty and virtualised">
        <DataTable
          id="empty-table"
          label="Empty assignments"
          data={[]}
          columns={setColumns}
          getRowId={(row) => row.id}
        />
        <DataTable
          id="virtual-table"
          label="Virtual assignments"
          data={virtualSets}
          columns={setColumns}
          getRowId={(row) => row.id}
          onActivate={(row) =>
            setNotice(
              <>
                Virtual fixture: <span className="mono">{row.id}</span>
              </>,
            )
          }
        />
      </Section>
      <Section id="dialogs" title="Dialog & SidePanel">
        <div className="ui-inline">
          <Button variant="danger" onClick={() => setDialog('destructive')}>
            Delete fixture…
          </Button>
          <Button onClick={() => setDialog('generate')}>Generate codes…</Button>
          <Button onClick={() => setPanel(true)}>Open docked properties</Button>
        </div>
      </Section>
      <Section id="fixture-reference" title="Fixture reference">
        <p>
          Gallery data demonstrates component states. Method availability, schema versions,
          implementations and references are illustrative.
        </p>
      </Section>
      <FoundationGallery />
      <GuardsGallery />
      <SampleLoopGallery />
      <FlowCheckGallery />
      <SessionsGallery />
      <TerminalsGallery />
      <RunStudyGallery />
      <StudyLifecycleGallery />
      <UsabilityGallery />
      <SamplesDesignGallery />
      <OperationsGallery />
      <RoomsGallery />
      <MethodsGallery />
      <QuestionnaireGallery active={activeSection === 'questionnaire-gallery'} />
      {activeSection === 'assets-gallery' ? <AssetsGallery /> : <section id="assets-gallery" />}
      {activeSection === 'temporal-gallery' ? (
        <TemporalGallery />
      ) : (
        <section id="temporal-gallery" />
      )}
      <DataGallery />
      {activeSection === 'snapshots-gallery' ? (
        <SnapshotsGallery />
      ) : (
        <section id="snapshots-gallery" />
      )}
      {activeSection === 'wide-export-gallery' ? (
        <WideExportGallery />
      ) : (
        <section id="wide-export-gallery" />
      )}
      {activeSection === 'analyses-gallery' ? (
        <AnalysesGallery />
      ) : (
        <section id="analyses-gallery" />
      )}
      <Dialog
        open={dialog !== null}
        purpose={dialog ?? 'destructive'}
        title={dialog === 'generate' ? 'Generate fixture codes' : 'Delete fixture?'}
        onClose={() => setDialog(null)}
      >
        {dialog === 'generate' ? (
          <form
            className="ui-stack"
            onSubmit={(event) => {
              event.preventDefault();
              setNotice(`Generated ${count} fixture codes`);
              setDialog(null);
            }}
          >
            <Field
              kind="number"
              label="Number of sets"
              value={count}
              min={1}
              max={600}
              required
              onChange={(event) => setCount(event.target.value)}
            />
            <div className="ui-inline">
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="primary" type="submit">
                Generate
              </Button>
            </div>
          </form>
        ) : (
          <div className="ui-stack">
            <p>Delete this local demonstration fixture?</p>
            <div className="ui-inline">
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setNotice('Demonstration fixture deleted');
                  setDialog(null);
                }}
              >
                Delete fixture
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </AppShell>
  );
}
