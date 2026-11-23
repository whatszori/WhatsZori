import { memo, type MouseEvent } from 'react';
import { Ban, Check, Forward, MoreHorizontal, Trash2 } from 'lucide-react';
import type { JID, Message, MessagePK } from '../../api';
import { formatTime } from '../../lib/format';
import { linkify } from '../../lib/linkify';
import { PluginSlot } from '../../plugin-core/slots';
import type { PopoverAnchor } from '../../ui';
import { Marked } from '../search/MessageHits';
import { MediaBlock } from './Media';
import { useUI } from '../../stores/ui';
import { StatusTicks } from './StatusTicks';
import { toPluginMessage } from './plugin-adapters';

export interface BubbleHandlers {
  onMenu(m: Message, anchor: PopoverAnchor): void;
  onReact(m: Message, emoji: string): void;
  onJump(pk: MessagePK): void;
  onHistory(m: Message, anchor: PopoverAnchor): void;
}

interface BubbleProps extends BubbleHandlers {
  message: Message;
  showSender: boolean;
  groupEnd: boolean;
  groupStart: boolean;
  highlighted: boolean;
  // multi-select is on in this chat; clicking the message toggles it
  selecting?: boolean;
  selected?: boolean;
}

function Text({ text, chat }: { text: string; chat: JID }) {
  // only this chat's bubbles re-render when its Ctrl+F query changes
  const query = useUI((s) => (s.searchHighlight?.jid === chat ? s.searchHighlight.query : ''));
  return (
    <>
      {linkify(text).map((p, i) =>
        p.type === 'link' ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer noopener">
            {p.value}
          </a>
        ) : (
          <span key={i}>{query ? <Marked text={p.value} query={query} /> : p.value}</span>
        ),
      )}
    </>
  );
}

function Meta({
  m,
  onHistory,
}: {
  m: Message;
  onHistory?: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      {m.editedAt &&
        (onHistory ? (
          <button
            type="button"
            className="wz-bubble__edited"
            onClick={onHistory}
            aria-label={`Edited, show ${m.editCount ?? 1} earlier version${(m.editCount ?? 1) === 1 ? '' : 's'}`}
          >
            edited
          </button>
        ) : (
          <span className="wz-bubble__edited">edited</span>
        ))}
      <time dateTime={new Date(m.timestamp).toISOString()}>{formatTime(m.timestamp)}</time>
      {m.fromMe && m.status && <StatusTicks status={m.status} />}
    </>
  );
}

export const Bubble = memo(function Bubble({
  message: m,
  showSender,
  groupStart,
  groupEnd,
  highlighted,
  selecting = false,
  selected = false,
  onMenu,
  onReact,
  onJump,
  onHistory,
}: BubbleProps) {
  const dir = m.fromMe ? 'out' : 'in';
  const hasMedia = !!m.media && !m.contentUnknown;
  const visualOnly = hasMedia && (m.kind === 'image' || m.kind === 'video') && !m.text;
  // video notes are a bare circle: no bubble around them
  const round = hasMedia && !!m.media?.round;

  const openMenu = (e: MouseEvent<HTMLElement>) => {
    // let people right-click links and selected text normally
    if ((e.target as HTMLElement).closest('a') || window.getSelection()?.toString()) return;
    e.preventDefault();
    onMenu(m, { x: e.clientX, y: e.clientY });
  };

  const cls = [
    'wz-bubble',
    `wz-bubble--${dir}`,
    groupStart && 'wz-bubble--first',
    groupEnd && 'wz-bubble--tail',
    m.deleted && 'wz-bubble--deleted',
    m.contentUnknown && 'wz-bubble--unknown',
    hasMedia && `wz-bubble--has-${m.kind}`,
    visualOnly && 'wz-bubble--visual',
    round && 'wz-bubble--round',
    hasMedia && m.kind === 'sticker' && !m.text && 'wz-bubble--sticker',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={[
        'wz-message',
        `wz-message--${dir}`,
        groupEnd && 'wz-message--group-end',
        highlighted && 'wz-message--highlight',
        selecting && 'wz-message--selecting',
        selected && 'wz-message--selected',
      ]
        .filter(Boolean)
        .join(' ')}
      data-pk={m.pk}
      onClick={selecting ? () => useUI.getState().toggleSelected(m.chatJid, m.pk) : undefined}
      role={selecting ? 'checkbox' : undefined}
      aria-checked={selecting ? selected : undefined}
    >
      {selecting && (
        <span className="wz-message__select" aria-hidden="true">
          <span className="wz-check">{selected && <Check size={14} strokeWidth={3} />}</span>
        </span>
      )}
      <div className="wz-message__row">
        <div className={cls} onContextMenu={openMenu}>
          {showSender && !m.fromMe && (
            <button
              type="button"
              className="wz-bubble__sender"
              onClick={() => useUI.getState().openInfo(m.senderJid)}
              title={`About ${m.senderName}`}
            >
              {m.senderName}
            </button>
          )}

          {m.contentUnknown ? (
            <p className="wz-bubble__unknown">
              <Ban size={14} strokeWidth={1.75} aria-hidden="true" />
              Message was deleted before it was received
              <span className="wz-bubble__meta-spacer" aria-hidden="true">
                <Meta m={m} />
              </span>
            </p>
          ) : (
            <div className="wz-bubble__content">
              {!!m.forwarded && (
                <span className="wz-bubble__forwarded">
                  <Forward size={12} aria-hidden="true" />
                  {m.forwarded >= 5 ? 'Forwarded many times' : 'Forwarded'}
                </span>
              )}
              {m.replyTo && (
                <button
                  type="button"
                  className="wz-quote"
                  onClick={() => onJump(m.replyTo!.pk)}
                  aria-label={`Reply to ${m.replyTo.senderName}: ${m.replyTo.text}. Jump to message`}
                >
                  <span className="wz-quote__name">
                    {m.replyTo.fromMe ? 'You' : m.replyTo.senderName}
                  </span>
                  <span className="wz-quote__text">{m.replyTo.text || 'Message'}</span>
                </button>
              )}
              {hasMedia && (
                <MediaBlock chatJid={m.chatJid} pk={m.pk} kind={m.kind} media={m.media!} />
              )}
              {m.text && (
                <p className="wz-bubble__text wz-selectable" dir="auto">
                  <Text text={m.text} chat={m.chatJid} />
                  <span className="wz-bubble__meta-spacer" aria-hidden="true">
                    <Meta m={m} />
                  </span>
                </p>
              )}
            </div>
          )}

          <div className={`wz-bubble__meta${visualOnly ? ' wz-bubble__meta--overlay' : ''}`}>
            <Meta
              m={m}
              onHistory={(e) => {
                e.stopPropagation();
                onHistory(m, e.currentTarget.getBoundingClientRect());
              }}
            />
          </div>

          {m.deleted && (
            <div className="wz-bubble__deleted">
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              <span>
                Deleted by {m.deleted.byJid === m.senderJid && m.fromMe ? 'you' : m.deleted.byName}{' '}
                · {formatTime(m.deleted.at)}
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="wz-message__more"
          aria-label="Message actions"
          aria-haspopup="menu"
          onClick={(e) => onMenu(m, e.currentTarget.getBoundingClientRect())}
        >
          <MoreHorizontal size={16} strokeWidth={1.75} />
        </button>
      </div>

      {m.reactions.length > 0 && (
        <div className="wz-reactions" role="group" aria-label="Reactions">
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              className={`wz-reaction${r.mine ? ' wz-reaction--mine' : ''}`}
              aria-pressed={r.mine}
              aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
              onClick={() => onReact(m, r.emoji)}
            >
              <span className="wz-reaction__emoji">{r.emoji}</span>
              <span className="wz-reaction__count">{r.count}</span>
            </button>
          ))}
        </div>
      )}

      <PluginSlot name="message.accessories" props={{ message: toPluginMessage(m) }} />
    </div>
  );
});
