import './Spinner.css';

export function Spinner({ size = 16, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <span
      className="wz-spinner"
      role="status"
      aria-label={label}
      style={{ width: size, height: size }}
    />
  );
}
