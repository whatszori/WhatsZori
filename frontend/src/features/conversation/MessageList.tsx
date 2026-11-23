import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown } from 'lucide-react';
import type { Chat, Message, MessagePK } from '../../api';
import { useMessages } from '../../stores/messages';
import { useUI } from '../../stores/ui';
import { Badge, Spinner, type PopoverAnchor } from '../../ui';
import { MessageMenu } from '../message-menu/MessageMenu';
import { Bubble } from './Bubble';
import { EditHistoryPopover } from './EditHistoryPopover';
import { EmptyChat } from './EmptyStates';
import { buildRows } from './rows';
import './MessageList.css';

const NEAR_BOTTOM = 120;
const LOAD_OLDER_AT = 600;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function MessageList({ chat }: { chat: Chat }) {
  const jid = chat.jid;
  const state = useMessages((s) => s.byChat[jid]);
  const focus = useUI((s) => s.focusMessage);
  const selection = useUI((s) => (s.selection?.jid === jid ? s.selection.pks : null));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [floatingDay, setFloatingDay] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<MessagePK | null>(null);
  const [menu, setMenu] = useState<{ m: Message; anchor: PopoverAnchor } | null>(null);
  const [history, setHistory] = useState<{ m: Message; anchor: PopoverAnchor } | null>(null);
  const dayTimer = useRef<number | undefined>(undefined);
  // programmatic scrolls (initial pin, jumps) shouldn't flash the day label
  const userScrollAt = useRef(0);
  const markUserScroll = () => {
    userScrollAt.current = Date.now();
  };
  const initialScrollDone = useRef(false);
  // distance from the bottom before an older page lands, so we can restore it
  const anchorFromBottom = useRef<number | null>(null);

  const items = useMemo(() => state?.items ?? [], [state?.items]);
  const rows = useMemo(() => buildRows(items), [items]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].type === 'day' ? 40 : 52),
    getItemKey: (i) => rows[i].key,
    overscan: 10,
    paddingStart: 12,
    paddingEnd: 8,
  });

  useEffect(() => {
    void useMessages.getState().loadInitial(jid);
  }, [jid]);

  const scrollToBottom = useCallback(
    (smooth = false) => {
      if (rows.length === 0) return;
      virtualizer.scrollToIndex(rows.length - 1, {
        align: 'end',
        behavior: smooth && !reducedMotion() ? 'smooth' : 'auto',
      });
    },
    [rows.length, virtualizer],
  );

  // first paint: start at the bottom. measured heights trickle in, so pin a few frames
  useLayoutEffect(() => {
    if (initialScrollDone.current || rows.length === 0) return;
    initialScrollDone.current = true;
    let frames = 0;
    const pin = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      if (++frames < 6) requestAnimationFrame(pin);
    };
    pin();
  }, [rows.length]);

  // older page prepended: keep the same content under the viewport
  const firstKey = rows[0]?.key;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || anchorFromBottom.current === null) return;
    const dist = anchorFromBottom.current;
    anchorFromBottom.current = null;
    let frames = 0;
    const restore = () => {
      el.scrollTop = el.scrollHeight - dist;
      if (++frames < 3) requestAnimationFrame(restore);
    };
    restore();
  }, [firstKey]);

  // new messages at the end: follow if we were at the bottom or it's ours
  const lastMsg = items[items.length - 1];
  const prevLast = useRef<MessagePK | undefined>(undefined);
  useEffect(() => {
    if (!lastMsg) return;
    const prev = prevLast.current;
    prevLast.current = lastMsg.pk;
    if (!prev || prev === lastMsg.pk || !initialScrollDone.current) return;
    if (atBottom || lastMsg.fromMe) {
      requestAnimationFrame(() => scrollToBottom(true));
    } else {
      setNewCount((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the tail only
  }, [lastMsg?.pk]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && newCount) setNewCount(0);

    if (
      el.scrollTop < LOAD_OLDER_AT &&
      state?.hasMore &&
      !state.loading &&
      initialScrollDone.current
    ) {
      anchorFromBottom.current = el.scrollHeight - el.scrollTop;
      void useMessages.getState().loadOlder(jid);
    }

    const first = virtualizer.getVirtualItems().find((v) => v.end > el.scrollTop + 8);
    if (first && Date.now() - userScrollAt.current < 1000) {
      const row = rows[first.index];
      // find the day this row belongs to
      let label: string | null = null;
      for (let i = first.index; i >= 0; i--) {
        const r = rows[i];
        if (r.type === 'day') {
          label = r.label;
          break;
        }
      }
      setFloatingDay(row && label ? label : null);
      window.clearTimeout(dayTimer.current);
      dayTimer.current = window.setTimeout(() => setFloatingDay(null), 1200);
    }
  };

  useEffect(() => () => window.clearTimeout(dayTimer.current), []);

  // jump to a quoted message (possibly not loaded yet)
  useEffect(() => {
    if (!focus || focus.jid !== jid) return;
    let cancelled = false;
    void (async () => {
      const ok = await useMessages.getState().ensureLoaded(jid, focus.pk);
      if (cancelled || !ok) return;
      requestAnimationFrame(() => {
        const current = buildRows(useMessages.getState().byChat[jid]?.items ?? []);
        const i = current.findIndex((r) => r.type === 'msg' && r.key === focus.pk);
        if (i < 0) return;
        virtualizer.scrollToIndex(i, { align: 'center' });
        setHighlight(focus.pk);
        window.setTimeout(() => setHighlight((h) => (h === focus.pk ? null : h)), 1700);
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce drives this
  }, [focus?.nonce]);

  const onMenu = useCallback((m: Message, anchor: PopoverAnchor) => setMenu({ m, anchor }), []);
  const onHistory = useCallback(
    (m: Message, anchor: PopoverAnchor) => setHistory({ m, anchor }),
    [],
  );
  const onJump = useCallback((pk: MessagePK) => useUI.getState().jumpTo(jid, pk), [jid]);
  const onReact = useCallback(
    (m: Message, emoji: string) => void useMessages.getState().react(jid, m.pk, emoji),
    [jid],
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeHistory = useCallback(() => setHistory(null), []);

  if (state?.loaded && items.length === 0) return <EmptyChat />;

  const vitems = virtualizer.getVirtualItems();

  return (
    <div className="wz-message-list">
      {floatingDay && (
        <div className="wz-message-list__floating-day" aria-hidden="true">
          <span className="wz-day">{floatingDay}</span>
        </div>
      )}
      <div
        ref={scrollRef}
        className="wz-message-list__scroll"
        onScroll={onScroll}
        onWheel={markUserScroll}
        onPointerDown={markUserScroll}
        onKeyDown={markUserScroll}
        onTouchMove={markUserScroll}
        role="log"
        aria-label={`Messages with ${chat.name}`}
        aria-live="polite"
        aria-relevant="additions"
      >
        {!state?.loaded && (
          <div className="wz-message-list__loading">
            <Spinner size={18} />
          </div>
        )}
        {state?.loading && state.loaded && (
          <div className="wz-message-list__loading-older">
            <Spinner size={14} label="Loading older messages" />
          </div>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {vitems.map((vi) => {
            const row = rows[vi.index];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {row.type === 'day' ? (
                  <div className="wz-day-separator" role="separator" aria-label={row.label}>
                    <span className="wz-day">{row.label}</span>
                  </div>
                ) : (
                  <Bubble
                    message={row.message}
                    showSender={chat.isGroup && row.groupStart}
                    groupStart={row.groupStart}
                    groupEnd={row.groupEnd}
                    highlighted={highlight === row.message.pk}
                    selecting={!!selection}
                    selected={!!selection?.includes(row.message.pk)}
                    onMenu={onMenu}
                    onReact={onReact}
                    onJump={onJump}
                    onHistory={onHistory}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!atBottom && (
        <button
          type="button"
          className="wz-jump-bottom"
          aria-label={newCount ? `Jump to latest, ${newCount} new` : 'Jump to latest'}
          onClick={() => {
            setNewCount(0);
            scrollToBottom(true);
          }}
        >
          <ChevronDown size={20} strokeWidth={1.75} />
          {newCount > 0 && <Badge count={newCount} label={`${newCount} new`} />}
        </button>
      )}

      <MessageMenu
        chat={chat}
        target={menu}
        onClose={closeMenu}
        onShowHistory={(m, a) => setHistory({ m, anchor: a })}
      />
      <EditHistoryPopover target={history} onClose={closeHistory} />
    </div>
  );
}
