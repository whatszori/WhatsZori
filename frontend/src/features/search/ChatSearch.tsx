import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { backend, type JID, type SearchHit } from '../../api';
import { useUI } from '../../stores/ui';
import { IconButton, Input, useLayer } from '../../ui';
import './Search.css';

// Ctrl+F inside a chat: the bar under the header, stepping through matches newest first.
export function ChatSearch({ jid, onClose }: { jid: JID; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useLayer(true, onClose);

  useEffect(() => {
    input.current?.focus();
    return () => useUI.getState().setSearchHighlight(null);
  }, []);

  useEffect(() => {
    const q = query.trim();
    useUI.getState().setSearchHighlight(q ? { jid, query: q } : null);
    if (q.length < 2) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void backend.messages
        .search(q, jid)
        .then((h) => {
          if (!alive) return;
          setHits(h);
          setIndex(0);
          setDone(q);
          if (h[0]) useUI.getState().jumpTo(jid, h[0].message.pk);
        })
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query, jid]);

  const go = (d: number) => {
    if (hits.length === 0) return;
    const i = (index + d + hits.length) % hits.length;
    setIndex(i);
    useUI.getState().jumpTo(jid, hits[i].message.pk);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      // Enter and Up go back in time (older), Shift+Enter and Down forward
      go(e.key === 'ArrowDown' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
    }
  };

  const q = query.trim();
  const ready = q.length >= 2 && done === q;
  return (
    <div className="wz-chat-search" role="search">
      <Input
        ref={input}
        icon={<Search size={16} />}
        placeholder="Search in this chat"
        aria-label="Search in this chat"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
      />
      <span className="wz-chat-search__count" aria-live="polite">
        {ready ? (hits.length ? `${index + 1} of ${hits.length}` : 'No results') : ''}
      </span>
      <IconButton
        label="Older"
        hint="Enter"
        size="sm"
        icon={<ChevronUp size={16} />}
        disabled={!ready || !hits.length}
        onClick={() => go(1)}
      />
      <IconButton
        label="Newer"
        hint="Shift+Enter"
        size="sm"
        icon={<ChevronDown size={16} />}
        disabled={!ready || !hits.length}
        onClick={() => go(-1)}
      />
      <IconButton
        label="Close search"
        hint="Esc"
        size="sm"
        icon={<X size={16} />}
        onClick={onClose}
      />
    </div>
  );
}
