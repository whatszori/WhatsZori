import { AlertCircle, Info, X } from 'lucide-react';
import { useToasts } from '../stores/toasts';
import './Toasts.css';

export function Toasts() {
  const items = useToasts((s) => s.items);
  if (items.length === 0) return null;
  return (
    <div className="wz-toasts" role="region" aria-label="Notifications">
      {items.map((t) => (
        <div
          key={t.id}
          className={`wz-toast wz-toast--${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          {t.kind === 'error' ? (
            <AlertCircle size={16} strokeWidth={1.75} className="wz-toast__icon" />
          ) : (
            <Info size={16} strokeWidth={1.75} className="wz-toast__icon" />
          )}
          <span className="wz-toast__text">{t.text}</span>
          <button
            type="button"
            className="wz-toast__close"
            aria-label="Dismiss"
            onClick={() => useToasts.getState().dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
