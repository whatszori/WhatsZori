import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, History, Pencil, Trash2 } from 'lucide-react';
import { backend, type ChangeItem, type ChangeKind, type EditVersion } from '../../api';
import { formatDateTime } from '../../lib/format';
import { toastError } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Avatar, Button, IconButton, Segmented, Spinner, useLayer } from '../../ui';
import './Changes.css';

const PAGE = 50;
const KIND_LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  voice: 'Voice message',
  document: 'Document',
  sticker: 'Sticker',
  poll: 'Poll',
};

// "Deleted & edited": every deleted message WhatsZori kept and every edit, across all chats.
export function ChangesView() {
  const [kind, setKind] = useState<ChangeKind>('');
  const [items, setItems] = useState<ChangeItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const close = () => useUI.getState().closeChanges();
  useLayer(true, close);
  const gen = useRef(0);

  const load = useCallback(
    async (more: boolean) => {
      const g = ++gen.current;
      setLoading(true);
      try {
        const last = more ? items[items.length - 1] : undefined;
        const page = await backend.messages.changes(
          kind,
          last ? { at: last.at, pk: last.message.pk } : null,
          PAGE,
        );
        if (g !== gen.current) return;
        setItems((cur) => (more ? [...cur, ...page.items] : page.items));
        setHasMore(page.hasMore);
      } catch (err) {
        toastError(err);
      } finally {
        if (g === gen.current) setLoading(false);
      }
    },
    [kind, items],
  );

  // first page on open and on filter change; again when something gets deleted or edited
  const loadFirst = useRef(load);
  useEffect(() => {
    loadFirst.current = load;
  });
  useEffect(() => {
    void loadFirst.current(false);
  }, [kind]);
  useEffect(() => {
    let t: number | undefined;
    const refresh = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void loadFirst.current(false), 400);
    };
    const offs = [backend.on('msg:deleted', refresh), backend.on('msg:edited', refresh)];
    return () => {
      window.clearTimeout(t);
      offs.forEach((off) => off());
    };
  }, []);

  return (
    <div className="wz-changes">
      <header className="wz-changes__header">
        <IconButton
          label="Back to chats"
          hint="Esc"
          icon={<ArrowLeft size={18} />}
          onClick={close}
        />
        <h1 className="wz-changes__title">Deleted &amp; edited</h1>
        <Segmented<ChangeKind>
          label="Show"
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: '', label: 'All' },
            { value: 'deleted', label: 'Deleted' },
            { value: 'edited', label: 'Edited' },
          ]}
        />
      </header>
      <div className="wz-changes__body">
        {items.length === 0 && !loading && (
          <p className="wz-changes__empty">
            {kind === 'edited'
              ? 'No edited messages yet.'
              : 'Nothing here yet. Messages people delete or edit show up here, with what they said.'}
          </p>
        )}
        <ul className="wz-changes__list">
          {items.map((it) => (
            <Item key={`${it.message.pk}-${it.change}`} it={it} />
          ))}
        </ul>
        {loading && (
          <div className="wz-changes__loading">
            <Spinner size={18} />
          </div>
        )}
        {hasMore && !loading && (
          <div className="wz-changes__more">
            <Button onClick={() => void load(true)}>Load more</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Item({ it }: { it: ChangeItem }) {
  const m = it.message;
  const [history, setHistory] = useState<EditVersion[] | null>(null);
  const deleted = it.change === 'deleted';
  const who = m.fromMe ? 'You' : m.senderName;
  const label = KIND_LABEL[m.kind];
  const open = () => {
    useUI.getState().openChat(it.chatJid);
    useUI.getState().jumpTo(it.chatJid, m.pk);
  };

  return (
    <li className={`wz-change wz-change--${it.change}`}>
      <button type="button" className="wz-change__head" onClick={open} title="Show in chat">
        <Avatar name={it.chatName} jid={it.chatJid} size={32} />
        <span className="wz-change__where">
          <span className="wz-change__chat">{it.chatName}</span>
          {who !== it.chatName && <span className="wz-change__who">{who}</span>}
        </span>
        <span className="wz-change__what">
          {deleted ? <Trash2 size={13} /> : <Pencil size={13} />}
          {deleted
            ? `Deleted${m.deleted && m.deleted.byJid !== m.senderJid ? ` by ${m.deleted.byName}` : ''}`
            : 'Edited'}
          {' · '}
          {formatDateTime(it.at)}
        </span>
      </button>
      <div className="wz-change__body" dir="auto">
        {label && <span className="wz-change__kind">{label}</span>}
        {m.text && <p className="wz-change__text wz-selectable">{m.text}</p>}
        {!m.text && !label && <p className="wz-change__text wz-change__text--none">No text</p>}
      </div>
      {!!m.editCount && (
        <div className="wz-change__history">
          {history ? (
            <ol>
              {history.slice(0, -1).map((v, i) => (
                <li key={i}>
                  <time>{formatDateTime(v.at)}</time>
                  <span className="wz-selectable" dir="auto">
                    {v.text}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <button
              type="button"
              className="wz-change__history-btn"
              onClick={() =>
                void backend.messages
                  .getEditHistory(m.pk)
                  .then(setHistory)
                  .catch((err) => toastError(err))
              }
            >
              <History size={13} />
              {m.editCount === 1
                ? 'Show the earlier version'
                : `Show ${m.editCount} earlier versions`}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
