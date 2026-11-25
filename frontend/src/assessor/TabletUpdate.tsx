import { useEffect, useState } from 'react';
import { Button } from '../ui';

/** What the Android tablet app exposes to this page; absent in a browser. */
interface TabletShell {
  offeredVersion(): string;
  installedVersion(): string;
  installUpdate(): void;
}

function shell(): TabletShell | undefined {
  return (window as unknown as { SensibiliaTablet?: TabletShell }).SensibiliaTablet;
}

/** The newer tablet app version the server offers, rechecked every few seconds; '' for none. */
export function useOfferedVersion() {
  const read = () => {
    try {
      return shell()?.offeredVersion() ?? '';
    } catch {
      return '';
    }
  };
  const [offered, setOffered] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setOffered(read()), 5000);
    return () => clearInterval(timer);
  }, []);
  return offered;
}

/**
 * A staff line on screens between assessments (waiting, handover): a newer tablet app is on the
 * server, one tap installs it. Renders nothing in a browser or when the app is current. Never shown
 * during an assessment.
 */
export function TabletUpdate({ offered: given }: { offered?: string }) {
  const polled = useOfferedVersion();
  const offered = given ?? polled;
  const [started, setStarted] = useState(false);
  if (!offered) return null;
  let installed = '';
  try {
    installed = shell()?.installedVersion() ?? '';
  } catch {
    installed = '';
  }
  return (
    <div className="ui-stack" role="group" aria-label="Tablet app update">
      <p>
        Staff: tablet app {offered} is available
        {installed ? ' (this tablet has ' + installed + ')' : ''}. The tablet restarts by itself and
        stays set up.
      </p>
      <Button
        disabled={started}
        onClick={() => {
          setStarted(true);
          shell()?.installUpdate();
          // The shell shows its own progress; allow a retry if it reports a problem.
          setTimeout(() => setStarted(false), 15000);
        }}
      >
        Update tablet app
      </Button>
    </div>
  );
}
