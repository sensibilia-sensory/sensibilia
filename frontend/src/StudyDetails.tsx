import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { StudyDetails as Details, Version } from './api';

export function StudyDetails({
  version,
  busy,
  save,
  onDirty,
}: {
  version: Version;
  busy: boolean;
  save: (details: Details) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(version.title);
  const [description, setDescription] = useState(version.description);
  const readOnly = !!version.published_at;
  const dirty = !readOnly && (title !== version.title || description !== version.description);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  return (
    <form
      className="details-form"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await save({ title, description });
        } catch {
          /* Retain form. */
        }
      }}
    >
      <span className="eyebrow">STUDY SETUP</span>
      <h2>Study details</h2>
      <p className="muted">A clear title and description help your team identify this study.</p>
      <fieldset className="editor-fields" disabled={readOnly || busy}>
        <label className="field-label" htmlFor="study-title">
          Study title
        </label>
        <input
          id="study-title"
          required
          maxLength={250}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label className="field-label" htmlFor="study-description">
          Description
        </label>
        <textarea
          id="study-description"
          maxLength={10000}
          rows={6}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Purpose, context, or notes for your research team."
        />
      </fieldset>
      {readOnly ? (
        <div className="info-note">
          These are the details saved with published version {version.version_number}.
        </div>
      ) : (
        <div className="form-actions">
          <span className="muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <button className="button primary" disabled={!dirty || busy}>
            <Save size={16} />
            {busy ? 'Saving…' : 'Save study details'}
          </button>
        </div>
      )}
    </form>
  );
}
