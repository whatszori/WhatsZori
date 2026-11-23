import { useEffect, useState } from 'react';
import { backend, type SearchHit } from '../../api';
import { formatChatTime } from '../../lib/format';
import { highlight } from '../../lib/highlight';
import { useChats } from '../../stores/chats';
import { useUI } from '../../stores/ui';
import { Avatar, Spinner } from '../../ui';
import './Search.css';

const MIN_CHARS = 2;

export function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="wz-mark">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

// The "Messages" part of the sidebar search, under the matching chats.
export function MessageHits({ query }: { query: string }) {
  const q = query.trim();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [forQuery, setForQuery] = useState('');
  const chats = useChats((s) => s.chats);

  useEffect(() => {
    if (q.length < MIN_CHARS) return;
    let alive = true;
    const t = window.setTimeout(() => {
      backend.messages
        .search(q)
        .then((h) => {
          if (!alive) return;
          setHits(h);
          setForQuery(q);
        })
        .catch(() => alive && setHits([]));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  if (q.length < MIN_CHARS) return null;
  const loading = forQuery !== q;
  return (
    <section className="wz-hits" aria-label="Messages">
      <h2 className="wz-hits__title">
        Messages
        {loading ? (
          <Spinner size={12} />
        ) : (
          hits && <span className="wz-hits__count">{hits.length}</span>
        )}
      </h2>
      {!loading && hits?.length === 0 && (
        <p className="wz-empty-text wz-hits__empty">No messages found</p>
      )}
      <ul className="wz-hits__list">
        {(hits ?? []).map((h) => {
          const chat = chats[h.chatJid];
          const m = h.message;
          return (
            <li key={m.pk}>
              <button
                type="button"
                className="wz-hit"
                onClick={() => {
                  useUI.getState().openChat(h.chatJid);
                  useUI.getState().jumpTo(h.chatJid, m.pk);
                }}
              >
                <Avatar name={h.chatName} jid={h.chatJid} size={38} group={chat?.isGroup} />
                <span className="wz-hit__text">
                  <span className="wz-hit__top">
                    <span className="wz-hit__chat">{h.chatName}</span>
                    <span className="wz-hit__time">{formatChatTime(m.timestamp)}</span>
                  </span>
                  <span className="wz-hit__body" dir="auto">
                    {(chat?.isGroup || m.fromMe) && (
                      <span className="wz-hit__sender">{m.fromMe ? 'You' : m.senderName}: </span>
                    )}
                    <Marked text={m.text} query={forQuery} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
