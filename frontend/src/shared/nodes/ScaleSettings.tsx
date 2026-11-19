import { useState } from 'react';
import { Button, Field, Toolbar, type ScaleLayout } from '../../ui';
import type { Node } from '../flow';
import { scalePresets } from './scalePresets';

type Scaled = Extract<Node, { kind: 'matrix_question' | 'question' }>;
const optionId = () => 'option_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);

/** Plain words for how a scale looks on the tablet. */
export const layoutOptions: { value: ScaleLayout; label: string }[] = [
  { value: 'vertical', label: 'Vertical list' },
  { value: 'horizontal', label: 'Horizontal row, every option named' },
  { value: 'horizontal_ends', label: 'Horizontal row, only the two ends named' },
];

/** How the scale is shown to the assessor. A grid shows a row layout as a real table. */
export function ScaleLayoutField({
  node,
  disabled = false,
  onChange,
}: {
  node: Scaled;
  disabled?: boolean;
  onChange: (node: Node) => void;
}) {
  return (
    <Field
      kind="select"
      label="Scale display"
      value={node.data.layout ?? 'vertical'}
      disabled={disabled}
      options={layoutOptions}
      hint={
        node.kind === 'matrix_question'
          ? 'A horizontal layout shows the grid as a table: one row per question, one column per option. Every option keeps its full text in exports, even when only the ends are shown.'
          : 'A horizontal layout puts the options in one row. Every option keeps its full text in exports, even when only the ends are shown.'
      }
      onChange={(e) =>
        onChange({ ...node, data: { ...node.data, layout: e.target.value as ScaleLayout } } as Node)
      }
    />
  );
}

/**
 * Fills the options of a question or grid from a standard scale, or from a numbered scale whose
 * ends are named (for example a 7-point scale from "Not at all" to "Extremely").
 */
export function ScaleBuilder({
  node,
  language,
  disabled = false,
  onChange,
}: {
  node: Scaled;
  language: string;
  disabled?: boolean;
  onChange: (node: Node) => void;
}) {
  const [preset, setPreset] = useState(''),
    [points, setPoints] = useState('7'),
    [low, setLow] = useState(''),
    [high, setHigh] = useState(''),
    [middle, setMiddle] = useState('');
  const odd = Number(points) % 2 === 1;
  const scored = node.kind === 'matrix_question';
  const replace = (labels: string[], layout?: ScaleLayout) =>
    onChange({
      ...node,
      data: {
        ...node.data,
        options: labels.map((label, i) => ({
          id: optionId(),
          label: { [language]: label },
          exclusive: false,
          ...(scored ? { score: i + 1 } : {}),
        })),
        ...(layout ? { layout } : {}),
      },
    } as Node);
  return (
    <div className="ui-stack">
      <Toolbar label="Standard scales">
        <Field
          compact
          kind="select"
          label="Standard scale"
          value={preset}
          disabled={disabled}
          onChange={(e) => setPreset(e.target.value)}
          options={[
            { value: '', label: 'Standard scale…' },
            ...scalePresets.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <Button
          disabled={disabled || !preset}
          onClick={() => {
            const chosen = scalePresets.find((p) => p.id === preset);
            if (!chosen) return;
            replace(chosen.labels);
            setPreset('');
          }}
        >
          Replace scale
        </Button>
      </Toolbar>
      <Toolbar label="Numbered scale">
        <Field
          compact
          kind="select"
          label="Points"
          value={points}
          disabled={disabled}
          onChange={(e) => setPoints(e.target.value)}
          options={Array.from({ length: 9 }, (_, i) => ({
            value: String(i + 3),
            label: i + 3 + ' points',
          }))}
        />
        <Field
          compact
          label="Low end"
          placeholder="Low end, e.g. Not at all"
          value={low}
          disabled={disabled}
          onChange={(e) => setLow(e.target.value)}
        />
        <Field
          compact
          label="High end"
          placeholder="High end, e.g. Extremely"
          value={high}
          disabled={disabled}
          onChange={(e) => setHigh(e.target.value)}
        />
        {odd && (
          <Field
            compact
            label="Middle"
            placeholder="Middle, e.g. Neither (optional)"
            value={middle}
            disabled={disabled}
            onChange={(e) => setMiddle(e.target.value)}
          />
        )}
        <Button
          disabled={disabled}
          onClick={() => {
            const n = Number(points);
            const named = odd && middle.trim() ? middle.trim() : '';
            replace(
              Array.from({ length: n }, (_, i) =>
                i === 0
                  ? low.trim() || '1'
                  : i === n - 1
                    ? high.trim() || String(n)
                    : named && i === (n - 1) / 2
                      ? named
                      : String(i + 1),
              ),
              // A named middle needs every option shown; otherwise only the ends are named.
              named ? 'horizontal' : 'horizontal_ends',
            );
          }}
        >
          Create numbered scale
        </Button>
      </Toolbar>
      <span className="ui-hint">
        Replacing the scale gives every option a new internal ID, so review any condition that uses
        them. A numbered scale is shown as a row naming only its two ends (or every option when a
        middle is named); change that under Scale display. Order is presentation order.
        {scored && ' Scores are exported as configured (1, 2, 3 …); no reverse scoring.'}
      </span>
    </div>
  );
}
