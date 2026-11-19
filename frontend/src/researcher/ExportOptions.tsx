import type { components } from '../api-schema';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, DataTable, Field, PropertyGrid } from '../ui';
export type ExportSettings = components['schemas']['ExportOptions'];
export type Dictionary = components['schemas']['ExportDictionaryRead'];
type DictionaryColumn = components['schemas']['WideColumnRead'];
const columns: ColumnDef<DictionaryColumn>[] = [
  { accessorKey: 'column', header: 'CSV column' },
  { accessorKey: 'key_json', header: 'Exact key JSON' },
  { accessorKey: 'description', header: 'Cell encoding' },
];
export function ExportOptions({
  value,
  onChange,
  disabled = false,
}: {
  value: ExportSettings;
  onChange: (value: ExportSettings) => void;
  disabled?: boolean;
}) {
  return (
    <PropertyGrid
      sections={[
        {
          title: 'Export options',
          defaultOpen: true,
          children: (
            <>
              <Field
                label="Export format"
                kind="select"
                value={value.format ?? 'long'}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...value, format: e.target.value as ExportSettings['format'] })
                }
                options={[
                  { value: 'long', label: 'Long CSV · authoritative ledger' },
                  { value: 'wide', label: 'Wide CSV · one row per session' },
                  { value: 'r', label: 'R-ready CSV · one plain value per cell' },
                ]}
              />
              <Field
                label="Export history"
                kind="select"
                value={value.history ?? 'all'}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...value, history: e.target.value as ExportSettings['history'] })
                }
                options={[
                  { value: 'all', label: 'All immutable history' },
                  { value: 'current', label: 'Current answers · retain paths and expectations' },
                ]}
              />
            </>
          ),
        },
      ]}
    />
  );
}
export function ExportDictionary({
  dictionary,
  loading = false,
  error = '',
  onRetry,
  id = 'wide-dictionary',
}: {
  id?: string;
  dictionary: Dictionary | null;
  loading?: boolean;
  error?: string;
  onRetry: () => void;
}) {
  return (
    <section className="ui-stack" aria-label="Wide export dictionary">
      {loading && (
        <p role="status" aria-busy="true">
          Loading dictionary…
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <Button onClick={onRetry}>Retry dictionary</Button>
        </p>
      )}
      <p>
        Read-only keyed pivot. Each nonblank cell is a JSON array of complete ledger records. Blank
        cells mean no projected record for that session/key. No scalar conversion or scoring.
      </p>
      {dictionary && (
        <>
          <p>
            Scope: {dictionary.study_version_id ?? 'All versions'} · History:{' '}
            {dictionary.options.history} · Dictionary schema: {dictionary.schema_version}
          </p>
          <p>{dictionary.history_policy}</p>
          <p>{dictionary.state_policy}</p>
          <p>
            Row keys: {dictionary.row_keys.join(', ')}. Key fields:{' '}
            {dictionary.key_fields.join(', ')}.
          </p>
        </>
      )}
      <DataTable
        id={id}
        label="Wide columns"
        data={dictionary?.columns ?? []}
        columns={columns}
        getRowId={(r) => r.column}
        selectable={false}
        emptyText={loading ? 'Loading dictionary…' : 'No columns in this scope.'}
      />
    </section>
  );
}
