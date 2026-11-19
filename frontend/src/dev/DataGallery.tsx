import { useState } from 'react';
import { Tabs } from '../ui';
import { DataLedger, type DataRow } from '../researcher/Data';
const row: DataRow = {
  row_id: 'fixture',
  row_kind: 'answer',
  study_id: '10000000-0000-4000-8000-000000000001',
  study_version_id: '10000000-0000-4000-8000-000000000002',
  version_number: 1,
  session_id: '10000000-0000-4000-8000-000000000003',
  assessor_code: 'A01',
  question_id: 'sweet',
  method_key: 'rata',
  method_schema_version: 1,
  value_json: '{"kind":"rata","state":"selected","rating":0}',
  answer_event_ids_json: 'null',
  sample_id_json: 'null',
  state: 'selected',
  is_current: true,
  recorded_at: '2026-10-11T12:00:00Z',
  received_at: '2026-10-11T12:00:01Z',
};
export function DataGallery() {
  const [tab, setTab] = useState('readonly');
  return (
    <section id="data" className="ui-gallery-section ui-stack" aria-label="Data fixtures">
      <Tabs
        label="Data fixture states"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'readonly',
            label: 'Read-only',
            content: (
              <DataLedger
                id="data-ledger-readonly"
                rows={Array.from({ length: 20 }, (_, i) => ({
                  ...row,
                  row_id: 'fixture-' + i,
                  assessor_code: 'A' + i,
                  is_current: i % 2 === 0,
                }))}
                onRetry={() => {}}
              />
            ),
          },
          {
            id: 'empty',
            label: 'Empty',
            content: <DataLedger id="data-ledger-empty" rows={[]} onRetry={() => {}} />,
          },
          {
            id: 'loading',
            label: 'Loading',
            content: <DataLedger id="data-ledger-loading" rows={[]} loading onRetry={() => {}} />,
          },
          {
            id: 'error',
            label: 'Error',
            content: (
              <DataLedger
                id="data-ledger-error"
                rows={[]}
                error="Cannot reach laboratory server."
                onRetry={() => setTab('readonly')}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
