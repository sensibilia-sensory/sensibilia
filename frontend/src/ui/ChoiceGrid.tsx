import { useId, type ReactNode } from 'react';

export interface ChoiceGridRow {
  id: string;
  label: string;
  value?: string;
  /** Shown under the row label, for example "Explicitly skipped". */
  note?: ReactNode;
  /** Last cell of the row, for example a skip button. */
  after?: ReactNode;
}

/**
 * A real grid: one row per question, one column per scale point (named in the header), one radio
 * button per cell. A scale that names only its ends is not a table: see ChoiceScale.
 */
export function ChoiceGrid({
  label,
  columns,
  rows,
  onChange,
  disabled = false,
}: {
  label: string;
  columns: { value: string; label: string }[];
  rows: ChoiceGridRow[];
  onChange: (rowId: string, value: string) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const extra = rows.some((r) => r.after);
  return (
    <div className="ui-choice-grid-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="ui-choice-grid">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <td />
            {columns.map((column) => (
              <th key={column.value} scope="col">
                {column.label}
              </th>
            ))}
            {extra && (
              <td>
                <span className="sr-only">Other answer</span>
              </td>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                {row.label}
                {row.note}
              </th>
              {columns.map((column) => (
                <td key={column.value}>
                  <label>
                    <input
                      type="radio"
                      name={name + row.id}
                      aria-label={row.label + ', ' + column.label}
                      disabled={disabled}
                      checked={row.value === column.value}
                      onChange={() => onChange(row.id, column.value)}
                    />
                  </label>
                </td>
              ))}
              {extra && <td>{row.after}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
