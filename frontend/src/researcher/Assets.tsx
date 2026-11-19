import { useState } from 'react';
import {
  Button,
  DataTable,
  Field,
  FileField,
  PropertyGrid,
  Toolbar,
  dropIndex,
  moveItem,
} from '../ui';
type Asset = components['schemas']['AssetRead'];
import type { components } from '../api-schema';
export function AssetEditor({
  assets,
  ids,
  languages,
  language,
  disabled = false,
  uploadDisabled = false,
  loading = false,
  error = '',
  onChange,
  onUpload,
}: {
  assets: Asset[];
  ids: string[];
  languages: string[];
  language: string;
  disabled?: boolean;
  uploadDisabled?: boolean;
  loading?: boolean;
  error?: string;
  onChange: (ids: string[]) => void;
  onUpload: (data: Omit<components['schemas']['AssetUpload'], 'revision_hash'>) => Promise<void>;
}) {
  const [file, setFile] = useState<File>();
  const [name, setName] = useState('');
  const [alt, setAlt] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('');
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setFailure('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('PNG exceeds 5 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parts: string[] = [];
      for (let i = 0; i < bytes.length; i += 8192)
        parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
      await onUpload({
        name,
        alt_text: Object.fromEntries(languages.map((language) => [language, alt[language]])),
        content_base64: btoa(parts.join('')),
      });
      setName('');
      setAlt({});
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Upload failed; inputs retained.');
    } finally {
      setBusy(false);
    }
  };
  const locked = disabled || loading || busy;
  const move = (id: string, delta: number) => {
    const next = [...ids],
      at = next.indexOf(id);
    [next[at], next[at + delta]] = [next[at + delta], next[at]];
    onChange(next);
  };
  return (
    <section className="ui-stack" aria-label="Info images" aria-busy={loading || busy}>
      <h3>Images</h3>
      {loading && <p role="status">Loading version images…</p>}
      {(error || failure) && <p role="alert">{error || failure}</p>}
      {disabled && <p>Published image metadata and references are read-only.</p>}
      <DataTable
        id="info-assets"
        label="Version images"
        reorder={
          locked
            ? undefined
            : {
                canDrag: (a) => ids.includes(a.id),
                onMove: (fromId, toId, position) => {
                  const from = ids.indexOf(fromId),
                    target = ids.indexOf(toId);
                  if (from >= 0 && target >= 0)
                    onChange(moveItem(ids, from, dropIndex(from, target, position)));
                },
              }
        }
        data={assets
          .map((a) => ({ ...a, position: ids.indexOf(a.id) + 1 }))
          // Attached images first, in the order they are shown.
          .sort((a, b) => (a.position || Infinity) - (b.position || Infinity) || 0)}
        getRowId={(a) => a.id}
        selectable={false}
        virtualize={false}
        wide
        columns={[
          { accessorKey: 'name', header: 'Name' },
          { id: 'position', header: 'Order', accessorFn: (a) => a.position || 'Unattached' },
          { accessorKey: 'study_version_id', header: 'Version' },
          { accessorKey: 'media_type', header: 'Type' },
          { id: 'status', header: 'Status', accessorFn: () => 'Immutable' },
          { id: 'owner', header: 'Owner', accessorFn: () => 'Not recorded' },
          { accessorKey: 'created_at', header: 'Created / updated' },
          { accessorKey: 'byte_size', header: 'Bytes' },
          { id: 'dimensions', header: 'Pixels', accessorFn: (a) => a.width + ' × ' + a.height },
          { accessorKey: 'sha256', header: 'SHA-256' },
          {
            id: 'alt',
            header: 'Alt text (' + language + ')',
            accessorFn: (a) => a.alt_text[language] ?? 'Missing',
          },
        ]}
        rowActions={(a) => (
          <div className="ui-inline" role="group" aria-label={'Image actions ' + a.name}>
            <Button
              compact
              disabled={locked}
              onClick={() =>
                onChange(a.position ? ids.filter((id) => id !== a.id) : [...ids, a.id])
              }
            >
              {a.position ? 'Detach' : 'Attach'}
            </Button>
            <Button
              compact
              aria-label={'Move image up ' + a.name}
              disabled={locked || a.position < 2}
              onClick={() => move(a.id, -1)}
            >
              Up
            </Button>
            <Button
              compact
              aria-label={'Move image down ' + a.name}
              disabled={locked || !a.position || a.position === ids.length}
              onClick={() => move(a.id, 1)}
            >
              Down
            </Button>
          </div>
        )}
        emptyText="No version images. Upload a reviewed PNG."
      />
      <PropertyGrid
        sections={[
          {
            title: 'Upload immutable image',
            defaultOpen: !disabled,
            children: (
              <div className="ui-stack">
                <FileField
                  label="Stimulus PNG"
                  disabled={locked}
                  onChange={(f) => {
                    setFile(f);
                    if (f && !name) setName(f.name);
                  }}
                />
                <Field
                  label="Image name"
                  value={name}
                  disabled={locked}
                  onChange={(e) => setName(e.target.value)}
                />
                {languages.map((l) => (
                  <Field
                    key={l}
                    label={'Alt text ' + l}
                    value={alt[l] ?? ''}
                    disabled={locked}
                    onChange={(e) => setAlt({ ...alt, [l]: e.target.value })}
                  />
                ))}
                <Toolbar label="Image upload">
                  <Button
                    variant="primary"
                    disabled={
                      locked ||
                      uploadDisabled ||
                      !file ||
                      !name.trim() ||
                      languages.some((l) => !alt[l]?.trim())
                    }
                    onClick={() => void upload()}
                  >
                    Upload image
                  </Button>
                </Toolbar>
                <p>
                  Up to 50 images / 25 MiB per version. Upload freezes file and alt text;
                  replacement creates a new image. Attach and review the order before release.
                </p>
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
