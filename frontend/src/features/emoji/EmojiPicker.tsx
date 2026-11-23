import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Clock, ImagePlus, Search, Trash2 } from 'lucide-react';
import { backend, type JID, type Sticker } from '../../api';
import { useMessages } from '../../stores/messages';
import { toastError } from '../../stores/toasts';
import { Input, Segmented, Spinner } from '../../ui';
import {
  loadEmoji,
  recentEmoji,
  rememberEmoji,
  saveTone,
  savedTone,
  searchEmoji,
  withTone,
  type EmojiGroup,
  type EmojiItem,
} from './emoji-data';
import { makeSticker } from './make-sticker';
import './EmojiPicker.css';

const TONES = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'];

type Tab = 'emoji' | 'stickers';

// The composer's emoji button: the whole emoji set, and a sticker tab.
export function EmojiPicker({
  jid,
  onEmoji,
  onClose,
}: {
  jid: JID;
  onEmoji: (e: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('emoji');
  return (
    <div className="wz-picker">
      <div className="wz-picker__tabs">
        <Segmented<Tab>
          label="Picker"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'emoji', label: 'Emoji' },
            { value: 'stickers', label: 'Stickers' },
          ]}
        />
      </div>
      {tab === 'emoji' ? <EmojiTab onEmoji={onEmoji} /> : <StickerTab jid={jid} onSent={onClose} />}
    </div>
  );
}

function EmojiTab({ onEmoji }: { onEmoji: (e: string) => void }) {
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null);
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState(savedTone);
  const [recent, setRecent] = useState(recentEmoji);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    loadEmoji()
      .then((g) => alive && setGroups(g))
      .catch((err) => toastError(err));
    const t = window.setTimeout(() => input.current?.focus(), 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);

  const results = useMemo(
    () => (groups && query.trim() ? searchEmoji(groups, query) : null),
    [groups, query],
  );

  const pick = (e: string) => {
    rememberEmoji(e);
    setRecent(recentEmoji());
    onEmoji(e);
  };

  const cell = (it: EmojiItem) => {
    const e = withTone(it, tone);
    return (
      <button
        key={it.emoji}
        type="button"
        className="wz-picker__emoji"
        title={it.label}
        aria-label={it.label}
        onClick={() => pick(e)}
      >
        {e}
      </button>
    );
  };

  return (
    <>
      <div className="wz-picker__search">
        <Input
          ref={input}
          icon={<Search size={14} />}
          placeholder="Search emoji"
          aria-label="Search emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="wz-picker__tone"
          title="Skin tone"
          aria-label="Skin tone"
          onClick={() => {
            const next = (tone + 1) % TONES.length;
            setTone(next);
            saveTone(next);
          }}
        >
          {TONES[tone]}
        </button>
      </div>
      {!results && groups && (
        <nav className="wz-picker__groups" aria-label="Emoji categories">
          {recent.length > 0 && (
            <button
              type="button"
              title="Recent"
              aria-label="Recent"
              onClick={() => body.current?.scrollTo({ top: 0 })}
            >
              <Clock size={16} />
            </button>
          )}
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              title={g.label}
              aria-label={g.label}
              onClick={() =>
                body.current
                  ?.querySelector(`[data-group="${g.key}"]`)
                  ?.scrollIntoView({ block: 'start' })
              }
            >
              {g.icon}
            </button>
          ))}
        </nav>
      )}
      <div className="wz-picker__body" ref={body}>
        {!groups && (
          <div className="wz-picker__loading">
            <Spinner size={18} />
          </div>
        )}
        {results &&
          (results.length ? (
            <div className="wz-picker__grid">{results.map(cell)}</div>
          ) : (
            <p className="wz-picker__empty">No emoji found</p>
          ))}
        {!results && groups && (
          <>
            {recent.length > 0 && (
              <section>
                <h3 className="wz-picker__heading">Recent</h3>
                <div className="wz-picker__grid">
                  {recent.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="wz-picker__emoji"
                      aria-label={e}
                      onClick={() => pick(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {groups.map((g) => (
              <section key={g.key} data-group={g.key}>
                <h3 className="wz-picker__heading">{g.label}</h3>
                <div className="wz-picker__grid">{g.items.map(cell)}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function StickerTab({ jid, onSent }: { jid: JID; onSent: () => void }) {
  const [mine, setMine] = useState<Sticker[] | null>(null);
  const [recent, setRecent] = useState<Sticker[]>([]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = () => {
    backend.stickers
      .mine()
      .then(setMine)
      .catch(() => setMine([]));
    backend.stickers
      .recent()
      .then(setRecent)
      .catch(() => setRecent([]));
  };
  useEffect(load, []);

  const send = async (s: Sticker) => {
    try {
      const m = await backend.stickers.send(jid, s.id);
      useMessages.getState().receive([m]);
      onSent();
    } catch (err) {
      toastError(err, 'Sticker not sent');
    }
  };

  const add = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      await backend.stickers.add(await makeSticker(f));
      load();
    } catch (err) {
      toastError(err, 'Could not make a sticker');
    } finally {
      setBusy(false);
    }
  };

  const grid = (list: Sticker[], removable: boolean) => (
    <div className="wz-picker__stickers">
      {list.map((s) => (
        <div key={s.id} className="wz-picker__sticker">
          <button
            type="button"
            aria-label="Send sticker"
            onClick={() => void send(s)}
            style={{ backgroundImage: `url("${s.url}")` }}
          />
          {removable && (
            <button
              type="button"
              className="wz-picker__sticker-remove"
              aria-label="Remove sticker"
              title="Remove"
              onClick={() =>
                void backend.stickers
                  .remove(s.id)
                  .then(load)
                  .catch((err) => toastError(err))
              }
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="wz-picker__body">
      <section>
        <h3 className="wz-picker__heading">
          My stickers
          <button
            type="button"
            className="wz-picker__add"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            {busy ? <Spinner size={12} /> : <ImagePlus size={14} />} Add from a picture
          </button>
        </h3>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => void add(e)}
        />
        {mine && mine.length === 0 ? (
          <p className="wz-picker__empty">
            Make one from any picture. It becomes a 512×512 sticker with a transparent border.
          </p>
        ) : (
          grid(mine ?? [], true)
        )}
      </section>
      {recent.length > 0 && (
        <section>
          <h3 className="wz-picker__heading">From your chats</h3>
          {grid(recent, false)}
        </section>
      )}
    </div>
  );
}
