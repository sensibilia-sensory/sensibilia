import { useEffect, useState } from 'react';
import { Button } from './Button';
export function ImageStimulus({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setStatus('loading'), [src]);
  return (
    <div className="ui-stack">
      {status === 'loading' && <p role="status">Loading stimulus…</p>}
      {status === 'error' && (
        <>
          <p role="alert">Stimulus could not be displayed. Ask staff before continuing.</p>
          <Button
            onClick={() => {
              setStatus('loading');
              setAttempt((n) => n + 1);
            }}
          >
            Retry image
          </Button>
        </>
      )}
      <img
        key={src + attempt}
        className="ui-stimulus"
        src={src}
        alt={alt}
        width={width}
        height={height}
        hidden={status !== 'ready'}
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
    </div>
  );
}
