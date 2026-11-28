import { memo, useMemo, type MouseEvent, type ReactNode } from 'react';
import { Ban, Check, Forward, MoreHorizontal, Trash2 } from 'lucide-react';
import type { JID, Mention, Message, MessagePK } from '../../api';
import { formatTime } from '../../lib/format';
import { linkify } from '../../lib/linkify';
import { hasFormatting, parseBlocks, plainText, type Inline } from '../../lib/markdown';
import { PluginSlot } from '../../plugin-core/slots';
import { ErrorBoundary } from '../../plugin-core/ErrorBoundary';
import { formatters, useRegistry } from '../../plugin-core/registry';
import type { PopoverAnchor } from '../../ui';
import { Marked } from '../search/MessageHits';
import { MediaBlock } from './Media';
import { BusinessFooter, BusinessHeader } from './Business';
import { ContactCards, EventCard } from './Cards';
import { LocationCard } from './Location';
import { Poll } from './Poll';
import { ViewOnce } from './ViewOnce';
import './Poll.css';
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

// "@<number>" tokens the message mentions, as pieces of text and people
function splitMentions(text: string, mentions: Mention[] | undefined): (string | Mention)[] {
  const ms = (mentions ?? []).filter((m) => m.token);
  if (ms.length === 0) return [text];
  const byToken = new Map(ms.map((m) => [m.token, m]));
  // longest first, so "@123" doesn't match the start of "@12345"
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `@(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  );
  const out: (string | Mention)[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(byToken.get(m[1])!);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// a run of plain text: mentions, links and the Ctrl+F highlight
function Leaf({ text, mentions, query }: { text: string; mentions?: Mention[]; query: string }) {
  return (
    <>
      {splitMentions(text, mentions).map((part, j) =>
        typeof part !== 'string' ? (
          <span
            key={`m${j}`}
            role="button"
            tabIndex={0}
            className="wz-mention"
            title={part.name ? undefined : 'Not in your contacts'}
            onClick={(e) => {
              e.stopPropagation();
              useUI.getState().openInfo(part.jid);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') useUI.getState().openInfo(part.jid);
            }}
          >
            @{part.name || part.token}
          </span>
        ) : (
          linkify(part).map((p, i) =>
            p.type === 'link' ? (
              <a key={`${j}-${i}`} href={p.href} target="_blank" rel="noreferrer noopener">
                {p.value}
              </a>
            ) : (
              <span key={`${j}-${i}`}>
                {query ? <Marked text={p.value} query={query} /> : p.value}
              </span>
            ),
          )
        ),
      )}
    </>
  );
}

function Inlines({ xs, mentions, query }: { xs: Inline[]; mentions?: Mention[]; query: string }) {
  return (
    <>
      {xs.map((x, i) => {
        switch (x.t) {
          case 'text':
            return <Leaf key={i} text={x.v} mentions={mentions} query={query} />;
          case 'code':
            return (
              <code key={i} className="wz-md-code">
                {x.v}
              </code>
            );
          case 'b':
            return (
              <strong key={i}>
                <Inlines xs={x.c} mentions={mentions} query={query} />
              </strong>
            );
          case 'i':
            return (
              <em key={i}>
                <Inlines xs={x.c} mentions={mentions} query={query} />
              </em>
            );
          case 's':
            return (
              <s key={i}>
                <Inlines xs={x.c} mentions={mentions} query={query} />
              </s>
            );
        }
      })}
    </>
  );
}

// WhatsApp formatting: emphasis, code, quotes, lists, code blocks
function Text({ text, chat, mentions }: { text: string; chat: JID; mentions?: Mention[] }) {
  // only this chat's bubbles re-render when its Ctrl+F query changes
  const query = useUI((s) => (s.searchHighlight?.jid === chat ? s.searchHighlight.query : ''));
  const blocks = useMemo(() => (hasFormatting(text) ? parseBlocks(text) : null), [text]);
  if (!blocks) return <Leaf text={text} mentions={mentions} query={query} />;
  const inl = (xs: Inline[]) => <Inlines xs={xs} mentions={mentions} query={query} />;
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return <span key={i}>{inl(b.c)}</span>;
          case 'quote':
            return (
              <span key={i} className="wz-md-quote">
                {inl(b.c)}
              </span>
            );
          case 'pre':
            return (
              <code key={i} className="wz-md-pre">
                {b.v}
              </code>
            );
          case 'ul':
            return (
              <span key={i} className="wz-md-list" role="list">
                {b.items.map((it, j) => (
                  <span key={j} className="wz-md-item" role="listitem" data-mark="•">
                    {inl(it)}
                  </span>
                ))}
              </span>
            );
          case 'ol':
            return (
              <span key={i} className="wz-md-list" role="list">
                {b.items.map((it, j) => (
                  <span
                    key={j}
                    className="wz-md-item"
                    role="listitem"
                    data-mark={`${b.start + j}.`}
                  >
                    {inl(it)}
                  </span>
                ))}
              </span>
            );
        }
      })}
    </>
  );
}

// a plugin's formatter may draw the text; the first one that returns something wins, and a
// crashing one falls back to the plain text
function FormattedText({ m }: { m: Message }) {
  const list = useRegistry(formatters);
  const plain = <Text text={m.text} chat={m.chatJid} mentions={m.mentions} />;
  if (list.length === 0) return plain;
  const pm = toPluginMessage(m);
  for (const f of list) {
    let out: ReactNode = null;
    try {
      out = f.value(m.text, pm);
    } catch (err) {
      console.error(`[plugin ${f.pluginId}] text formatter failed`, err);
    }
    if (out != null && out !== false)
      return (
        <ErrorBoundary label={`plugin "${f.pluginId}" text formatter`} fallback={plain}>
          {out}
        </ErrorBoundary>
      );
  }
  return plain;
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
  const onceCard = hasMedia && !!m.viewOnce && (m.kind === 'image' || m.kind === 'video');
  const visualOnly = hasMedia && !onceCard && (m.kind === 'image' || m.kind === 'video') && !m.text;
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
                  <span className="wz-quote__text">{plainText(m.replyTo.text) || 'Message'}</span>
                </button>
              )}
              {onceCard ? (
                <ViewOnce m={m} />
              ) : (
                hasMedia && (
                  <MediaBlock chatJid={m.chatJid} pk={m.pk} kind={m.kind} media={m.media!} />
                )
              )}
              {m.business && !m.deleted && <BusinessHeader m={m} />}
              {m.contacts && m.contacts.length > 0 && !m.deleted && <ContactCards m={m} />}
              {m.event && !m.deleted && <EventCard m={m} />}
              {(m.contacts?.length || m.event) && !m.deleted && !m.text && (
                <span className="wz-bubble__poll-meta" aria-hidden="true" />
              )}
              {m.location && !m.deleted && <LocationCard m={m} />}
              {m.location && !m.deleted && !m.text && (
                <span className="wz-bubble__poll-meta" aria-hidden="true" />
              )}
              {m.poll && !m.deleted ? (
                <>
                  <Poll m={m} />
                  {/* room for the time, which sits in the corner */}
                  <span className="wz-bubble__poll-meta" aria-hidden="true" />
                </>
              ) : (
                m.text && (
                  <p className="wz-bubble__text wz-selectable" dir="auto">
                    <FormattedText m={m} />
                    <span className="wz-bubble__meta-spacer" aria-hidden="true">
                      <Meta m={m} />
                    </span>
                  </p>
                )
              )}
              {m.business && !m.deleted && <BusinessFooter m={m} />}
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
