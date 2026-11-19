import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export interface SidePanelProps {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}

export function SidePanel({ title, children, onClose }: SidePanelProps) {
  const titleId = useId();
  return (
    <aside className="ui-side-panel" aria-labelledby={titleId}>
      <div className="ui-panel-title">
        <h2 id={titleId}>{title}</h2>
        {onClose && (
          <Button size="icon" variant="quiet" aria-label={`Close ${title}`} onClick={onClose}>
            <X />
          </Button>
        )}
      </div>
      <div className="ui-panel-body">{children}</div>
    </aside>
  );
}
