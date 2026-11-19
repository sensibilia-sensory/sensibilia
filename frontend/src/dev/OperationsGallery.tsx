import { useState } from 'react';
import { OperatorTable, type Dashboard } from '../researcher/Operations';
import { Button, Toolbar, BoothLayout } from '../ui';
import { ServingGate } from '../shared/nodes/ServingGate';
const view: Dashboard = {
  cursor: 1,
  server_time: '2026-10-12T12:02:00Z',
  tasks: Array.from({ length: 20 }, (_, i) => ({
    assignment_id: 'a' + i,
    room_version_id: 'room',
    room_name: 'Laboratory',
    room_revision: 1,
    booth_id: 'b' + i,
    booth_label: String(i + 1),
    row: Math.floor(i / 4) + 1,
    column: (i % 4) + 1,
    session_id: 'session' + i,
    assessor_code: 'A' + i,
    study_version_id: 'version',
    version_number: 3,
    status: i % 2 ? 'acknowledged' : 'ready',
    last_seen: '2026-10-12T12:01:50Z',
    presence: i === 2 ? 'offline' : 'online',
    signal: {
      id: 's' + i,
      assignment_id: 'a' + i,
      step_id: 'gate',
      occurrence_id: 'study',
      state: i % 2 ? 'acknowledged' : 'ready',
      revision: i % 2 ? 2 : 1,
      requested_at: '2026-10-12T12:00:00Z',
      updated_at: '2026-10-12T12:00:30Z',
      actor: i % 2 ? 'Operator' : 'Tablet',
    },
    slots: [{ sample_id: 'sample', code: '731', label: 'Product A', position: 1 }],
    preparation: 'One portion',
  })),
};
export function OperationsGallery() {
  const [state, setState] = useState('populated');
  const [gateStatus, setGateStatus] = useState('ready');
  const [requireStaff, setRequireStaff] = useState(false);
  return (
    <section id="operations" className="ui-stack" aria-label="Operator gallery">
      <Toolbar>
        {['populated', 'loading', 'empty', 'error', 'readonly', 'big'].map((s) => (
          <Button key={s} compact onClick={() => setState(s)}>
            {s}
          </Button>
        ))}
      </Toolbar>
      <BoothLayout
        label="Laboratory floor layout"
        rows={5}
        columns={4}
        booths={view.tasks.map((t) => ({
          id: t.booth_id,
          label: t.booth_label,
          row: t.row,
          column: t.column,
          state: t.status,
        }))}
      />
      <OperatorTable
        view={state === 'empty' ? { ...view, tasks: [] } : view}
        loading={state === 'loading'}
        error={state === 'error' ? 'Serving connection interrupted; snapshot retained.' : ''}
        readOnly={state === 'readonly'}
        big={state === 'big'}
      />
      <ServingGate
        announce={false}
        node={{
          id: 'gate',
          kind: 'serve_gate',
          title: { en: 'Delivery' },
          data: {
            body: { en: 'Confirm delivery' },
            preparation: { en: 'One portion' },
            sample_binding: 'current',
            sample_ids: [],
            timeout_seconds: 120,
            require_staff_delivery: requireStaff,
          },
        }}
        language="en"
        variables={{ 'serving.codes': ['731'] }}
        elapsed={120000}
        status={gateStatus}
        onChange={() => {}}
      />
      <Toolbar>
        <Button compact onClick={() => setRequireStaff(!requireStaff)}>
          {requireStaff ? 'Assessor confirms alone' : 'Require staff delivery'}
        </Button>
        {['ready', 'acknowledged', 'served'].map((s) => (
          <Button key={s} compact onClick={() => setGateStatus(s)}>
            {'Staff set ' + s}
          </Button>
        ))}
      </Toolbar>
    </section>
  );
}
