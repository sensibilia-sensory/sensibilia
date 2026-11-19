import { useId } from 'react';
import type { ReactNode } from 'react';

export function EditorTabs({
  tabs,
  selected,
  select,
  children,
}: {
  tabs: { id: string; label: string }[];
  selected: string;
  select: (id: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <div className="editor-tabs" role="tablist" aria-label="Editor settings">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.id}`}
            aria-controls={`${id}-panel`}
            aria-selected={selected === tab.id}
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = tabs.length - 1;
              else return;
              event.preventDefault();
              select(tabs[next].id);
              document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="editor-panel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${selected}`}
      >
        {children}
      </div>
    </>
  );
}
