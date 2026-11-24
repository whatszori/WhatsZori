import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizontal, X } from 'lucide-react';
import type { InAppToast } from '../api';
import { formatTime } from '../lib/format';
import { ErrorBoundary } from '../plugin-core/ErrorBoundary';
import { PluginSlot, useSlotEntries } from '../plugin-core/slots';
import type { NotificationControls, PluginNotification } from '../plugin-core/types';
import { Avatar, Logo } from '../ui';

export function toPluginNotification(t: InAppToast): PluginNotification {
  return {
    id: t.id,
    chatJid: t.chatJid,
    title: t.title,
    body: t.body,
    avatarUrl: t.avatar,
    isGroup: t.isGroup,
    at: t.at,
    hasActions: t.actions,
  };
}

export interface CardControls extends NotificationControls {
  // the reply field needs keyboard focus, which the window normally refuses
  startTyping(): void;
  stopTyping(): void;
}

// A plugin can replace the card entirely ("notification.card"); a crashing plugin card falls
// back to the stock one, so a broken plugin never eats notifications.
export function ToastCard({ toast, controls }: { toast: InAppToast; controls: CardControls }) {
  const custom = useSlotEntries('notification.card')[0];
  const stock = <StockCard toast={toast} controls={controls} />;
  if (!custom) return stock;
  const C = custom.component;
  return (
    <ErrorBoundary label={`plugin "${custom.pluginId}" notification card`} fallback={stock}>
      <C notification={toPluginNotification(toast)} controls={controls} />
    </ErrorBoundary>
  );
}

function StockCard({ toast, controls }: { toast: InAppToast; controls: CardControls }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const summary = !toast.chatJid;

  useEffect(() => {
    if (replying) input.current?.focus();
  }, [replying]);

  const startReply = () => {
    controls.startTyping();
    setReplying(true);
  };
  const cancelReply = () => {
    setReplying(false);
    setText('');
    controls.stopTyping();
  };
  const send = () => {
    const v = text.trim();
    if (!v) return;
    controls.reply(v);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelReply();
    }
  };

  return (
    <article
      className={`wz-ntf${summary ? ' wz-ntf--summary' : ''}${replying ? ' wz-ntf--replying' : ''}`}
      aria-label={`${toast.title}: ${toast.body}`}
    >
      <button type="button" className="wz-ntf__main" onClick={controls.open}>
        {summary ? (
          <span className="wz-ntf__mark">
            <Logo variant="mark" height={22} />
          </span>
        ) : (
          <Avatar
            name={toast.title.replace(/\s*\(\d+ new\)$/, '')}
            jid={toast.avatar ? toast.chatJid : undefined}
            size={44}
            group={toast.isGroup}
          />
        )}
        <span className="wz-ntf__text">
          <span className="wz-ntf__top">
            <span className="wz-ntf__title">{toast.title}</span>
            <span className="wz-ntf__time">{formatTime(toast.at)}</span>
          </span>
          <span className="wz-ntf__body" dir="auto">
            {toast.body}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="wz-ntf__close"
        aria-label="Dismiss"
        onClick={controls.dismiss}
      >
        <X size={14} />
      </button>
      <PluginSlot
        name="notification.accessories"
        className="wz-ntf__accessories"
        props={{ notification: toPluginNotification(toast) }}
      />
      {toast.actions &&
        (replying ? (
          <div className="wz-ntf__reply">
            <input
              ref={input}
              className="wz-ntf__input"
              placeholder="Reply…"
              aria-label="Reply"
              value={text}
              maxLength={4096}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
            <button
              type="button"
              className="wz-ntf__send"
              aria-label="Send"
              disabled={!text.trim()}
              onClick={send}
            >
              <SendHorizontal size={16} />
            </button>
          </div>
        ) : (
          <div className="wz-ntf__actions">
            <button type="button" className="wz-ntf__action" onClick={controls.markRead}>
              Mark as read
            </button>
            <button type="button" className="wz-ntf__action" onClick={startReply}>
              Reply
            </button>
          </div>
        ))}
    </article>
  );
}
