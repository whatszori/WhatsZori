import { useId } from 'react';
import './Toggle.css';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className={`wz-toggle${disabled ? ' wz-toggle--disabled' : ''}`}>
      <div className="wz-toggle__text">
        <label htmlFor={id} className="wz-toggle__label">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="wz-toggle__description">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        className="wz-toggle__switch"
        onClick={() => onChange(!checked)}
      >
        <span className="wz-toggle__thumb" />
      </button>
    </div>
  );
}
