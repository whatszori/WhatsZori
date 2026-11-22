import { ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useSettings } from '../stores/settings';

export function SafeModeBanner() {
  const safeMode = useSettings((s) => s.safeMode);
  const [dismissed, setDismissed] = useState(false);
  if (!safeMode || dismissed) return null;
  return (
    <div className="wz-banner wz-banner--safe-mode" role="status">
      <ShieldAlert size={14} strokeWidth={1.75} />
      Safe mode: the last start didn’t finish, so plugins are off this time. Restart to go back to
      normal.
      <button
        type="button"
        className="wz-banner__close"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
