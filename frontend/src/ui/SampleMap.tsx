import { useId, useRef, useState } from 'react';
import { Button } from './Button';
export type MapPoint = { x: number; y: number; description: string };
/** Blank 60 × 40 map; geometry is domain data, controls use touch tokens. */
export function SampleMap({
  samples,
  points,
  onChange,
  disabled = false,
  quiet = false,
}: {
  samples: { id: string; code: string }[];
  points: Record<string, MapPoint>;
  onChange: (points: Record<string, MapPoint>) => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  const help = useId(),
    map = useRef<HTMLDivElement>(null),
    dragging = useRef('');
  const [selected, setSelected] = useState('');
  function place(id: string, clientX: number, clientY: number) {
    if (disabled) return;
    const bounds = map.current!.getBoundingClientRect();
    onChange({
      ...points,
      [id]: {
        description: points[id]?.description ?? '',
        x: Math.max(0, Math.min(60, ((clientX - bounds.left) / bounds.width) * 60)),
        y: Math.max(0, Math.min(40, ((clientY - bounds.top) / bounds.height) * 40)),
      },
    });
  }
  function keyboard(id: string, event: React.KeyboardEvent) {
    if (disabled) return;
    const point = points[id] ?? { x: 30, y: 20, description: '' };
    const amount = event.shiftKey ? 2 : 0.5;
    let { x, y } = point;
    if (event.key === 'ArrowLeft') x -= amount;
    else if (event.key === 'ArrowRight') x += amount;
    else if (event.key === 'ArrowUp') y -= amount;
    else if (event.key === 'ArrowDown') y += amount;
    else if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setSelected(id);
    onChange({
      ...points,
      [id]: { ...point, x: Math.max(0, Math.min(60, x)), y: Math.max(0, Math.min(40, y)) },
    });
  }
  return (
    <div className="ui-stack">
      <p id={help}>
        Select a code, then tap the map. Drag to adjust. Keyboard: Enter places at the centre;
        arrows move by 0.5, Shift by 2 cm equivalent. Digital mapping; physical-sheet equivalence is
        unverified.
      </p>
      {!samples.length && <p>No assigned samples.</p>}
      <div className="ui-inline">
        {samples.map((sample) => (
          <Button
            key={sample.id}
            disabled={disabled}
            aria-pressed={selected === sample.id}
            onClick={() => setSelected(sample.id)}
            onKeyDown={(e) => keyboard(sample.id, e)}
          >
            {sample.code}
            {points[sample.id] ? ' · placed' : ''}
          </Button>
        ))}
      </div>
      <div className="ui-map-frame">
        <div
          ref={map}
          className="ui-sample-map"
          role="group"
          aria-label="Sample similarity map"
          aria-describedby={help}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && selected) place(selected, e.clientX, e.clientY);
          }}
        >
          {samples
            .filter((sample) => points[sample.id])
            .map((sample) => {
              const point = points[sample.id];
              return (
                <Button
                  key={sample.id}
                  disabled={disabled}
                  className="ui-map-token"
                  aria-label={'Move sample ' + sample.code}
                  aria-pressed={selected === sample.id}
                  style={{ left: (point.x / 60) * 100 + '%', top: (point.y / 40) * 100 + '%' }}
                  onClick={() => setSelected(sample.id)}
                  onKeyDown={(e) => keyboard(sample.id, e)}
                  onPointerDown={(e) => {
                    if (disabled) return;
                    e.stopPropagation();
                    dragging.current = sample.id;
                    setSelected(sample.id);
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (dragging.current === sample.id) place(sample.id, e.clientX, e.clientY);
                  }}
                  onPointerUp={() => {
                    dragging.current = '';
                  }}
                  onPointerCancel={() => {
                    dragging.current = '';
                  }}
                >
                  {sample.code}
                </Button>
              );
            })}
        </div>
      </div>
      <p role={quiet ? undefined : 'status'}>
        {Object.keys(points).length} / {samples.length} samples placed
        {disabled ? ' · Read only' : ''}
      </p>
    </div>
  );
}
