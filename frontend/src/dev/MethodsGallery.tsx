import methodSnapshots from '../../../migrations/versions/methods_v1.json';
import { RegisteredMethodFields } from '../NewMethodEditor';
import { defaultConfiguration } from '../methods';
import type { Method, NewConfiguration } from '../api';
import { Field, Tabs } from '../ui';
import { useState } from 'react';
import { SampleMap, type MapPoint } from '../ui';
export function MethodsGallery() {
  const [points, setPoints] = useState<Record<string, MapPoint>>({});
  const samples = [
    { id: 'a', code: '317' },
    { id: 'b', code: '582' },
  ];
  return (
    <section id="v2-methods" className="ui-stack" aria-label="Registered methods gallery">
      <MethodEditorGallery />
      <h2>SampleMap · empty, interactive and read only</h2>
      <div className="ui-preview">
        <SampleMap quiet samples={samples} points={points} onChange={setPoints} />
      </div>
      <SampleMap quiet samples={[]} points={{}} onChange={() => {}} />
      <SampleMap
        quiet
        samples={samples}
        points={{ a: { x: 0, y: 0, description: '' }, b: { x: 60, y: 40, description: '' } }}
        onChange={() => {}}
        disabled
      />
    </section>
  );
}

function MethodEditorGallery() {
  const methods = methodSnapshots as unknown as Method[];
  const samples = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      study_version_id: '20000000-0000-4000-8000-000000000001',
      code: '317',
      label: 'Private A',
      ingredient_tags: [],
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      study_version_id: '20000000-0000-4000-8000-000000000001',
      code: '582',
      label: 'Private B',
      ingredient_tags: [],
    },
  ];
  const [methodId, setMethodId] = useState('cata-v1');
  const [config, setConfig] = useState<NewConfiguration>(() =>
    defaultConfiguration('cata-v1', samples),
  );
  const [state, setState] = useState('ready');
  const method = methods.find((m) => m.id === methodId)!;
  return (
    <section className="ui-stack" aria-label="Registered method editor fixtures">
      <h2>Registered method editor</h2>
      <Field
        label="Gallery method"
        kind="select"
        value={methodId}
        options={methods.map((m) => ({ value: m.id, label: m.name }))}
        onChange={(e) => {
          setMethodId(e.target.value);
          setConfig(defaultConfiguration(e.target.value, samples));
        }}
      />
      <Tabs
        label="Method editor states"
        value={state}
        onChange={setState}
        tabs={['ready', 'empty', 'loading', 'error', 'readonly'].map((id) => ({
          id,
          label: id,
          content:
            id === 'loading' ? (
              <p role="status">Loading method schema…</p>
            ) : id === 'error' ? (
              <p role="alert">Cannot load method schema. Retry.</p>
            ) : (
              <RegisteredMethodFields
                quiet
                method={method}
                prefix={'gallery-method-' + id}
                config={config}
                samples={id === 'empty' ? [] : samples}
                disabled={id === 'readonly'}
                onChange={setConfig}
              />
            ),
        }))}
      />
    </section>
  );
}
