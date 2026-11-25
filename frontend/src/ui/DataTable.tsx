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
  /** Extra controls for the table's toolbar, such as a column chooser. */
  tools?: ReactNode;
  /**
   * Columns can be widened or narrowed by dragging the edge of their header (double-click the
   * edge to fit the content). The widths are kept in this browser under this key.
   */
  resizable?: string;
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

const MIN_WIDTH = 40;
const NEW_COLUMN_WIDTH = 120;

/** Column widths the viewer set, kept per browser under `key`; empty until a column is resized. */
function useColumnWidths(key: string | undefined) {
  const storage = 'sensibilia.table-widths.' + key;
  const [sizes, setSizes] = useState<Record<string, number>>(() => {
    if (!key) return {};
    try {
      const saved = JSON.parse(localStorage.getItem(storage) ?? '') as unknown;
      return saved && typeof saved === 'object' ? (saved as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const table = useRef<HTMLTableElement>(null);
  const save = (next: Record<string, number>) => {
    try {
      if (Object.keys(next).length) localStorage.setItem(storage, JSON.stringify(next));
      else localStorage.removeItem(storage);
    } catch {
      /* not remembered; it still works until reload */
    }
  };
  /** Every header's current width, so resizing one column leaves the others where they are. */
  const measure = () => {
    const now: Record<string, number> = { ...sizes };
    table.current
      ?.querySelectorAll<HTMLTableCellElement>('thead th[data-column]')
      .forEach((th) => (now[th.dataset.column!] = th.getBoundingClientRect().width));
    return now;
  };
  const active = Object.keys(sizes).length > 0;
  return {
    table,
    active,
    of: (id: string) => sizes[id] ?? NEW_COLUMN_WIDTH,
    measure,
    set: (next: Record<string, number>, keep = false) => {
      setSizes(next);
      if (keep) save(next);
    },
    /** As wide as the column's widest content, like double-clicking a column edge in a sheet. */
    fit: (id: string) => {
      const cells = table.current?.querySelectorAll<HTMLElement>(
        `th[data-column="${CSS.escape(id)}"], td.ui-col-${CSS.escape(id)} > .ui-cell`,
      );
      let widest = MIN_WIDTH;
      cells?.forEach((cell) => {
        const style = getComputedStyle(cell.closest('th,td') ?? cell);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const content = Array.from(cell.children).reduce(
          (sum, child) => sum + (child as HTMLElement).scrollWidth,
          0,
        );
        widest = Math.max(widest, Math.max(cell.scrollWidth, content) + padding + 1);
      });
      const next = { ...measure(), [id]: Math.ceil(widest) };
      setSizes(next);
      save(next);
    },
    reset: () => {
      setSizes({});
      save({});
    },
  };
}

/** The draggable edge of a column header; arrow keys resize too, double-click fits the content. */
function ColumnEdge({
  column,
  name,
  widths,
}: {
  column: string;
  name: string;
  widths: ReturnType<typeof useColumnWidths>;
}) {
  const drag = useRef<{ x: number; base: Record<string, number> } | undefined>(undefined);
  const edge = useRef<HTMLSpanElement>(null);
  // The header's shown width, so assistive technology can announce it.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const th = edge.current?.parentElement;
    if (!th) return;
    const observer = new ResizeObserver(() => setWidth(Math.round(th.offsetWidth)));
    observer.observe(th);
    return () => observer.disconnect();
  }, []);
  const resize = (base: Record<string, number>, by: number, keep: boolean) =>
    widths.set({ ...base, [column]: Math.max(MIN_WIDTH, base[column] + by) }, keep);
  return (
    <span
      ref={edge}
      className="ui-col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={'Resize column ' + name}
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={10000}
      tabIndex={0}
      title="Drag to resize; double-click to fit"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, base: widths.measure() };
      }}
      onPointerMove={(e) => {
        if (drag.current) resize(drag.current.base, e.clientX - drag.current.x, false);
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        resize(drag.current.base, e.clientX - drag.current.x, true);
        drag.current = undefined;
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        widths.fit(column);
      }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        resize(widths.measure(), step, true);
      }}
    />
  );
}

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
  tools,
  resizable,
  reorder,
}: DataTableProps<T>) {
  const widths = useColumnWidths(resizable);
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
            {tools}
            {widths.active && (
              <Button compact onClick={widths.reset}>
                Reset column widths
              </Button>
            )}
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
        <table
          aria-rowcount={isVirtual ? rows.length + 1 : undefined}
          ref={widths.table}
          // Once a column is resized every column has a width, and the table is as wide as they are.
          style={
            widths.active
              ? {
                  width: table.getVisibleLeafColumns().reduce((sum, c) => sum + widths.of(c.id), 0),
                }
              : undefined
          }
        >
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
                    data-column={header.column.id}
                    className={`ui-col-${header.column.id}`}
                    style={widths.active ? { width: widths.of(header.column.id) } : undefined}
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
                    {resizable && (
                      <ColumnEdge
                        column={header.column.id}
                        name={
                          typeof header.column.columnDef.header === 'string'
                            ? header.column.columnDef.header
                            : header.column.id
                        }
                        widths={widths}
                      />
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
