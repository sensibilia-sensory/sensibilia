import { useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui';

const holdMs = 700;

/**
 * The staff control sits in the tablet's top bar. Pressing and holding it for about a second opens
 * the staff status; a tap does nothing, so participants do not open it by accident.
 */
export function StaffButton({ onOpen }: { onOpen: () => void }) {
  const timer = useRef<number>(undefined);
  const start = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(onOpen, holdMs);
  };
  const cancel = () => window.clearTimeout(timer.current);
  return (
    <button
      type="button"
      className="ui-staff-button"
      aria-label="Staff"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start();
      }}
      onKeyUp={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      staff
    </button>
  );
}

/** Staff status, flat at the top of the work area, so it never sits below the participant's task. */
export function StaffPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <section className="ui-staff-panel ui-stack" role="region" aria-label="Staff status">
      {children}
      <Button onClick={onClose}>Close staff status</Button>
    </section>
  );
}

/** Self-contained staff control and panel, for screens without a top bar slot (gallery fixtures). */
export function StaffCorner({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (open) return <StaffPanel onClose={() => setOpen(false)}>{children}</StaffPanel>;
  return (
    <div className="ui-staff-corner">
      <StaffButton onOpen={() => setOpen(true)} />
    </div>
  );
}
