import { useState, type DragEvent } from 'react';

/** Where a dragged row lands relative to the row it is released on. */
export type RowDrop = 'before' | 'after';

/** Move one item to `to` (its index in the result). Pure; returns the same list when nothing moves. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length)
    return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The index a row dragged from `from` ends up at when released before or after row `target`. */
export function dropIndex(from: number, target: number, position: RowDrop): number {
  const slot = position === 'before' ? target : target + 1;
  return from < slot ? slot - 1 : slot;
}

/**
 * Drag and drop for any list whose order matters. Spread `rowProps(i)` on every row
 * (a `<tr>` or a `<div>`, the drop target) and `gripProps(i)` on a grip inside it (the drag source,
 * so text inside the row stays selectable). `onMove(from, to)` gets the final index. Releasing a row
 * where it already is does nothing. Native drag events work with a mouse only, so the up and down
 * buttons stay as the keyboard and screen-reader route.
 */
export function useRowDrag({
  onMove,
  disabled = false,
  canDrag = () => true,
}: {
  /** `to` is the final index; `drop` says which row it was released on, and on which side. */
  onMove: (from: number, to: number, drop: { target: number; position: RowDrop }) => void;
  disabled?: boolean;
  /** Rows that cannot be moved or dropped on (for example samples left out of a loop). */
  canDrag?: (index: number) => boolean;
}) {
  const [dragging, setDragging] = useState<number>();
  const [over, setOver] = useState<{ index: number; position: RowDrop }>();
  const end = () => {
    setDragging(undefined);
    setOver(undefined);
  };
  const rowProps = (index: number) => ({
    'data-reorder-row': '',
    'data-dragging': index === dragging || undefined,
    'data-drop': over?.index === index ? over.position : undefined,
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging === undefined || !canDrag(index)) return;
      const box = e.currentTarget.getBoundingClientRect();
      const position: RowDrop = (e.clientY - box.top) / box.height < 0.5 ? 'before' : 'after';
      // Dropping where the row already is changes nothing, so it shows no target.
      if (dropIndex(dragging, index, position) === dragging) {
        if (over) setOver(undefined);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over?.index !== index || over.position !== position) setOver({ index, position });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      // Decide from this event, not from state set by an earlier dragover (a fast drop can arrive
      // before React has re-rendered).
      if (dragging === undefined || !canDrag(index)) return;
      const box = e.currentTarget.getBoundingClientRect();
      const position: RowDrop = (e.clientY - box.top) / box.height < 0.5 ? 'before' : 'after';
      const to = dropIndex(dragging, index, position);
      e.preventDefault();
      if (to !== dragging) onMove(dragging, to, { target: index, position });
      end();
    },
  });
  const gripProps = (index: number) => ({
    draggable: (!disabled && canDrag(index)) || undefined,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      if (disabled || !canDrag(index)) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      // Show the whole row under the pointer, not just the grip.
      const row = e.currentTarget.closest('[data-reorder-row]');
      if (row) e.dataTransfer.setDragImage(row, 0, 0);
      setDragging(index);
    },
    onDragEnd: end,
  });
  return { rowProps, gripProps };
}
