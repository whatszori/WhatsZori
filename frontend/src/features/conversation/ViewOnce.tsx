import type { Message } from '../../api';
import { useUI } from '../../stores/ui';
import './ViewOnce.css';

function OnceIcon() {
  // WhatsApp's mark: a dashed circle with a 1
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeDasharray="3.2 2.2"
      />
      <path d="M12.6 7v10M10.2 9l2.4-2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

// A view-once photo or video: a card instead of the picture. Opening it here sends nothing to the
// sender, and it can be opened again and saved like any other file.
export function ViewOnce({ m }: { m: Message }) {
  const what = m.kind === 'video' ? 'Video' : 'Photo';
  const missing = !!m.media?.unavailable;
  return (
    <button
      type="button"
      className={`wz-view-once${missing ? ' wz-view-once--missing' : ''}`}
      disabled={missing}
      onClick={(e) => {
        e.stopPropagation();
        useUI.getState().openViewer(m.chatJid, m.pk, [m]);
      }}
    >
      <span className="wz-view-once__icon">
        <OnceIcon />
      </span>
      <span className="wz-view-once__text">
        <span className="wz-view-once__title">{what}</span>
        <span className="wz-view-once__sub">
          {missing ? 'View once · open it on your phone' : 'View once · kept by WhatsZori'}
        </span>
      </span>
    </button>
  );
}
