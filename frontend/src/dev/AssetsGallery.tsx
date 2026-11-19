import { StimulusManifest } from '../researcher/StimulusManifest';
import { AssetEditor } from '../researcher/Assets';
import type { components } from '../api-schema';
type Asset = components['schemas']['AssetRead'];
import { useState } from 'react';
import { Button, FileField, ImageStimulus, Tabs } from '../ui';
export const redPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
export function AssetsGallery() {
  const [view, setView] = useState('ready');
  const [file, setFile] = useState<File>();
  const [ids, setIds] = useState<string[]>([]);
  const fixtures: Asset[] = Array.from({ length: 17 }, (_, i) => ({
    id: 'asset-' + i,
    study_version_id: 'fixture-v1',
    name: 'Stimulus ' + (i + 1),
    alt_text: { en: 'Reviewed square ' + (i + 1) },
    sha256: 'a'.repeat(64),
    media_type: 'image/png',
    byte_size: 69,
    width: 1,
    height: 1,
    url: null,
    created_at: '2026-10-14T12:00:00Z',
  }));
  return (
    <section id="assets-gallery" aria-label="Assets gallery" className="ui-stack">
      <h2>Assets</h2>
      <Tabs
        label="Asset states"
        value={view}
        onChange={setView}
        tabs={['ready', 'editor', 'manifest', 'readonly', 'empty', 'loading', 'error'].map(
          (id) => ({
            id,
            label: id,
            content:
              id === 'editor' ? (
                <AssetEditor
                  assets={fixtures}
                  ids={ids}
                  languages={['en']}
                  language="en"
                  onChange={setIds}
                  onUpload={async () => {}}
                />
              ) : id === 'manifest' ? (
                <StimulusManifest
                  assets={fixtures}
                  flow={{
                    schema_version: 2,
                    languages: ['en'],
                    default_language: 'en',
                    nodes: [
                      {
                        id: 'fixture-info',
                        kind: 'info',
                        title: { en: 'Images' },
                        data: {
                          body: { en: 'Look' },
                          continue_label: { en: 'Continue' },
                          asset_ids: fixtures.map((a) => a.id),
                        },
                      },
                    ],
                  }}
                />
              ) : (
                <div className="ui-stack">
                  <FileField
                    label={'Stimulus file ' + id}
                    disabled={id === 'readonly' || id === 'loading'}
                    onChange={setFile}
                  />
                  {file && <p>{file.name}</p>}
                  {id === 'loading' ? (
                    <p role="status" aria-busy="true">
                      Verifying frozen stimuli…
                    </p>
                  ) : id === 'empty' ? (
                    <p>No images attached.</p>
                  ) : id === 'error' ? (
                    <ImageStimulus
                      src="/assessor/missing-stimulus.png"
                      alt="Unavailable reviewed stimulus"
                    />
                  ) : (
                    <ImageStimulus src={redPng} alt="Reviewed red square" />
                  )}
                  <Button disabled={id === 'readonly' || id === 'loading' || !file}>
                    Upload image
                  </Button>
                </div>
              ),
          }),
        )}
      />
    </section>
  );
}
