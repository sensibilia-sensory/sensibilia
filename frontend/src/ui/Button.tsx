import { useId, type ButtonHTMLAttributes, type Ref } from 'react';

type SharedProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: 'primary' | 'default' | 'quiet' | 'danger' | 'planned';
  explanation?: string;
  compact?: boolean;
};
export type ButtonProps = SharedProps &
  ({ size?: 'default' } | { size: 'icon'; 'aria-label': string });

export function Button({
  variant = 'default',
  size = 'default',
  className = '',
  type = 'button',
  explanation,
  compact = false,
  children,
  ...props
}: ButtonProps) {
  const id = useId();
  const planned = variant === 'planned';
  const button = (
    <button
      {...props}
      type={type}
      disabled={planned || props.disabled}
      onClick={planned ? undefined : props.onClick}
      aria-describedby={planned ? id : props['aria-describedby']}
      className={`ui-button ui-button--${variant} ui-button--${size} ${className}`}
    >
      {children}
      {planned && ' · Planned'}
    </button>
  );
  return planned ? (
    <span className="ui-planned">
      {button}
      <span id={id} className={compact ? 'sr-only' : 'ui-hint'}>
        {explanation ?? 'Available in a later slice.'}
      </span>
    </span>
  ) : (
    button
  );
}
