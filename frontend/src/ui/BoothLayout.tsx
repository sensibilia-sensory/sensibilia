export interface BoothCell {
  id: string;
  label: string;
  row: number;
  column: number;
  state: string;
}
/** Spatial floor layout uses native table geometry; operational records remain in DataTable. */
export function BoothLayout({
  rows,
  columns,
  booths,
  label,
}: {
  rows: number;
  columns: number;
  booths: BoothCell[];
  label: string;
}) {
  return (
    <table className="ui-booth-layout" aria-label={label}>
      <caption>{label}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Row</th>
          {Array.from({ length: columns }, (_, i) => (
            <th key={i} scope="col">
              Position {i + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r} data-row-id={String(r)}>
            <th scope="row" className="sr-only">
              Row {r + 1}
            </th>
            {Array.from({ length: columns }, (_, c) => {
              const b = booths.find((b) => b.row === r + 1 && b.column === c + 1);
              return (
                <td key={c}>
                  {b ? (
                    <div className="ui-booth-cell">
                      <strong>Booth {b.label}</strong>
                      <span>{b.state}</span>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
