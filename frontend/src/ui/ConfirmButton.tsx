import { useState, type ReactNode } from 'react';
import { Button } from './Button';

/** Two-step button for actions that cannot be undone: the first press asks, the second does it. */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  disabled = false,
  compact = false,
  variant = 'default',
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  compact?: boolean;
  variant?: 'default' | 'danger';
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button
        compact={compact}
        variant={variant}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {children}
      </Button>
    );
  return (
    <span className="ui-inline">
      <Button
        compact={compact}
        variant="danger"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button compact={compact} onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
