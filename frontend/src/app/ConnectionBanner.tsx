import { WifiOff } from 'lucide-react';
import { useConnection } from '../stores/connection';
import { Spinner } from '../ui';

const TEXT = {
  connecting: 'Connecting…',
  reconnecting: 'Connection lost. Reconnecting…',
  offline: 'You are offline. Messages will be sent when the connection is back.',
} as const;

export function ConnectionBanner() {
  const conn = useConnection((s) => s.conn);
  if (conn === 'connected') return null;
  return (
    <div className={`wz-banner wz-banner--${conn}`} role="status" aria-live="polite">
      {conn === 'offline' ? <WifiOff size={14} strokeWidth={1.75} /> : <Spinner size={12} />}
      {TEXT[conn]}
    </div>
  );
}
