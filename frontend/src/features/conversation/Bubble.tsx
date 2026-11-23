import { memo, type MouseEvent } from 'react';
import { MoreHorizontal, Trash2, Ban } from 'lucide-react';
import type { Message, MessagePK } from '../../api';
import { formatTime } from '../../lib/format';
import { linkify } from '../../lib/linkify';
import { PluginSlot } from '../../plugin-core/slots';
import type { PopoverAnchor } from '../../ui';
import { MediaBlock } from './Media';
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
}

function Text({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.type === 'link' ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer noopener">
            {p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
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
      ]
        .filter(Boolean)
        .join(' ')}
      data-pk={m.pk}
    >
      <div className="wz-message__row">
        <div className={cls} onContextMenu={openMenu}>
          {showSender && !m.fromMe && <div className="wz-bubble__sender">{m.senderName}</div>}

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
                  <Text text={m.text} />
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
