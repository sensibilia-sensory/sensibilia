import { useState } from 'react';
import { Tabs } from '../ui';
import { TerminalTable, TerminalPreparation, TerminalAuditTable } from '../researcher/Terminals';
import type { components } from '../api-schema';
const row: components['schemas']['TerminalRead'] = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Tablet 01',
  revision: 1,
  booth_id: null,
  registered_at: '2026-10-11T12:00:00Z',
  retired_at: null,
  session_id: '10000000-0000-4000-8000-000000000002',
  assessor_code: 'A01',
  study_version_id: '10000000-0000-4000-8000-000000000003',
  session_status: 'in_progress',
};
export function TerminalsGallery() {
  const [tab, setTab] = useState('list');
  return (
    <section id="terminals" className="ui-gallery-section ui-stack" aria-label="Terminal fixtures">
      <Tabs
        label="Terminal fixture states"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'list',
            label: 'List',
            content: (
              <TerminalTable
                rows={Array.from({ length: 20 }, (_, i) => ({
                  ...row,
                  id: row.id.slice(0, -2) + String(i).padStart(2, '0'),
                  name: 'Tablet ' + (i + 1),
                }))}
                onRetry={() => {}}
                onSelect={() => {}}
                onRemove={() => {}}
              />
            ),
          },
          { id: 'empty', label: 'Empty', content: <TerminalTable rows={[]} onRetry={() => {}} /> },
          {
            id: 'loading',
            label: 'Loading',
            content: <TerminalTable rows={[]} loading onRetry={() => {}} />,
          },
          {
            id: 'error',
            label: 'Error',
            content: (
              <TerminalTable
                rows={[]}
                error="Cannot reach laboratory server."
                onRetry={() => setTab('list')}
              />
            ),
          },
          {
            id: 'readonly',
            label: 'Read-only',
            content: (
              <>
                <TerminalTable
                  rows={[{ ...row, retired_at: '2026-10-11T14:00:00Z' }]}
                  onRetry={() => {}}
                  onSelect={() => {}}
                  onRemove={() => {}}
                />
                <TerminalPreparation
                  presetId={row.id}
                  presetToken="fixture"
                  readonly
                  onPrepare={() => {}}
                />
              </>
            ),
          },
          {
            id: 'audit',
            label: 'Audit',
            content: (
              <TerminalAuditTable
                rows={[
                  {
                    id: row.id,
                    terminal_id: row.id,
                    session_id: row.session_id,
                    action: 'assigned',
                    staff_name: 'Technician',
                    principal: 'researcher:fixture',
                    reason: 'Prepared assessment',
                    revision: 1,
                    recorded_at: row.registered_at,
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
