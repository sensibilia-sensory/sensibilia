import type { ReactNode } from 'react';

export interface ToolbarProps {
  children?: ReactNode;
  filter?: ReactNode;
  secondary?: ReactNode;
  label?: string;
}

export function Toolbar({ children, filter, secondary, label = 'Actions' }: ToolbarProps) {
  return (
    <div className="ui-toolbar" role="group" aria-label={label}>
      <div className="ui-inline">{children}</div>
      {filter && <div className="ui-inline">{filter}</div>}
      <div className="ui-inline ui-toolbar-secondary">{secondary}</div>
    </div>
  );
}
