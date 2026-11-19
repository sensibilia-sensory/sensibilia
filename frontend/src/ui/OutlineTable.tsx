import { useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { Button } from './Button';

export type OutlineDropPosition = 'before' | 'after' | 'inside';

export interface OutlineRow {
  id: string;
  title: string;
  kind: string;
  method: string;
  version: string;
  state: string;
  guard: string;
  otherwise: string;
  number?: string;
  depth?: number;
  ancestors?: string[];
  container?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}
/** Ordered outline: display order is execution order; never sorted. */
export function OutlineTable({
  rows,
  onSelect,
  onMove,
  onDrop,
  canDrop,
  readOnly = false,
  selectedId,
  targetId,
}: {
  rows: OutlineRow[];
  onSelect: (id: string) => void;
  onMove?: (id: string, direction: -1 | 1) => void;
  /** Drag and drop: the dragged row was released on `targetId` at `position`. Buttons stay the keyboard route. */
  onDrop?: (id: string, targetId: string, position: OutlineDropPosition) => void;
  canDrop?: (id: string, targetId: string, position: OutlineDropPosition) => boolean;
  readOnly?: boolean;
  selectedId?: string;
  targetId?: string;
}) {
  const [focused, setFocused] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<{ id: string; position: OutlineDropPosition }>();
  const draggable = Boolean(onDrop) && !readOnly;
  const positionAt = (e: React.DragEvent<HTMLTableRowElement>, container?: boolean) => {
    const box = e.currentTarget.getBoundingClientRect(),
      y = (e.clientY - box.top) / box.height;
    return container
      ? y < 0.25
        ? 'before'
        : y > 0.85
          ? 'after'
          : 'inside'
      : y < 0.5
        ? 'before'
        : 'after';
  };
  const endDrag = () => {
    setDragging(undefined);
    setOver(undefined);
  };
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const visibleRows = rows.filter((r) => !r.ancestors?.some((id) => collapsed.includes(id)));
  const refs = useRef(new Map<string, HTMLTableRowElement>());
  return (
    <section className="ui-data-table" aria-label="Flow outline" data-testid="flow-outline">
      <div
        className="ui-table-scroll"
        role="region"
        aria-label="Flow outline scroll area"
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">Flow outline</caption>
          <thead>
            <tr>
              {['No.', 'Title', 'Type', 'Method', 'Show if', 'Otherwise', 'Actions'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr
                key={row.id}
                data-row-id={row.id}
                data-selected={row.id === selectedId || undefined}
                data-dragging={row.id === dragging || undefined}
                data-drop={over?.id === row.id ? over.position : undefined}
                draggable={draggable || undefined}
                onDragStart={(e) => {
                  if (!draggable) return;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', row.title);
                  setDragging(row.id);
                }}
                onDragOver={(e) => {
                  if (!dragging) return;
                  const position = positionAt(e, row.container);
                  if (canDrop && !canDrop(dragging, row.id, position)) {
                    if (over) setOver(undefined);
                    return;
                  }
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (over?.id !== row.id || over.position !== position)
                    setOver({ id: row.id, position });
                }}
                onDrop={(e) => {
                  // Decide from this event, not from state set by an earlier dragover: a fast drop
                  // can arrive before React has re-rendered.
                  if (!dragging) return;
                  const position = positionAt(e, row.container);
                  if (canDrop && !canDrop(dragging, row.id, position)) return;
                  e.preventDefault();
                  onDrop?.(dragging, row.id, position);
                  endDrag();
                }}
                onDragEnd={endDrag}
                tabIndex={row.id === (focused ?? visibleRows[0]?.id) ? 0 : -1}
                ref={(el) => {
                  if (el) refs.current.set(row.id, el);
                  else refs.current.delete(row.id);
                }}
                onFocus={() => setFocused(row.id)}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('button')) onSelect(row.id);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSelect(row.id);
                    return;
                  }
                  if (['ArrowLeft', 'ArrowRight'].includes(e.key) && row.container) {
                    e.preventDefault();
                    setCollapsed(
                      e.key === 'ArrowLeft'
                        ? [...collapsed, row.id]
                        : collapsed.filter((id) => id !== row.id),
                    );
                    return;
                  }
                  const index =
                    e.key === 'ArrowDown'
                      ? Math.min(i + 1, visibleRows.length - 1)
                      : e.key === 'ArrowUp'
                        ? Math.max(0, i - 1)
                        : e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? visibleRows.length - 1
                            : -1;
                  if (index >= 0) {
                    e.preventDefault();
                    refs.current.get(visibleRows[index].id)?.focus();
                  }
                }}
              >
                {[
                  row.number ?? String(i + 1),
                  row.title,
                  row.kind,
                  row.method,
                  row.guard,
                  row.otherwise,
                ].map((text, j) => (
                  <td key={j}>
                    <div
                      className={j === 1 ? 'ui-cell ui-outline-title' : 'ui-cell'}
                      title={text}
                      style={
                        j === 1
                          ? {
                              marginLeft:
                                'calc(var(--sp-outline-indent) * ' + (row.depth ?? 0) + ')',
                            }
                          : undefined
                      }
                    >
                      {j === 0 && draggable && (
                        <GripVertical
                          className="ui-outline-grip"
                          size={14}
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      )}
                      {j === 1 && row.container && (
                        <Button
                          size="icon"
                          variant="quiet"
                          aria-label={
                            (collapsed.includes(row.id) ? 'Expand ' : 'Collapse ') + row.title
                          }
                          aria-expanded={!collapsed.includes(row.id)}
                          onClick={() =>
                            setCollapsed(
                              collapsed.includes(row.id)
                                ? collapsed.filter((id) => id !== row.id)
                                : [...collapsed, row.id],
                            )
                          }
                        >
                          {collapsed.includes(row.id) ? '›' : '⌄'}
                        </Button>
                      )}
                      {text}
                      {j === 0 &&
                        row.id === selectedId &&
                        targetId &&
                        visibleRows.findIndex((r) => r.id === targetId) > i && (
                          <svg
                            className="ui-outline-gutter"
                            aria-hidden="true"
                            style={{
                              height:
                                'calc(var(--h-row) * ' +
                                (visibleRows.findIndex((r) => r.id === targetId) - i + 1) +
                                ')',
                            }}
                            viewBox={
                              '0 0 1 ' + (visibleRows.findIndex((r) => r.id === targetId) - i + 1)
                            }
                            preserveAspectRatio="none"
                          >
                            <path
                              d={
                                'M .8 .5 C .1 .5 .1 ' +
                                (visibleRows.findIndex((r) => r.id === targetId) - i + 0.5) +
                                ' .8 ' +
                                (visibleRows.findIndex((r) => r.id === targetId) - i + 0.5)
                              }
                              fill="none"
                              stroke="currentColor"
                              vectorEffect="non-scaling-stroke"
                            />
                          </svg>
                        )}
                    </div>
                  </td>
                ))}
                <td>
                  <div className="ui-inline">
                    <Button compact onClick={() => onSelect(row.id)}>
                      Edit
                    </Button>
                    {onMove && (
                      <>
                        <Button
                          size="icon"
                          aria-label={'Move ' + row.title + ' up'}
                          disabled={readOnly || !(row.canMoveUp ?? i > 0)}
                          onClick={() => onMove(row.id, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="icon"
                          aria-label={'Move ' + row.title + ' down'}
                          disabled={readOnly || !(row.canMoveDown ?? i < visibleRows.length - 1)}
                          onClick={() => onMove(row.id, 1)}
                        >
                          ↓
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7}>No steps yet. Use Add step.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
