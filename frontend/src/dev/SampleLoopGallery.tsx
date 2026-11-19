import { useState } from 'react';
import { Field } from '../ui';
import { LoopProperties } from '../shared/nodes/LoopProperties';
import type { Node, Sample } from '../shared/flow';
export function SampleLoopGallery() {
  const [samples, setSamples] = useState<Sample[]>(
    Array.from({ length: 4 }, (_, i) => ({
      id: 'sample-' + i,
      study_version_id: 'fixture',
      code: 'S' + i,
      label: 'Private ' + i,
      ingredient_tags: i === 1 ? ['nut'] : [],
    })),
  );
  const [node, setNode] = useState<Extract<Node, { kind: 'loop_samples' }>>({
    id: 'fixture-loop',
    kind: 'loop_samples',
    title: { en: 'Samples' },
    data: { sample_ids: samples.map((s) => s.id), children: [] },
  });
  const [readOnly, setReadOnly] = useState(false);
  return (
    <section id="sample-loop" className="ui-gallery-section" aria-label="Sample loop fixtures">
      <h2>Fixed sample loop · fixtures</h2>
      <Field
        label="Published loop fixture"
        kind="checkbox"
        checked={readOnly}
        onChange={(e) => setReadOnly(e.target.checked)}
      />
      <LoopProperties
        node={node}
        samples={samples}
        disabled={readOnly}
        onChange={setNode}
        onCreate={async (payload) => {
          const sample = {
            ...payload,
            ingredient_tags: payload.ingredient_tags ?? null,
            id: crypto.randomUUID(),
            study_version_id: 'fixture',
          };
          setSamples([...samples, sample]);
          return sample;
        }}
      />
    </section>
  );
}
