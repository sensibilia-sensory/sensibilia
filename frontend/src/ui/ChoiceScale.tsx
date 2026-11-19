import { useId } from 'react';

/** How a scale is laid out: a list, a row of labelled points, or a row that names only its ends. */
export type ScaleLayout = 'vertical' | 'horizontal' | 'horizontal_ends';

/** An unnamed step (blank label) shows only its number, never a dangling dot. */
function stepText(option: { value: number | string; label: string }, showValues: boolean) {
  const name = option.label.trim();
  if (!name) return String(option.value);
  return showValues ? String(option.value) + ' · ' + option.label : option.label;
}

export function ChoiceScale({
  label,
  options,
  value,
  onChange,
  disabled = false,
  multiple = false,
  showValues = true,
  layout = 'vertical',
}: {
  label: string;
  options: { value: number | string; label: string }[];
  value?: number | string | (number | string)[];
  disabled?: boolean;
  multiple?: boolean;
  showValues?: boolean;
  layout?: ScaleLayout;
  onChange: (value: number | string) => void;
}) {
  const name = useId();
  const row = layout !== 'vertical',
    ends = layout === 'horizontal_ends' && options.length > 1;
  const choices = options.map((option, i) => (
    <label key={option.value}>
      <input
        type={multiple ? 'checkbox' : 'radio'}
        name={name}
        checked={Array.isArray(value) ? value.includes(option.value) : value === option.value}
        onChange={() => onChange(option.value)}
      />
      <span className={ends ? 'sr-only' : undefined}>{stepText(option, showValues)}</span>
      {/* Ends only: the point's position is what shows beside the radio button. */}
      {ends && <span aria-hidden="true">{i + 1}</span>}
    </label>
  ));
  return (
    <fieldset
      className={
        'ui-choice-scale' + (ends ? ' ui-choice-scale--ends' : row ? ' ui-choice-scale--row' : '')
      }
      disabled={disabled}
    >
      <legend>{label}</legend>
      {ends && (
        <div className="ui-choice-ends" aria-hidden="true">
          <span>{options[0].label}</span>
          <span>{options[options.length - 1].label}</span>
        </div>
      )}
      {row ? <div className="ui-choice-points">{choices}</div> : choices}
    </fieldset>
  );
}
