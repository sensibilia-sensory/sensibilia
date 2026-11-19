/**
 * Small SVG charts for analysis results. One series each, drawn in the accent
 * token; text uses text tokens; every mark has a tooltip and the same numbers sit in a table
 * beside the chart. Coordinates are viewBox units, so the chart scales with its container.
 */
const W = 640;
const H = 260;
const PAD = { left: 44, right: 12, top: 16, bottom: 36 };

/** Round steps (1, 2, 2.5, 5 × 10^k) inside [min, max], about `count` of them. */
function ticks(min: number, max: number, count = 5) {
  const raw = (max - min) / Math.max(count - 1, 1) || 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const first = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  for (let t = first; t <= max + step * 1e-9; t += step) out.push(Math.round(t / step) * step);
  return out;
}

function fmt(value: number) {
  if (Math.abs(value) < 1e-9) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) >= 10 ? 0 : 1);
}

/** Skip a label that would overlap one already placed; the mark keeps its tooltip. */
function placeLabels<T extends { label: string; x: number; y: number }>(items: T[]) {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  return items.map((item) => {
    const width = item.label.length * 6.2;
    const right = item.x + 7 + width > W - PAD.right;
    const x0 = right ? item.x - 7 - width : item.x + 7;
    const box = { x0, x1: x0 + width, y0: item.y - 16, y1: item.y };
    const clash = placed.some(
      (b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0,
    );
    if (clash) return null;
    placed.push(box);
    return { x: right ? item.x - 7 : item.x + 7, anchor: right ? 'end' : 'start' } as const;
  });
}

export interface BarItem {
  label: string;
  value: number;
  low?: number | null;
  high?: number | null;
  /** Letter group or other short annotation shown above the bar. */
  note?: string | null;
}

/** Bars from a baseline, optional intervals and one dashed reference line (e.g. chance). */
export function BarChart({
  title,
  items,
  min,
  max,
  axisLabel,
  reference,
}: {
  title: string;
  items: BarItem[];
  min: number;
  max: number;
  axisLabel: string;
  reference?: { value: number; label: string };
}) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) =>
    PAD.top + plotH - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * plotH;
  const slot = plotW / Math.max(items.length, 1);
  const barW = Math.min(slot * 0.5, 64);
  return (
    <figure className="ui-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks(min, max).map((t) => (
          <g key={t}>
            <line className="ui-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text
              className="ui-chart-tick"
              x={PAD.left - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        <text
          className="ui-chart-tick"
          transform={`translate(12 ${PAD.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {axisLabel}
        </text>
        {items.map((item, i) => {
          const cx = PAD.left + slot * (i + 0.5);
          const top = y(item.value);
          const hasInterval = item.low != null && item.high != null;
          const tip =
            `${item.label}: ${fmt(item.value)}` +
            (hasInterval ? ` (95 % CI ${fmt(item.low!)}–${fmt(item.high!)})` : '') +
            (item.note ? `, group ${item.note}` : '');
          return (
            <g key={item.label}>
              <title>{tip}</title>
              <rect
                className="ui-chart-bar"
                x={cx - barW / 2}
                y={top}
                width={barW}
                height={Math.max(y(min) - top, 0)}
              />
              {hasInterval && (
                <g className="ui-chart-interval">
                  <line x1={cx} x2={cx} y1={y(item.low!)} y2={y(item.high!)} />
                  <line x1={cx - 6} x2={cx + 6} y1={y(item.low!)} y2={y(item.low!)} />
                  <line x1={cx - 6} x2={cx + 6} y1={y(item.high!)} y2={y(item.high!)} />
                </g>
              )}
              {item.note && (
                <text
                  className="ui-chart-note"
                  x={cx}
                  y={(hasInterval ? y(item.high!) : top) - 6}
                  textAnchor="middle"
                >
                  {item.note}
                </text>
              )}
              <text className="ui-chart-label" x={cx} y={H - PAD.bottom + 16} textAnchor="middle">
                {item.label}
              </text>
            </g>
          );
        })}
        {reference && (
          <g>
            <line
              className="ui-chart-reference"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(reference.value)}
              y2={y(reference.value)}
            />
            <text
              className="ui-chart-tick"
              x={W - PAD.right}
              y={y(reference.value) - 4}
              textAnchor="end"
            >
              {reference.label}
            </text>
          </g>
        )}
        <line className="ui-chart-axis" x1={PAD.left} x2={W - PAD.right} y1={y(min)} y2={y(min)} />
      </svg>
    </figure>
  );
}

export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  /** 'primary' points are filled accent dots; 'secondary' are hollow, muted (e.g. attributes). */
  kind?: 'primary' | 'secondary';
  tip?: string;
  /** False keeps the point unlabelled (tooltip only), for points that are not findings. */
  labelled?: boolean;
}

/** Labelled points; optional dashed vertical guide (a threshold) and crossing zero lines. */
export function ScatterChart({
  title,
  points,
  xLabel,
  yLabel,
  guideX,
  zeroLines = false,
  legend,
}: {
  title: string;
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  guideX?: { value: number; label: string };
  zeroLines?: boolean;
  legend?: { primary: string; secondary: string };
}) {
  const xs = points.map((p) => p.x).concat(guideX ? [guideX.value] : [], zeroLines ? [0] : []);
  const ys = points.map((p) => p.y).concat(zeroLines ? [0] : []);
  const span = (values: number[]) => {
    const lo = Math.min(...values, 0),
      hi = Math.max(...values, 0);
    const pad = (hi - lo || 1) * 0.12;
    return [lo - (zeroLines ? pad : 0), hi + pad] as const;
  };
  const [x0, x1] = span(xs.length ? xs : [0, 1]);
  const [y0, y1] = span(ys.length ? ys : [0, 1]);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const sx = (v: number) => PAD.left + ((v - x0) / (x1 - x0)) * plotW;
  const sy = (v: number) => PAD.top + plotH - ((v - y0) / (y1 - y0)) * plotH;
  return (
    <figure className="ui-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks(y0, y1).map((t) => (
          <g key={'y' + t}>
            <line
              className="ui-chart-grid"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(t)}
              y2={sy(t)}
            />
            <text
              className="ui-chart-tick"
              x={PAD.left - 6}
              y={sy(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {ticks(x0, x1).map((t) => (
          <text
            key={'x' + t}
            className="ui-chart-tick"
            x={sx(t)}
            y={H - PAD.bottom + 14}
            textAnchor="middle"
          >
            {fmt(t)}
          </text>
        ))}
        <text className="ui-chart-tick" x={PAD.left + plotW / 2} y={H - 4} textAnchor="middle">
          {xLabel}
        </text>
        <text
          className="ui-chart-tick"
          transform={`translate(12 ${PAD.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yLabel}
        </text>
        {zeroLines && (
          <g className="ui-chart-axis">
            <line x1={sx(0)} x2={sx(0)} y1={PAD.top} y2={PAD.top + plotH} />
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(0)} y2={sy(0)} />
          </g>
        )}
        {guideX && (
          <g>
            <line
              className="ui-chart-reference"
              x1={sx(guideX.value)}
              x2={sx(guideX.value)}
              y1={PAD.top}
              y2={PAD.top + plotH}
            />
            <text className="ui-chart-tick" x={sx(guideX.value) + 4} y={PAD.top + plotH - 4}>
              {guideX.label}
            </text>
          </g>
        )}
        {points.map((p, i) => (
          <g key={p.label + i}>
            <title>{p.tip ?? p.label}</title>
            <circle
              className={
                p.kind === 'secondary' ? 'ui-chart-dot ui-chart-dot--hollow' : 'ui-chart-dot'
              }
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={p.kind === 'secondary' ? 3 : 4.5}
            />
          </g>
        ))}
        {/* Labels after marks, primary first, earlier points first: those win a collision. */}
        {(() => {
          const order = points
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.labelled !== false)
            .sort(
              (a, b) => (a.p.kind === 'secondary' ? 1 : 0) - (b.p.kind === 'secondary' ? 1 : 0),
            );
          const spots = placeLabels(
            order.map(({ p }) => ({ label: p.label, x: sx(p.x), y: sy(p.y) })),
          );
          return order.map(({ p, i }, n) => {
            const spot = spots[n];
            return spot ? (
              <text
                key={'label' + i}
                className={p.kind === 'secondary' ? 'ui-chart-tick' : 'ui-chart-note'}
                x={spot.x}
                y={sy(p.y) - 5}
                textAnchor={spot.anchor}
              >
                {p.label}
              </text>
            ) : null;
          });
        })()}
      </svg>
      {legend && (
        <figcaption className="ui-chart-legend">
          <span>
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <circle className="ui-chart-dot" cx="5" cy="5" r="4" />
            </svg>
            {legend.primary}
          </span>
          <span>
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <circle className="ui-chart-dot ui-chart-dot--hollow" cx="5" cy="5" r="3" />
            </svg>
            {legend.secondary}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
