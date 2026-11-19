import { useState } from 'react';
import { Tabs } from '../ui';
import {
  ExportOptions,
  ExportDictionary,
  type Dictionary,
  type ExportSettings,
} from '../researcher/ExportOptions';
const fixture: Dictionary = {
  schema_version: 1,
  study_id: 'fixture-study',
  study_version_id: 'fixture-version',
  options: { format: 'wide', history: 'all' },
  row_keys: ['study_id', 'study_version_id', 'version_number', 'session_id', 'assessor_code'],
  key_fields: [
    'row_kind',
    'step_id',
    'occurrence_id',
    'study_test_id',
    'sample_id_json',
    'question_id',
    'descriptor_id',
    'path_seq',
    'temporal_run_id',
    'temporal_seq',
  ],
  cell_encoding: 'JSON arrays of complete records',
  history_policy: 'All history preserves corrections; current omits only superseded records.',
  state_policy:
    'Missing, skipped, unselected, selected/unrated and zero retain their original JSON.',
  limits: { columns: 4096, sessions: 10000, records: 250000, cell_bytes: 67108864 },
  columns: Array.from({ length: 17 }, (_, i) => ({
    column: 'w_fixture_' + i,
    key_json: JSON.stringify({
      row_kind: 'form_answer',
      step_id: 'node-' + i,
      occurrence_id: 'study',
      question_id: 'answer',
    }),
    description: 'Complete ledger records for this exact key; no scalar conversion.',
  })),
};
export function WideExportGallery() {
  const [state, setState] = useState('readonly');
  const [settings, setSettings] = useState<ExportSettings>({ format: 'wide', history: 'all' });
  return (
    <section
      id="wide-export-gallery"
      className="ui-gallery-section ui-stack"
      aria-label="Wide export fixtures"
    >
      <ExportOptions value={settings} onChange={setSettings} disabled={state === 'loading'} />
      <Tabs
        label="Wide export states"
        value={state}
        onChange={setState}
        tabs={['readonly', 'empty', 'loading', 'error'].map((id) => ({
          id,
          label: { readonly: 'Read-only', empty: 'Empty', loading: 'Loading', error: 'Error' }[id]!,
          content: (
            <ExportDictionary
              id={'wide-dictionary-' + id}
              dictionary={id === 'readonly' ? { ...fixture, options: settings } : null}
              loading={id === 'loading'}
              error={id === 'error' ? 'Cannot reach laboratory server.' : ''}
              onRetry={() => setState('readonly')}
            />
          ),
        }))}
      />
    </section>
  );
}
