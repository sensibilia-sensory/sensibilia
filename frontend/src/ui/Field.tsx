import { useId, type ChangeEventHandler, type InputHTMLAttributes, type ReactNode } from 'react';

interface SharedFieldProps {
  id?: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  mono?: boolean;
  compact?: boolean;
  /** Label above the control, for narrow containers such as the navigation column. */
  stacked?: boolean;
}
type TextFieldProps = SharedFieldProps & {
  readOnly?: boolean;
  kind?: 'text' | 'number' | 'password';
  value: string | number;
  onChange: ChangeEventHandler<HTMLInputElement>;
  min?: number;
  max?: number;
  step?: InputHTMLAttributes<HTMLInputElement>['step'];
  placeholder?: string;
};
type SelectFieldProps = SharedFieldProps & {
  kind: 'select';
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  options: { value: string; label: string }[];
};
type BooleanFieldProps = SharedFieldProps & {
  kind: 'checkbox' | 'toggle';
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
};
type TextareaFieldProps = SharedFieldProps & {
  kind: 'textarea';
  rows?: number;
  placeholder?: string;
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
};
export type FieldProps = TextFieldProps | SelectFieldProps | BooleanFieldProps | TextareaFieldProps;

export function Field(props: FieldProps) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const describedBy =
    [props.hint ? `${id}-hint` : '', props.error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
    undefined;
  const common = {
    id,
    'aria-label': props.label,
    disabled: props.disabled,
    required: props.required,
    'aria-invalid': props.error ? true : undefined,
    'aria-describedby': describedBy,
    className: `ui-control ${props.mono ? 'mono' : ''} ${props.kind === 'number' ? 'numeric' : ''}`,
  };
  let control: ReactNode;
  if (props.kind === 'select') {
    control = (
      <select {...common} value={props.value} onChange={props.onChange}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (props.kind === 'textarea') {
    control = (
      <textarea
        {...common}
        value={props.value}
        onChange={props.onChange}
        rows={props.rows ?? 1}
        placeholder={props.placeholder}
      />
    );
  } else if (props.kind === 'checkbox' || props.kind === 'toggle') {
    control = (
      <div className="ui-boolean-control">
        <input
          {...common}
          className="ui-checkbox"
          type="checkbox"
          role={props.kind === 'toggle' ? 'switch' : undefined}
          checked={props.checked}
          onChange={props.onChange}
        />
      </div>
    );
  } else {
    const textProps = props as TextFieldProps;
    control = (
      <input
        {...common}
        readOnly={textProps.readOnly}
        type={textProps.kind ?? 'text'}
        value={textProps.value}
        onChange={textProps.onChange}
        min={textProps.min}
        max={textProps.max}
        step={textProps.step}
        placeholder={textProps.placeholder}
      />
    );
  }
  return (
    <div
      className={[
        'ui-field',
        props.compact && 'ui-field--compact',
        props.stacked && 'ui-field--stacked',
      ]
        .filter(Boolean)
        .join(' ')}
      data-layout="allowed-grid"
    >
      <label htmlFor={id} className={props.compact ? 'sr-only' : undefined}>
        {props.label}
        {props.required && <span aria-hidden="true"> *</span>}
      </label>
      <div className="ui-field-control">
        {control}
        {props.hint && (
          <p className={props.compact ? 'sr-only' : 'ui-hint'} id={`${id}-hint`}>
            {props.hint}
          </p>
        )}
        {props.error && (
          <p className="ui-error" id={`${id}-error`}>
            {props.error}
          </p>
        )}
      </div>
    </div>
  );
}
