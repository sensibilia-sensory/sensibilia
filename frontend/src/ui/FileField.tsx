import { useId } from 'react';
export function FileField({
  label,
  disabled,
  onChange,
  accept = 'image/png',
  hint = 'Static 8-bit RGB/RGBA PNG, at most 5 MiB; no animation.',
}: {
  label: string;
  accept?: string;
  hint?: string;
  disabled?: boolean;
  onChange: (file: File | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="ui-field" data-layout="allowed-grid">
      <label htmlFor={id}>{label}</label>
      <div className="ui-field-control">
        <input
          id={id}
          aria-label={label}
          className="ui-control"
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => onChange(e.target.files?.[0])}
        />
        <p className="ui-hint">{hint}</p>
      </div>
    </div>
  );
}
