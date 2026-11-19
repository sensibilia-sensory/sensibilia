import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from './Button';
import { Toolbar } from './Toolbar';
import { RowGrip } from './RowDrag';
import { useRowDrag, type RowDrop } from './reorder';

export interface DataTableProps<T> {
  id: string;
  label: string;
  data: T[];
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string;
  rowActions?: (row: T) => ReactNode;
  onActivate?: (row: T) => void;
  initialSelection?: RowSelectionState;
  selectable?: boolean;
  virtualize?: boolean;
  compact?: boolean;
  wide?: boolean;
  /** Room for three row actions in the Actions column. */
  wideActions?: boolean;
  emptyText?: string;
  /**
   * Rows can be dragged by a grip. `onMove` says which row was released on which row
   * and on which side; `canDrag` limits it to some rows. Off while the table is sorted or filtered,
   * since the shown order is then not the stored order. Buttons stay as the keyboard route.
   */
  reorder?: {
    onMove: (fromId: string, toId: string, position: RowDrop) => void;
    canDrag?: (row: T) => boolean;
  };
}

function SelectionCheckbox({
  label,
  checked,
  mixed = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      className="ui-checkbox"
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
    />
  );
}

/** Native table semantics; virtual spacers use SVG geometry rather than inline spacing styles. */
/** Mark a column with `meta: technical` to hide identifiers until the table's toggle is used. */
export const technical = { technical: true };
const isTechnical = <T,>(c: ColumnDef<T>) =>
  !!(c.meta as { technical?: boolean } | undefined)?.technical;

export function DataTable<T>({
  id,
  label,
  data,
  columns,
  getRowId,
  rowActions,
  onActivate,
  initialSelection = {},
  selectable = false,
  virtualize = true,
  compact = false,
  wide = false,
  wideActions = false,
  emptyText = 'No records.',
  reorder,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selection, setSelection] = useState<RowSelectionState>(initialSelection);
  const [filter, setFilter] = useState('');
  const [showTechnical, setShowTechnical] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const pendingFocus = useRef(false);
  const [rowHeight, setRowHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const tokens = getComputedStyle(document.documentElement);
    setRowHeight(parseFloat(tokens.getPropertyValue('--h-row')));
    setHeaderHeight(parseFloat(tokens.getPropertyValue('--h-header')));
  }, []);

  const completeColumns = useMemo<ColumnDef<T>[]>(
    () => [
      ...(selectable
        ? [
            {
              id: 'selection',
              header: ({ table }) => (
                <SelectionCheckbox
                  label={`Select all ${label}`}
                  checked={table.getIsAllRowsSelected()}
                  mixed={table.getIsSomeRowsSelected()}
                  onChange={() => table.toggleAllRowsSelected(!table.getIsAllRowsSelected())}
                />
              ),
              cell: ({ row }) => (
                <SelectionCheckbox
                  label={`Select ${row.id}`}
                  checked={row.getIsSelected()}
                  onChange={() => row.toggleSelected()}
                />
              ),
              enableSorting: false,
              enableGlobalFilter: false,
            } satisfies ColumnDef<T>,
          ]
        : []),
      ...columns.filter((c) => showTechnical || !isTechnical(c)),
      ...(rowActions
        ? [
            {
              id: 'actions',
              header: 'Actions',
              cell: ({ row }) => rowActions(row.original),
              enableSorting: false,
              enableGlobalFilter: false,
            } satisfies ColumnDef<T>,
          ]
        : []),
    ],
    [columns, rowActions, label, selectable, showTechnical],
  );
  const table = useReactTable({
    data,
    columns: completeColumns,
    getRowId,
    state: { sorting, rowSelection: selection, globalFilter: filter },
    onSortingChange: setSorting,
    onRowSelectionChange: setSelection,
    onGlobalFilterChange: setFilter,
    enableRowSelection: true,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const rows = table.getRowModel().rows;
  const reorderable = Boolean(reorder) && !sorting.length && !filter;
  const drag = useRowDrag({
    disabled: !reorderable,
    canDrag: (index) => (rows[index] ? (reorder?.canDrag?.(rows[index].original) ?? true) : false),
    onMove: (from, _to, { target, position }) =>
      reorder?.onMove(rows[from].id, rows[target].id, position),
  });
  const isVirtual = virtualize && rows.length > 200 && rowHeight > 0;
  const virtualizer = useVirtualizer({
    count: rows.length,
    enabled: isVirtual,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index].id,
    overscan: 8,
    scrollMargin: headerHeight,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const visibleRows = isVirtual
    ? virtualItems.map((item) => ({ row: rows[item.index], index: item.index }))
    : rows.map((row, index) => ({ row, index }));
  const topGap = isVirtual && virtualItems.length ? virtualItems[0].start - headerHeight : 0;
  const bottomGap =
    isVirtual && virtualItems.length
      ? virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1].end - headerHeight)
      : 0;
  useEffect(() => {
    if (pendingFocus.current && focusedId && rowRefs.current.has(focusedId)) {
      rowRefs.current.get(focusedId)?.focus({ preventScroll: isVirtual });
      pendingFocus.current = false;
    }
  });
  const tabStop = rows.some((row) => row.id === focusedId) ? focusedId : rows[0]?.id;
  const colSpan = completeColumns.length + (reorder ? 1 : 0);
  return (
    <section
      className={`ui-data-table ${compact ? 'ui-data-table--compact' : ''} ${isVirtual ? 'ui-data-table--virtual' : ''} ${wide ? 'ui-data-table--wide' : ''} ${wideActions ? 'ui-data-table--wide-actions' : ''}`}
      data-testid={id}
      aria-label={label}
    >
      <Toolbar
        label={`${label} filters`}
        filter={
          <>
            <label className="ui-filter-label" htmlFor={`${id}-filter`}>
              Filter
            </label>
            <input
              className="ui-control ui-search"
              id={`${id}-filter`}
              type="search"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                scrollRef.current?.scrollTo(0, 0);
              }}
              placeholder={`Search ${label.toLowerCase()}`}
            />
          </>
        }
        secondary={
          <>
            {columns.some(isTechnical) && (
              <Button compact onClick={() => setShowTechnical(!showTechnical)}>
                {showTechnical ? 'Hide technical IDs' : 'Show technical IDs'}
              </Button>
            )}
            <span className="ui-hint" aria-live="polite">
              {rows.length} rows
              {selectable
                ? ' · ' +
                  Object.keys(selection).filter((key) => selection[key]).length +
                  ' selected'
                : ''}
            </span>
          </>
        }
      />
      <div
        className="ui-table-scroll"
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label={`${label} scroll area`}
      >
        <table aria-rowcount={isVirtual ? rows.length + 1 : undefined}>
          <caption className="sr-only">{label}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {reorder && (
                  <th scope="col" className="ui-col-grip">
                    <span className="sr-only">Drag to reorder</span>
                  </th>
                )}
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className={`ui-col-${header.column.id}`}
                    aria-sort={
                      header.column.getCanSort()
                        ? header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        className="ui-sort"
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() &&
                          (header.column.getIsSorted() === 'asc' ? (
                            <ArrowUp aria-hidden="true" />
                          ) : (
                            <ArrowDown aria-hidden="true" />
                          ))}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {topGap > 0 && (
              <tr className="ui-virtual-spacer" aria-hidden="true">
                <td colSpan={colSpan}>
                  <svg width="0" height={topGap} />
                </td>
              </tr>
            )}
            {visibleRows.map(({ row, index }) => (
              <tr
                key={row.id}
                data-row-id={row.id}
                data-selected={row.getIsSelected() || undefined}
                {...(reorder ? drag.rowProps(index) : {})}
                aria-rowindex={isVirtual ? index + 2 : undefined}
                tabIndex={row.id === tabStop ? 0 : -1}
                ref={(element) => {
                  if (element) rowRefs.current.set(row.id, element);
                  else rowRefs.current.delete(row.id);
                }}
                onFocus={() => setFocusedId(row.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onActivate?.(row.original);
                    return;
                  }
                  let next = index;
                  if (event.key === 'ArrowDown') next = Math.min(index + 1, rows.length - 1);
                  else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = rows.length - 1;
                  else return;
                  event.preventDefault();
                  pendingFocus.current = true;
                  setFocusedId(rows[next].id);
                  if (isVirtual) virtualizer.scrollToIndex(next, { align: 'auto' });
                  else rowRefs.current.get(rows[next].id)?.focus();
                }}
              >
                {reorder && (
                  <td className="ui-col-grip">
                    {(reorder.canDrag?.(row.original) ?? true) && (
                      <span
                        title={reorderable ? undefined : 'Clear the sort and filter to drag rows'}
                      >
                        <RowGrip disabled={!reorderable} {...drag.gripProps(index)} />
                      </span>
                    )}
                  </td>
                )}
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={`ui-col-${cell.column.id}`}>
                    <div
                      className="ui-cell"
                      title={
                        typeof cell.getValue() === 'string' || typeof cell.getValue() === 'number'
                          ? String(cell.getValue())
                          : undefined
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            {bottomGap > 0 && (
              <tr className="ui-virtual-spacer" aria-hidden="true">
                <td colSpan={colSpan}>
                  <svg width="0" height={bottomGap} />
                </td>
              </tr>
            )}
            {!rows.length && (
              <tr>
                <td colSpan={colSpan}>{emptyText}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
