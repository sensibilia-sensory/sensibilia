import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useRowDrag } from './reorder';

type Drag = ReturnType<typeof useRowDrag>;

/**
 * Holds the drag state of one list and hands each row its drag props. A wrapper (not a bare hook)
 * so that code that renders lists inside a recursive function can use it too.
 */
export function DragList({
  children,
  ...options
}: Parameters<typeof useRowDrag>[0] & { children: (drag: Drag) => ReactNode }) {
  return <>{children(useRowDrag(options))}</>;
}

/** The grip that shows a row can be dragged, and the part of the row that is dragged. Decorative: the up and down buttons are the keyboard route. */
export function RowGrip({
  disabled = false,
  ...drag
}: { disabled?: boolean } & ReturnType<Drag['gripProps']>) {
  return (
    <span className="ui-row-grip" data-disabled={disabled || undefined} {...drag}>
      <GripVertical size={14} aria-hidden="true" />
    </span>
  );
}
