import './Badge.css';

interface BadgeProps {
  count: number;
  muted?: boolean;
  label?: string;
}

export function Badge({ count, muted, label }: BadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className={`wz-badge${muted ? ' wz-badge--muted' : ''}`}
      aria-label={label ?? `${count} unread`}
    >
      {count > 999 ? '999+' : count}
    </span>
  );
}
