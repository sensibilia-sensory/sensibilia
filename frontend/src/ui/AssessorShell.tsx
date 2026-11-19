import type { CSSProperties, ReactNode } from 'react';

/**
 * Tablet frame for every assessor screen: a few pixels of frame around a flat
 * surface, a 56px top bar, one centred column that scrolls, and an optional pinned action bar.
 * Always light (`ui-preview`). It holds layout only; screens supply their content and actions.
 */
export function AssessorShell({
  label,
  centre,
  end,
  progress,
  actions,
  embedded = false,
  children,
}: {
  /** Accessible name of the page landmark. */
  label?: string;
  /** Centre of the top bar, for example the sample position and code. */
  centre?: ReactNode;
  /** End of the top bar, for example the press-and-hold staff control. */
  end?: ReactNode;
  /** Position within a sample loop; drawn as a thin line under the top bar. */
  progress?: { value: number; max: number };
  /** Pinned bar under the work area. The one primary action of the screen sits here. */
  actions?: ReactNode;
  /** True inside the researcher gallery or a preview, where the page already has a main landmark. */
  embedded?: boolean;
  children: ReactNode;
}) {
  const Surface = embedded ? 'div' : 'main';
  const share =
    progress && progress.max > 0 ? Math.min(100, (progress.value / progress.max) * 100) : undefined;
  return (
    <div className="ui-preview ui-assessor">
      <Surface className="ui-assessor-surface" aria-label={label}>
        <header className="ui-assessor-bar" data-layout="allowed-grid">
          <span className="ui-assessor-brand">Sensibilia</span>
          <div className="ui-assessor-bar-centre">{centre}</div>
          <div className="ui-assessor-bar-end">{end}</div>
          {share !== undefined && (
            <div
              className="ui-assessor-progress"
              role="progressbar"
              aria-label="Sample progress"
              aria-valuemin={0}
              aria-valuemax={progress!.max}
              aria-valuenow={progress!.value}
              style={{ '--progress': share } as CSSProperties}
            />
          )}
        </header>
        <div className="ui-assessor-work">
          <div className="ui-assessor-column ui-stack">{children}</div>
        </div>
        {actions && (
          <footer className="ui-assessor-actions">
            <div className="ui-assessor-actions-inner">{actions}</div>
          </footer>
        )}
      </Surface>
    </div>
  );
}
