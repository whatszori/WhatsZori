import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import './IconButton.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  hint?: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  active?: boolean;
  tooltip?: boolean;
  tooltipPlacement?: 'top' | 'bottom';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    hint,
    icon,
    size = 'md',
    active,
    tooltip = true,
    tooltipPlacement,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const cls = [
    'wz-icon-button',
    `wz-icon-button--${size}`,
    active && 'wz-icon-button--active',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const button = (
    <button ref={ref} type={type} aria-label={label} className={cls} {...rest}>
      {icon}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip label={label} hint={hint} placement={tooltipPlacement}>
      {button}
    </Tooltip>
  );
});
