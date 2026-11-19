import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
/** Nonmodal properties popover; Escape/Close restore focus, outside clicks dismiss. */
export function Popover({
  label,
  summary,
  children,
  disabled = false,
  closeOnSelect = false,
  align = 'left',
  defaultOpen = false,
}: {
  label: string;
  summary?: string;
  children: ReactNode;
  disabled?: boolean;
  /** Close after a button marked `ui-popover-item` is used (menus). */
  closeOnSelect?: boolean;
  align?: 'left' | 'right';
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen),
    id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('select,input,button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as globalThis.Node) &&
        !trigger.current?.contains(event.target as globalThis.Node)
      )
        setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);
  return (
    <div className="ui-popover-anchor">
      <Button
        ref={trigger}
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {summary ?? label}
      </Button>
      {open && (
        <div
          ref={panel}
          id={id}
          className="ui-popover ui-stack"
          role="region"
          aria-label={label}
          data-align={align}
          onClick={(e) => {
            if (closeOnSelect && (e.target as HTMLElement).closest('.ui-popover-item')) close();
          }}
        >
          <Button variant="quiet" onClick={close}>
            Close {label}
          </Button>
          {children}
        </div>
      )}
    </div>
  );
}
