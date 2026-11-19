export type Status = 'published' | 'draft' | 'deprecated' | 'synced' | 'pending';
export interface StatusTextProps {
  status: Status;
}

export function StatusText({ status }: StatusTextProps) {
  return (
    <span className={`ui-status ui-status--${status}`}>
      <span className="ui-status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}
