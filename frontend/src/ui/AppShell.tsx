import { useEffect, useId, useState, type ReactNode } from 'react';
import { PanelLeft } from 'lucide-react';
import { Link } from '../router';

export interface AppShellProps {
  navigationLabel?: string;
  breadcrumbs: { label: string; href?: string }[];
  navigation: ReactNode;
  children: ReactNode;
  properties?: ReactNode;
}

const narrowQuery = '(max-width: 800px)';
const isNarrow = () => typeof matchMedia === 'function' && matchMedia(narrowQuery).matches;

export function AppShell({
  breadcrumbs,
  navigation,
  children,
  properties,
  navigationLabel = 'Gallery sections',
}: AppShellProps) {
  const navId = useId();
  const [open, setOpen] = useState(() => !isNarrow());
  // Crossing the breakpoint resets the sidebar: pinned on wide screens, a drawer on narrow ones.
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(narrowQuery);
    const sync = () => setOpen(!query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return (
    <div className="ui-shell" data-nav={open ? 'open' : 'closed'}>
      <nav className="ui-nav" id={navId} aria-label={navigationLabel} hidden={!open}>
        {navigation}
      </nav>
      <div className="ui-shell-column">
        <header className="ui-topbar">
          <button
            type="button"
            className="ui-button ui-button--quiet ui-button--icon"
            aria-label={open ? 'Hide navigation' : 'Show navigation'}
            aria-expanded={open}
            aria-controls={navId}
            onClick={() => setOpen(!open)}
          >
            <PanelLeft />
          </button>
          <span className="ui-brand">Sensibilia</span>
          <nav aria-label="Breadcrumb" className="ui-breadcrumb-nav">
            <ol className="ui-breadcrumb">
              {breadcrumbs.map((step, index) => (
                <li key={step.label}>
                  {step.href ? (
                    <Link href={step.href}>{step.label}</Link>
                  ) : (
                    <span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>
                      {step.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </header>
        <div className="ui-shell-body">
          <main className="ui-main" id="main">
            {children}
          </main>
          {properties && <div className="ui-properties">{properties}</div>}
        </div>
      </div>
    </div>
  );
}
