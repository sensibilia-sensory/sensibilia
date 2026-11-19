import { useEffect, useState } from 'react';
import type { Sample } from './api';

export function SamplePanel({
  samples,
  readOnly,
  busy,
  add,
  onDirty,
}: {
  samples: Sample[];
  readOnly: boolean;
  busy: boolean;
  add: (code: string, label: string) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => {
    onDirty(Boolean(code || label));
    return () => onDirty(false);
  }, [code, label, onDirty]);
  return (
    <section className="sample-panel authoring-workbench">
      <div className="workbench-toolbar">
        <h2>Coded samples</h2>
        <span className="field-help">
          Product names are visible to researchers; assessors see blind codes.
        </span>
      </div>
      <div className="editor-panel">
        <table className="sample-table">
          <thead>
            <tr>
              <th>Blind code</th>
              <th>Product / preparation label</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample) => (
              <tr key={sample.id}>
                <td>{sample.code}</td>
                <td>{sample.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!samples.length && (
          <p className="field-help">
            Add the products used in your tests. Flash profiling, Napping and discrimination tests
            require at least two.
          </p>
        )}
        {!readOnly && (
          <form
            className="sample-add"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await add(code, label);
                setCode('');
                setLabel('');
              } catch {
                /* Workspace retains and displays error. */
              }
            }}
          >
            <label className="field-label">
              Blind sample code
              <input
                required
                pattern="[A-Za-z0-9_\-]+( [A-Za-z0-9_\-]+)*"
                title="Letters, digits, - and _; single spaces between words"
                maxLength={40}
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <label className="field-label">
              Product label
              <input
                required
                maxLength={250}
                value={label}
                disabled={busy}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy || !code.trim() || !label.trim()}>
              Add sample
            </button>
          </form>
        )}
        <p className="field-help">
          Triangle, duo-trio and 2-AFC servings receive fresh, distinct three-digit codes for each
          session, including repeated products. These catalog codes are used for the other methods.
        </p>
      </div>
    </section>
  );
}
