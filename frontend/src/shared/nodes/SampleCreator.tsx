import { useState } from 'react';
import { Button, Field, PropertyGrid, Toolbar } from '../../ui';
import type { components } from '../../api-schema';
import type { Sample } from '../flow';

/** Create a sample in place; used wherever a step needs samples that do not exist yet. */
export function SampleCreator({
  title,
  disabled = false,
  busy: outerBusy = false,
  onCreate,
  onCreated,
  defaultOpen = true,
}: {
  title: string;
  disabled?: boolean;
  busy?: boolean;
  onCreate: (payload: components['schemas']['SampleCreate']) => Promise<Sample>;
  onCreated: (sample: Sample) => void;
  defaultOpen?: boolean;
}) {
  const [code, setCode] = useState(''),
    [label, setLabel] = useState(''),
    [tags, setTags] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const off = disabled || busy || outerBusy;
  return (
    <>
      <PropertyGrid
        sections={[
          {
            title,
            defaultOpen,
            children: (
              <>
                <Field
                  label="Sample code"
                  value={code}
                  disabled={off}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Field
                  label="Private label"
                  value={label}
                  disabled={off}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <Field
                  label="Ingredient tags"
                  value={tags}
                  disabled={off}
                  hint="Comma-separated exact tags. Empty with reviewed checked means no mapped ingredients."
                  onChange={(e) => setTags(e.target.value)}
                />
                <Field
                  label="Tags reviewed"
                  kind="checkbox"
                  checked={reviewed}
                  disabled={off}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <Toolbar>
                  <Button
                    disabled={off || !code || !label || !reviewed}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const sample = await onCreate({
                          code,
                          label,
                          ingredient_tags: [
                            ...new Set(
                              tags
                                .split(',')
                                .map((t) => t.trim())
                                .filter(Boolean),
                            ),
                          ],
                        });
                        onCreated(sample);
                        setCode('');
                        setLabel('');
                        setTags('');
                        setReviewed(false);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Sample creation failed');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Create and include sample
                  </Button>
                </Toolbar>
              </>
            ),
          },
        ]}
      />
      {busy && (
        <p role="status" aria-busy="true">
          Creating sample…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
