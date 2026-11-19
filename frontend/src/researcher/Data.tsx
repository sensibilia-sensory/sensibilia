import { Snapshots } from './Snapshots';
import { saveBlob } from './download';
import {
  ExportOptions,
  ExportDictionary,
  type ExportSettings,
  type Dictionary,
} from './ExportOptions';
import { navigate, useRoute } from '../router';
import { useEffect, useRef, useState } from 'react';
import type { components } from '../api-schema';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, DataTable, Field, Toolbar } from '../ui';
import type { Client, Version } from './client';
export type DataRow = components['schemas']['DataRowRead'];
const fields: [keyof DataRow, string][] = [
  ['row_kind', 'Row kind'],
  ['version_number', 'Version'],
  ['assessor_code', 'Assessor'],
  ['state', 'State'],
  ['skip_reason', 'Path reason'],
  ['value_json', 'Value JSON'],
  ['is_current', 'Current'],
  ['question_id', 'Question/attribute'],
  ['sample_code', 'Sample code'],
  ['method_key', 'Method'],
  ['method_schema_version', 'Method schema'],
  ['form_schema_version', 'Form schema'],
  ['block_kind', 'Node kind'],
  ['study_id', 'Study ID'],
  ['study_version_id', 'Version ID'],
  ['session_id', 'Session ID'],
  ['sample_id_json', 'Sample ID JSON'],
  ['step_id', 'Node ID'],
  ['occurrence_id', 'Occurrence'],
  ['study_test_id', 'Test ID'],
  ['test_type_id', 'Method ID'],
  ['recorded_at', 'Recorded'],
  ['received_at', 'Received'],
  ['id', 'Server event ID'],
  ['client_event_id', 'Client event ID'],
  ['supersedes_event_id', 'Supersedes'],
  ['path_seq', 'Path sequence'],
  ['path_kind', 'Path event'],
  ['target_id', 'Target ID'],
  ['answer_event_ids_json', 'Answer event IDs JSON'],
  ['sample_label', 'Private sample label'],
  ['attribute_label', 'Attribute label'],
  ['option_label', 'Option label'],
  ['score_json', 'Score JSON'],
  ['descriptor_id', 'Descriptor ID'],
  ['descriptor', 'Descriptor'],
  ['rank', 'Rank'],
  ['x', 'X'],
  ['y', 'Y'],
  ['coordinate_units', 'Units'],
  ['selected_code', 'Selected code'],
  ['correct', 'Correct'],
  ['temporal_run_id', 'Temporal run ID'],
  ['temporal_seq', 'Temporal sequence'],
  ['temporal_elapsed_milliseconds', 'Temporal elapsed ms'],
  ['clock_resolution_ms', 'Clock resolution ms'],
  ['interruption_flags_json', 'Timing flags JSON'],
  ['temporal_attributes_json', 'Temporal attributes JSON'],
  ['serving_plan_json', 'Serving plan JSON'],
];
const columns: ColumnDef<DataRow>[] = fields.map(([key, header]) => ({
  id: key,
  header,
  accessorFn: (r) => (r[key] == null ? '—' : typeof r[key] === 'boolean' ? String(r[key]) : r[key]),
}));
export function DataLedger({
  rows,
  loading = false,
  error = '',
  onRetry,
  id = 'data-ledger',
}: {
  rows: DataRow[];
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  id?: string;
}) {
  return (
    <div className="ui-stack">
      {loading && (
        <p role="status" aria-busy="true">
          Loading data…
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <Button onClick={onRetry}>Retry data</Button>
        </p>
      )}
      <DataTable
        id={id}
        label="Data provenance"
        data={rows}
        columns={columns}
        getRowId={(r) => r.row_id}
        wide
        emptyText={loading ? 'Loading data…' : 'No data for this scope.'}
      />
    </div>
  );
}
export function Data({
  client,
  studyId,
  version,
  active = true,
}: {
  client: Client;
  studyId: string;
  version: Version;
  active?: boolean;
}) {
  const href = useRoute();
  const url = new URL(href, window.location.origin);
  const scope =
    url.pathname.endsWith('/data') && url.searchParams.get('scope') === 'all' ? '' : version.id;
  const rawOffset = Number(url.searchParams.get('offset') ?? 0);
  const offset =
    url.pathname.endsWith('/data') && Number.isSafeInteger(rawOffset) && rawOffset >= 0
      ? rawOffset
      : 0;
  const move = (nextScope: string, nextOffset: number) =>
    navigate(
      url.pathname +
        '?' +
        new URLSearchParams({ scope: nextScope ? 'version' : 'all', offset: String(nextOffset) }),
    );
  const [rows, setRows] = useState<DataRow[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState('');
  const [settings, setSettings] = useState<ExportSettings>({ format: 'long', history: 'all' });
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [dictionaryError, setDictionaryError] = useState('');
  const [showDictionary, setShowDictionary] = useState(false);
  const dictionaryGeneration = useRef(0);
  useEffect(() => {
    dictionaryGeneration.current++;
    setDictionary(null);
    setDictionaryError('');
    setDictionaryLoading(false);
    setShowDictionary(false);
  }, [studyId, scope, settings.format, settings.history, active]);
  const readDictionary = async () => {
    const current = ++dictionaryGeneration.current;
    setShowDictionary(true);
    setDictionaryLoading(true);
    setDictionaryError('');
    setDictionary(null);
    try {
      const result = await client.exportDictionary(studyId, scope, settings.history ?? 'all');
      if (current === dictionaryGeneration.current) setDictionary(result);
    } catch (e) {
      if (current === dictionaryGeneration.current)
        setDictionaryError(e instanceof Error ? e.message : 'Dictionary read failed');
    } finally {
      if (current === dictionaryGeneration.current) setDictionaryLoading(false);
    }
  };
  const generation = useRef(0);
  const load = async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    setRows([]);
    try {
      const result = await client.data(studyId, scope, offset);
      if (current === generation.current) setRows(result);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : 'Read failed');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (active) void load();
    return () => {
      generation.current++;
    };
  }, [studyId, scope, offset, active]);
  const download = async () => {
    setExporting(true);
    setExportError('');
    const selectedScope = scope;
    const selectedSettings = { ...settings };
    try {
      const blob = await client.exportData(studyId, selectedScope, selectedSettings);
      saveBlob(
        blob,
        studyId +
          (selectedScope ? '-' + selectedScope : '-all-versions') +
          '-' +
          selectedSettings.format +
          '-' +
          selectedSettings.history +
          '.csv',
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="ui-stack" aria-label="Study data">
      <Toolbar
        label="Data toolbar"
        secondary={
          <Button disabled={loading} onClick={() => void load()}>
            Refresh data
          </Button>
        }
      >
        <Button disabled={exporting} onClick={() => void download()}>
          {settings.format === 'wide'
            ? 'Export wide CSV'
            : settings.format === 'r'
              ? 'Export R-ready CSV'
              : 'Export long CSV'}
        </Button>
      </Toolbar>
      <Field
        label="Data scope"
        kind="select"
        value={scope}
        disabled={exporting}
        onChange={(e) => {
          move(e.target.value, 0);
          setExportError('');
        }}
        options={[
          { value: version.id, label: 'This version · v' + version.version_number },
          { value: '', label: 'All versions' },
        ]}
      />
      <ExportOptions
        value={settings}
        disabled={exporting || dictionaryLoading}
        onChange={(next) => {
          // Analysis wants one row per answer; the superseded ones are history.
          setSettings(
            next.format === 'r' && settings.format !== 'r' ? { ...next, history: 'current' } : next,
          );
          setExportError('');
        }}
      />
      {settings.format === 'wide' && (
        <Toolbar label="Dictionary actions">
          <Button disabled={exporting || dictionaryLoading} onClick={() => void readDictionary()}>
            Read wide dictionary
          </Button>
          <Button
            disabled={!dictionary || dictionaryLoading}
            onClick={() => {
              if (dictionary)
                saveBlob(
                  new Blob([JSON.stringify(dictionary, null, 2) + '\n'], {
                    type: 'application/json',
                  }),
                  studyId +
                    (scope ? '-' + scope : '-all-versions') +
                    '-wide-' +
                    settings.history +
                    '-dictionary.json',
                );
            }}
          >
            Download dictionary JSON
          </Button>
        </Toolbar>
      )}
      {settings.format === 'wide' && (
        <p>
          Wide cells contain JSON arrays of complete ledger records. Dictionary and CSV are
          independent live reads; each cell retains its full key/provenance. Long CSV remains
          authoritative.
        </p>
      )}
      {settings.format === 'r' && (
        <p>
          R-ready CSV has one plain value per cell: no JSON. Lists of choices become one row per
          choice; an empty cell is NA and the state column says why (skipped, missing, unselected).
          Paths and timings are left out; the long CSV has everything.
        </p>
      )}
      <p>
        Read-only history. Export includes the entire selected scope, including paths and expected
        missing slots. Table search/sort applies to this page.
      </p>
      <p>
        Expected missing slots are configured expectations, with no collected event or timestamp.
        Path reasons describe audited omissions. Zero and empty selections retain their JSON values.
      </p>
      {exportError && <p role="alert">{exportError}</p>}
      {showDictionary && settings.format === 'wide' && (
        <ExportDictionary
          dictionary={dictionary}
          loading={dictionaryLoading}
          error={dictionaryError}
          onRetry={() => void readDictionary()}
        />
      )}
      <DataLedger rows={rows} loading={loading} error={error} onRetry={() => void load()} />
      <Toolbar
        label="Data pages"
        secondary={
          <Button disabled={rows.length < 100 || loading} onClick={() => move(scope, offset + 100)}>
            Next data page
          </Button>
        }
      >
        <Button
          disabled={offset === 0 || loading}
          onClick={() => move(scope, Math.max(0, offset - 100))}
        >
          Previous data page
        </Button>
        <span>
          {rows.length ? `Rows ${offset + 1}–${offset + rows.length}` : 'No rows on this page.'}
        </span>
      </Toolbar>
      <Snapshots
        key={studyId}
        client={client}
        studyId={studyId}
        scope={scope}
        history={settings.history ?? 'all'}
        active={active}
        published={!scope || !!version.published_at}
      />
    </section>
  );
}
