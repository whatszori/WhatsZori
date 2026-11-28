import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  FileText,
  Image as ImageIcon,
  MessageSquareText,
  Play,
  Search,
} from 'lucide-react';
import { backend, type JID, type Message, type SharedKind } from '../../api';
import { formatDateTime, formatDuration, formatFileSize } from '../../lib/format';
import { linkify } from '../../lib/linkify';
import { toastError, useToasts } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Input, Segmented, Spinner } from '../../ui';
import { MediaBlock } from '../conversation/Media';

const PAGE = 60;

const TABS: { value: SharedKind; label: string }[] = [
  { value: 'media', label: 'Media' },
  { value: 'docs', label: 'Docs' },
  { value: 'links', label: 'Links' },
  { value: 'audio', label: 'Audio' },
];

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

// items with a month header before each new month
function byMonth(items: Message[]): (Message | { month: string })[] {
  const out: (Message | { month: string })[] = [];
  let last = '';
  for (const m of items) {
    const label = MONTH.format(m.timestamp);
    if (label !== last) out.push({ month: label });
    last = label;
    out.push(m);
  }
  return out;
}

const isHeader = (x: Message | { month: string }): x is { month: string } => 'month' in x;

function useShared(jid: JID, kind: SharedKind, query: string) {
  const [items, setItems] = useState<Message[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const next = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const before = items.length ? items[items.length - 1].pk : null;
      const page = await backend.messages.listShared(jid, kind, before, PAGE, query);
      setItems((cur) => [...cur, ...page.messages]);
      setMore(page.hasMore);
    } catch (err) {
      toastError(err);
      setMore(false);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [jid, kind, items, query]);

  return { items, more, loading, next };
}

// loads the next page once the sentinel at the bottom scrolls into view
function Sentinel({ onVisible, active }: { onVisible: () => void; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && onVisible(), {
      rootMargin: '300px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [onVisible, active]);
  return <div ref={ref} className="wz-shared__sentinel" />;
}

export function SharedMedia({ jid, initial }: { jid: JID; initial: SharedKind }) {
  const [kind, setKind] = useState<SharedKind>(initial);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  // search after a short pause in typing
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(typed.trim()), 250);
    return () => window.clearTimeout(t);
  }, [typed]);
  return (
    <div className="wz-shared">
      <div className="wz-shared__tabs">
        <Segmented label="Show" value={kind} options={TABS} onChange={setKind} size="sm" />
      </div>
      {/* voice notes have no text to search */}
      <div className="wz-shared__search" hidden={kind === 'audio'}>
        <Input
          icon={<Search size={15} />}
          placeholder={
            kind === 'docs'
              ? 'Search file names and captions'
              : kind === 'links'
                ? 'Search links and messages'
                : 'Search captions'
          }
          aria-label="Search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      {/* keyed so each tab and search starts from the top with its own list */}
      <SharedList key={kind + '\u0000' + query} jid={jid} kind={kind} query={query} />
    </div>
  );
}

function SharedList({ jid, kind, query }: { jid: JID; kind: SharedKind; query: string }) {
  const { items, more, loading, next } = useShared(jid, kind, query);
  const empty = !loading && !more && items.length === 0;
  const rows = byMonth(items);
  const head = (x: { month: string }) => (
    <li key={'h' + x.month} className="wz-shared__month">
      {x.month}
    </li>
  );

  return (
    <>
      {kind === 'media' && (
        <div className="wz-shared__grid">
          {rows.map((x) =>
            isHeader(x) ? (
              <div key={'h' + x.month} className="wz-shared__month wz-shared__month--grid">
                {x.month}
              </div>
            ) : (
              <MediaTile key={x.pk} m={x} items={items} />
            ),
          )}
        </div>
      )}
      {kind === 'docs' && (
        <ul className="wz-shared__list">
          {rows.map((x) => (isHeader(x) ? head(x) : <DocRow key={x.pk} m={x} />))}
        </ul>
      )}
      {kind === 'links' && (
        <ul className="wz-shared__list">
          {rows.map((x) => (isHeader(x) ? head(x) : <LinkRow key={x.pk} m={x} />))}
        </ul>
      )}
      {kind === 'audio' && (
        <ul className="wz-shared__list">
          {rows.map((x) => (isHeader(x) ? head(x) : <AudioRow key={x.pk} m={x} />))}
        </ul>
      )}
      {loading && (
        <div className="wz-shared__loading">
          <Spinner size={16} />
        </div>
      )}
      {empty && (
        <p className="wz-empty-text wz-shared__empty">
          {query
            ? 'Nothing matches'
            : kind === 'media'
              ? 'No photos or videos'
              : kind === 'docs'
                ? 'No documents'
                : kind === 'audio'
                  ? 'No voice messages'
                  : 'No links'}
        </p>
      )}
      <Sentinel onVisible={() => void next()} active={more && !loading} />
    </>
  );
}

function MediaTile({ m, items }: { m: Message; items: Message[] }) {
  const thumb = backend.media.url(m.pk, true);
  const full = backend.media.url(m.pk);
  const [src, setSrc] = useState(thumb);
  return (
    <button
      type="button"
      className="wz-shared__tile"
      onClick={() => useUI.getState().openViewer(m.chatJid, m.pk, items)}
      aria-label={m.kind === 'video' ? 'Open video' : 'Open photo'}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          // no thumbnail stored: a photo can fall back to the full file, a video can't
          onError={() => setSrc(m.kind === 'image' && src !== full ? full : '')}
        />
      ) : (
        <ImageIcon size={18} className="wz-shared__placeholder" />
      )}
      {m.kind === 'video' && (
        <span className="wz-shared__badge">
          <Play size={11} fill="currentColor" />
          {m.media?.gif ? 'GIF' : formatDuration(m.media?.duration ?? 0)}
        </span>
      )}
    </button>
  );
}

function jump(m: Message) {
  useUI.getState().jumpTo(m.chatJid, m.pk);
}

function DocRow({ m }: { m: Message }) {
  const name = m.media?.fileName || 'Document';
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase().slice(0, 4) : 'FILE';
  const save = async () => {
    try {
      const path = await backend.media.saveAs(m.pk);
      if (path)
        useToasts.getState().push({ kind: 'info', text: `Saved as ${path.split(/[\\/]/).pop()}` });
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <li className="wz-shared__row">
      <button
        type="button"
        className="wz-shared__row-main"
        onClick={() => void save()}
        title="Save as…"
      >
        <span className="wz-shared__doc-icon">
          <FileText size={18} />
          <span>{ext}</span>
        </span>
        <span className="wz-shared__row-text">
          <span className="wz-shared__row-title">{name}</span>
          <span className="wz-shared__row-meta">
            {[
              m.media?.size ? formatFileSize(m.media.size) : null,
              formatDateTime(m.timestamp),
              m.senderName,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="wz-shared__row-side"
        onClick={() => jump(m)}
        aria-label="Show in chat"
        title="Show in chat"
      >
        <MessageSquareText size={16} />
      </button>
    </li>
  );
}

function LinkRow({ m }: { m: Message }) {
  const links = linkify(m.text).filter((p) => p.type === 'link');
  const first = links[0];
  if (!first || first.type !== 'link') return null;
  let host = first.value;
  try {
    host = new URL(first.href).hostname.replace(/^www\./, '');
  } catch {
    // keep the raw text
  }
  return (
    <li className="wz-shared__row">
      <button
        type="button"
        className="wz-shared__row-main"
        onClick={() => void backend.system.openExternal(first.href).catch(toastError)}
        title={first.href}
      >
        <span className="wz-shared__link-icon">
          <ExternalLink size={16} />
        </span>
        <span className="wz-shared__row-text">
          <span className="wz-shared__row-title">{host}</span>
          <span className="wz-shared__row-link">{first.value}</span>
          <span className="wz-shared__row-meta">
            {formatDateTime(m.timestamp)} · {m.senderName}
            {links.length > 1 ? ` · +${links.length - 1} more` : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="wz-shared__row-side"
        onClick={() => jump(m)}
        aria-label="Show in chat"
        title="Show in chat"
      >
        <MessageSquareText size={16} />
      </button>
    </li>
  );
}

function AudioRow({ m }: { m: Message }) {
  return (
    <li className="wz-shared__row wz-shared__row--audio">
      <div className="wz-shared__row-main wz-shared__audio">
        <MediaBlock chatJid={m.chatJid} pk={m.pk} kind={m.kind} media={m.media!} />
        <span className="wz-shared__row-meta">
          {formatDateTime(m.timestamp)} · {m.senderName}
        </span>
      </div>
      <button
        type="button"
        className="wz-shared__row-side"
        onClick={() => jump(m)}
        aria-label="Show in chat"
        title="Show in chat"
      >
        <MessageSquareText size={16} />
      </button>
    </li>
  );
}
