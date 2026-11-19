import { StimulusManifest } from './StimulusManifest';
import type { Asset } from '../shared/assets';
import { requiredAssetIds } from '../shared/assets';
import { Button, DataTable, Field, PropertyGrid, technical } from '../ui';
import type { components } from '../api-schema';
import { explainIssue } from '../shared/issueText';
import { outline, conditionText, type Flow, type Test, type Sample } from '../shared/flow';
export type Issue = components['schemas']['ValidationIssue'];
export function FlowCheck({
  report,
  loading = false,
  error = '',
  onRetry,
  onOpen,
  stepName,
  prefix = 'flow-check',
}: {
  report?: components['schemas']['ValidationReport'];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onOpen: (issue: Issue) => void;
  stepName?: (issue: Issue) => string | undefined;
  prefix?: string;
}) {
  return (
    <section className="ui-stack" aria-label="Flow validation" aria-busy={loading}>
      {loading && <p role="status">Checking saved snapshot…</p>}
      {error && <p role="alert">{error}</p>}
      {onRetry && (
        <Button disabled={loading} onClick={onRetry}>
          {error ? 'Retry flow check' : 'Check saved study'}
        </Button>
      )}
      {report && (
        <p>
          Saved revision: <span className="mono">{report.revision_hash}</span> ·{' '}
          {report.valid ? 'No blocking errors' : 'Publication blocked'}
        </p>
      )}
      {report?.valid && <p>Flow snapshot is valid.</p>}
      <DataTable
        id={prefix === 'publish' ? 'publication-issues' : prefix + '-issues'}
        label="Publication issues"
        data={(report?.issues ?? []).map((issue, i) => ({ ...issue, id: String(i) }))}
        getRowId={(issue) => issue.id}
        columns={[
          {
            id: 'severity',
            header: 'Severity',
            accessorFn: (issue) => (issue.severity === 'error' ? 'Must fix' : 'Review'),
          },
          { id: 'step', header: 'Step', accessorFn: (issue) => stepName?.(issue) || '—' },
          {
            id: 'problem',
            header: 'What is wrong',
            accessorFn: (issue) => explainIssue(issue).problem,
          },
          { id: 'fix', header: 'What to do', accessorFn: (issue) => explainIssue(issue).fix },
          { accessorKey: 'node_id', header: 'Step ID', meta: technical },
          { accessorKey: 'study_test_id', header: 'Test ID', meta: technical },
          {
            id: 'path',
            header: 'Field / language',
            accessorFn: (issue) => issue.path.join(' → '),
            meta: technical,
          },
          { accessorKey: 'code', header: 'Code', meta: technical },
          { accessorKey: 'message', header: 'Original message', meta: technical },
        ]}
        emptyText={
          loading
            ? 'Loading validation…'
            : !report
              ? 'Check the saved snapshot to review issues.'
              : 'No issues in the saved snapshot.'
        }
        rowActions={(issue) => (
          <Button variant="quiet" disabled={loading} onClick={() => onOpen(issue)}>
            Go to problem
          </Button>
        )}
        onActivate={(issue) => onOpen(issue)}
      />
    </section>
  );
}
export function PublicationSnapshot({
  version,
  tests,
  samples,
  assets = [],
  loading = false,
}: {
  version: components['schemas']['VersionRead'];
  tests: Test[];
  samples: Sample[];
  assets?: Asset[];
  loading?: boolean;
}) {
  const flow: Flow | undefined = version.form?.schema_version === 2 ? version.form : undefined;
  const entries = flow ? outline(flow.nodes) : [];
  const assignments = entries.flatMap(({ node }) =>
    node.kind === 'loop_samples'
      ? node.data.sample_ids.map((id, i) => ({
          id: node.id + ':' + id,
          loop: node.id,
          position: i + 1,
          sample: id,
          code: samples.find((s) => s.id === id)?.code ?? 'Missing',
        }))
      : [],
  );
  return (
    <section className="ui-stack" aria-label="Publication snapshot" aria-busy={loading}>
      <PropertyGrid
        sections={[
          {
            title: 'Saved publication snapshot',
            defaultOpen: true,
            children: (
              <>
                <Field
                  label="Snapshot version"
                  value={'v' + version.version_number + ' · ' + version.id}
                  disabled
                  onChange={() => {}}
                />
                <Field label="Snapshot title" value={version.title} disabled onChange={() => {}} />
                <Field
                  label="Snapshot state"
                  value={version.published_at ? 'Published · ' + version.published_at : 'Draft'}
                  disabled
                  onChange={() => {}}
                />
                <Field
                  label="Snapshot languages"
                  value={
                    (flow?.languages.join(', ') ?? 'Legacy') +
                    ' · default ' +
                    (flow?.default_language ?? 'Not recorded')
                  }
                  disabled
                  onChange={() => {}}
                />
                <Field
                  label="Verification ID"
                  value={version.revision_hash}
                  disabled
                  mono
                  onChange={() => {}}
                />
              </>
            ),
          },
        ]}
      />
      <DataTable
        id="publication-outline"
        label="Publication outline"
        compact
        data={entries.map((e) => ({
          id: e.node.id,
          number: e.number,
          title: e.node.title[flow!.default_language],
          kind: e.node.kind,
          method:
            e.node.kind === 'embedded_method'
              ? tests.find(
                  (t) => e.node.kind === 'embedded_method' && t.id === e.node.data.study_test_id,
                )?.test_type_id
              : '—',
          schema: e.node.kind === 'embedded_method' ? '1' : '—',
          guard: conditionText(e.node.guard, flow!, tests),
          otherwise:
            (e.node.otherwise?.action ?? 'continue') +
            (e.node.otherwise && 'target_id' in e.node.otherwise
              ? ' → ' + e.node.otherwise.target_id
              : ''),
        }))}
        getRowId={(e) => e.id}
        columns={[
          { accessorKey: 'number', header: 'No.' },
          { accessorKey: 'id', header: 'Step ID', meta: technical },
          { accessorKey: 'title', header: 'Title' },
          { accessorKey: 'kind', header: 'Type' },
          { accessorKey: 'method', header: 'Method' },
          { accessorKey: 'schema', header: 'Schema' },
          { accessorKey: 'guard', header: 'Show if' },
          { accessorKey: 'otherwise', header: 'If condition is not met' },
        ]}
      />
      {flow && !!requiredAssetIds(flow).size && <StimulusManifest flow={flow} assets={assets} />}
      <DataTable
        id="publication-assignments"
        label="Assigned sample order"
        compact
        data={assignments}
        getRowId={(a) => a.id}
        columns={[
          { accessorKey: 'loop', header: 'Loop ID', meta: technical },
          { accessorKey: 'position', header: 'Position' },
          { accessorKey: 'sample', header: 'Sample ID', meta: technical },
          { accessorKey: 'code', header: 'Code' },
        ]}
        emptyText="No sample loops in this snapshot."
      />
    </section>
  );
}
