import { Button } from './Button';
import { useId, useRef, type ReactNode } from 'react';

export interface TabsProps {
  label: string;
  tabs: {
    id: string;
    label: string;
    content: ReactNode;
    planned?: boolean;
    explanation?: string;
  }[];
  value: string;
  onChange: (id: string) => void;
}

export function Tabs({ label, tabs, value, onChange }: TabsProps) {
  const prefix = useId();
  const activeTabs = tabs.filter((tab) => !tab.planned);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="ui-tabs">
      <div className="ui-tab-list" role="tablist" aria-label={label}>
        {activeTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${prefix}-${tab.id}`}
            aria-selected={tab.id === value}
            aria-controls={`${prefix}-${tab.id}-panel`}
            tabIndex={tab.id === value ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % activeTabs.length;
              else if (event.key === 'ArrowLeft')
                next = (index - 1 + activeTabs.length) % activeTabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = activeTabs.length - 1;
              else return;
              event.preventDefault();
              onChange(activeTabs[next].id);
              buttons.current[next]?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ui-inline ui-wrap">
        {tabs
          .filter((tab) => tab.planned)
          .map((tab) => (
            <Button key={tab.id} variant="planned" compact explanation={tab.explanation}>
              {tab.label}
            </Button>
          ))}
      </div>
      {activeTabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${prefix}-${tab.id}-panel`}
          aria-labelledby={`${prefix}-${tab.id}`}
          hidden={value !== tab.id}
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
