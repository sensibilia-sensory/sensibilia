import type { ReactNode } from 'react';

export interface PropertyGridProps {
  sections: { title: string; children: ReactNode; defaultOpen?: boolean }[];
}

export function PropertyGrid({ sections }: PropertyGridProps) {
  return (
    <div className="ui-property-grid">
      {sections.map((section) => (
        <details className="ui-property-section" key={section.title} open={section.defaultOpen}>
          <summary>{section.title}</summary>
          <div className="ui-stack">{section.children}</div>
        </details>
      ))}
    </div>
  );
}
