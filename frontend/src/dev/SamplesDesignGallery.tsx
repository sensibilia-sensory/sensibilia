import { useState } from 'react';
import { Tabs } from '../ui';
import { SampleTable, DesignTable, type Design } from '../researcher/SamplesDesign';
import type { Sample } from '../shared/flow';
export function SamplesDesignGallery() {
  const [tab, setTab] = useState('samples');
  const samples: Sample[] = Array.from({ length: 20 }, (_, i) => ({
    id: 'sample-' + i,
    study_version_id: 'version-1',
    code: String(100 + i),
    label: 'Private product ' + (i + 1),
    ingredient_tags: i === 0 ? null : i === 1 ? ['nut'] : [],
  }));
  const design: Design = {
    id: 'design-1',
    study_version_id: 'version-1',
    loop_id: 'loop-1',
    settings: { algorithm: 'shuffle', seed: 42, objective: 'Independent randomisation' },
    sequences: Array.from({ length: 24 }, (_, i) =>
      samples
        .slice(i % 20)
        .concat(samples.slice(0, i % 20))
        .map((s) => s.id),
    ),
  };
  return (
    <section
      id="samples-design"
      className="ui-gallery-section"
      aria-label="Samples and design fixtures"
    >
      <h2>Samples and design</h2>
      <Tabs
        label="Sample design fixture states"
        value={tab}
        onChange={setTab}
        tabs={['samples', 'design', 'loading', 'empty', 'error', 'readonly'].map((id) => ({
          id,
          label: id,
          content:
            id === 'design' ? (
              <DesignTable designs={[design]} samples={samples} />
            ) : (
              <SampleTable
                samples={id === 'empty' || id === 'loading' ? [] : samples}
                loading={id === 'loading'}
                error={id === 'error' ? 'Cannot reach laboratory server. Retry read.' : ''}
                readOnly={id === 'readonly'}
              />
            ),
        }))}
      />
    </section>
  );
}
