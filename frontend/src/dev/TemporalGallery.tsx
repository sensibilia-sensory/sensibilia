import schema from '../../../migrations/versions/tcata_v1.json';
import { useState } from 'react';
import { RegisteredMethodFields } from '../NewMethodEditor';
import { TemporalRenderer } from '../shared/nodes/TemporalRenderer';
import type { TemporalDraft } from '../shared/methods/temporal';
import type { Method, NewConfiguration } from '../api';
import { defaultConfiguration } from '../methods';
import { Tabs } from '../ui';
export function TemporalGallery() {
  const [config, setConfig] = useState<NewConfiguration>({
    ...(defaultConfiguration('tcata-v1', []) as Extract<NewConfiguration, { kind: 'tcata' }>),
    kind: 'tcata',
    attributes: [
      { id: 'sweet', prompt: 'Sweet', required: true },
      { id: 'bitter', prompt: 'Bitter', required: true },
    ],
    duration_ms: 5000,
  });
  const [view, setView] = useState('capture');
  const initial: TemporalDraft = {
    client_event_id: '00000000-0000-4000-8000-000000000001',
    state: 'interrupted',
    started_at: '2026-10-14T12:00:00Z',
    ended_at: '2026-10-14T12:00:01Z',
    elapsed_ms: 1000,
    clock_resolution_ms: 0.1,
    interruption_flags: ['reload'],
    transitions: Array.from({ length: 6 }, (_, i) => ({
      client_event_id: String(i),
      seq: i + 1,
      elapsed_ms: i * 100,
      attribute_id: 'sweet',
      selected: i % 2 === 0,
      recorded_at: '2026-10-14T12:00:00Z',
    })),
  };
  return (
    <section id="temporal-gallery" className="ui-stack" aria-label="Temporal gallery">
      <h2>Temporal methods</h2>
      <Tabs
        label="Temporal states"
        value={view}
        onChange={setView}
        tabs={['capture', 'editor', 'readonly', 'empty', 'loading', 'error'].map((id) => ({
          id,
          label: id,
          content:
            id === 'loading' ? (
              <p role="status">Loading temporal run…</p>
            ) : id === 'error' ? (
              <p role="alert">Cannot read temporal run. Retain tablet and retry.</p>
            ) : id === 'editor' ? (
              <RegisteredMethodFields
                quiet
                method={
                  {
                    id: 'tcata-v1',
                    name: 'TCATA',
                    configuration_schema: schema,
                  } as unknown as Method
                }
                config={config}
                samples={[]}
                onChange={setConfig}
              />
            ) : (
              <div className={id === 'capture' ? 'ui-preview' : ''}>
                <TemporalRenderer
                  id={'gallery-temporal-' + id}
                  config={config as import('../shared/methods/temporal').TemporalConfig}
                  initial={id === 'readonly' ? initial : undefined}
                  disabled={id === 'readonly'}
                  onChange={() => {}}
                />
              </div>
            ),
        }))}
      />
    </section>
  );
}
