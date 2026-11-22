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
  const sync = useConnection((s) => s.sync);
  if (conn === 'connected') {
    if (!sync) return null;
    return (
      <div className="wz-banner wz-banner--connecting" role="status" aria-live="polite">
        <Spinner size={12} />
        Syncing chats from your phone… {sync.progress}%
      </div>
    );
  }
  return (
    <div className={`wz-banner wz-banner--${conn}`} role="status" aria-live="polite">
      {conn === 'offline' ? <WifiOff size={14} strokeWidth={1.75} /> : <Spinner size={12} />}
      {TEXT[conn]}
    </div>
  );
}
