import type { ReactNode } from 'react';
import { DragList, RowGrip } from './RowDrag';

export interface EditableColumn<T> {
  header: string;
  cell: (row: T, index: number) => ReactNode;
}

/**
 * A plain semantic table whose cells hold live controls. Use it instead of DataTable when cells
 * contain inputs: DataTable rebuilds cell renderers on every render, which remounts an input and
 * drops focus after each keystroke. It has no sorting, filtering or selection. Each column keeps
 * its header and its cell together, so they cannot drift apart.
 */
export function EditableTable<T>({
  label,
  columns,
  rows,
  getRowId,
  onMove,
}: {
  label: string;
  columns: EditableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Rows can be dragged by a grip; `to` is the final index. */
  onMove?: (from: number, to: number) => void;
}) {
  return (
    <section className="ui-data-table ui-data-table--compact" aria-label={label}>
      <div className="ui-table-scroll">
        <table>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {onMove && (
                <th scope="col">
                  <span className="sr-only">Drag to reorder</span>
                </th>
              )}
              {columns.map((column, index) => (
                <th key={index} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <DragList disabled={!onMove} onMove={(from, to) => onMove?.(from, to)}>
            {({ rowProps, gripProps }) => (
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr
                    key={getRowId(row)}
                    data-row-id={getRowId(row)}
                    {...(onMove ? rowProps(rowIndex) : {})}
                  >
                    {onMove && (
                      <td>
                        <RowGrip {...gripProps(rowIndex)} />
                      </td>
                    )}
                    {columns.map((column, index) => (
                      <td key={index}>{column.cell(row, rowIndex)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </DragList>
        </table>
      </div>
    </section>
  );
}
