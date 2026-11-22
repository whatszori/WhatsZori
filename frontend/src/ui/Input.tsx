import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import './Input.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, trailing, className, ...rest },
  ref,
) {
  return (
    <div className={['wz-input', icon && 'wz-input--with-icon', className].filter(Boolean).join(' ')}>
      {icon && <span className="wz-input__icon">{icon}</span>}
      <input ref={ref} className="wz-input__field" {...rest} />
      {trailing && <span className="wz-input__trailing">{trailing}</span>}
    </div>
  );
});
