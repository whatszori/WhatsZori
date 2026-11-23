import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Ghost, Trash2 } from 'lucide-react';
import { backend, type StatusGroup, type StatusItem } from '../../api';
import { formatDateTime, formatFileSize } from '../../lib/format';
import { useSettings } from '../../stores/settings';
import { toastError, useToasts } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Avatar, Button, Dialog, IconButton, Toggle, useLayer } from '../../ui';
import './Status.css';

// The Status screen: people with updates on the left, the one being watched on the right.
export function StatusView() {
  const [groups, setGroups] = useState<StatusGroup[] | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<{ jid: string; index: number; ghost: boolean } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const statusGhost = useSettings((s) => s.ghost.statusGhost);
  const close = () => useUI.getState().closeStatus();
  useLayer(!open && !asking, close);

  const load = useCallback(() => {
    backend.status
      .list(all)
      .then(setGroups)
      .catch((err) => toastError(err));
  }, [all]);

  useEffect(() => {
    load();
    return backend.on('status:update', load);
  }, [load]);

  const start = (jid: string, ghost: boolean) => {
    const g = groups?.find((x) => x.jid === jid);
    if (!g) return;
    // start at the first one not seen yet
    const first = g.items.findIndex((it) => !it.seen);
    setOpen({ jid, index: first < 0 ? 0 : first, ghost });
  };

  const pick = (g: StatusGroup) => {
    // ours, or ghost mode for statuses on: nothing to ask
    if (g.mine || statusGhost) start(g.jid, true);
    else setAsking(g.jid);
  };

  const group = open ? groups?.find((g) => g.jid === open.jid) : undefined;
  return (
    <div className="wz-status">
      <aside className="wz-status__list" aria-label="Status updates">
        <header className="wz-status__header">
          <IconButton
            label="Back to chats"
            hint="Esc"
            icon={<ArrowLeft size={18} />}
            onClick={close}
          />
          <h1 className="wz-status__title">Status</h1>
          {statusGhost && (
            <span className="wz-status__ghost" title="Ghost mode for statuses is on">
              <Ghost size={16} />
            </span>
          )}
        </header>
        <div className="wz-status__toggle">
          <Toggle
            label="Show older"
            description="Statuses WhatsZori kept after their 24 hours"
            checked={all}
            onChange={setAll}
          />
        </div>
        {groups && groups.length === 0 && (
          <p className="wz-status__empty">No status updates{all ? '' : ' in the last 24 hours'}.</p>
        )}
        <ul className="wz-status__people">
          {(groups ?? []).map((g) => (
            <li key={g.jid}>
              <button
                type="button"
                className={`wz-status__person${open?.jid === g.jid ? ' wz-status__person--active' : ''}`}
                onClick={() => pick(g)}
              >
                <span className={`wz-status__ring${g.unseen ? ' wz-status__ring--new' : ''}`}>
                  <Avatar name={g.name} jid={g.mine ? undefined : g.jid} size={40} />
                </span>
                <span className="wz-status__who">
                  <span className="wz-status__name">{g.name}</span>
                  <span className="wz-status__when">
                    {formatDateTime(g.lastTs)} · {g.items.length}
                    {g.items.some((it) => it.message.deleted) && ' · some deleted'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="wz-status__stage" aria-label="Status">
        {group && open ? (
          <Viewer
            key={group.jid}
            group={group}
            index={Math.min(open.index, group.items.length - 1)}
            ghost={open.ghost}
            onIndex={(index) => setOpen({ ...open, index })}
            onClose={() => setOpen(null)}
            onSeen={load}
          />
        ) : (
          <p className="wz-status__hint">
            Pick someone on the left. Deleted statuses stay here, and photos and videos can be
            saved.
          </p>
        )}
      </section>

      <Dialog
        open={!!asking}
        title="View in ghost mode?"
        onClose={() => setAsking(null)}
        footer={
          <>
            <Button
              onClick={() => {
                if (asking) start(asking, false);
                setAsking(null);
              }}
            >
              No, let them know
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (asking) start(asking, true);
                setAsking(null);
              }}
            >
              Ghost mode
            </Button>
          </>
        }
      >
        <p className="wz-dialog-text">
          In ghost mode {groups?.find((g) => g.jid === asking)?.name ?? 'they'} won’t see that you
          viewed the status. To stop being asked, turn on ghost mode for statuses in Settings →
          Privacy.
        </p>
      </Dialog>
    </div>
  );
}

function Viewer({
  group,
  index,
  ghost,
  onIndex,
  onClose,
  onSeen,
}: {
  group: StatusGroup;
  index: number;
  ghost: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  onSeen: () => void;
}) {
  const item: StatusItem = group.items[index];
  const m = item.message;
  useLayer(true, onClose);

  useEffect(() => {
    if (item.seen && ghost) return;
    let alive = true;
    backend.status
      .view(m.pk, ghost)
      .then(() => alive && onSeen())
      .catch((err) => toastError(err));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per status shown
  }, [m.pk]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && index < group.items.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, group.items.length, onIndex]);

  const url = m.media ? backend.media.url(m.pk) : '';
  const save = () =>
    void backend.media
      .saveAs(m.pk)
      .then((path) => {
        if (path)
          useToasts
            .getState()
            .push({ kind: 'info', text: `Saved as ${path.split(/[\\/]/).pop()}` });
      })
      .catch((err) => toastError(err));

  return (
    <div className="wz-status-viewer">
      <div className="wz-status-viewer__bars" aria-hidden="true">
        {group.items.map((it, i) => (
          <span key={it.message.pk} className={i < index ? 'done' : i === index ? 'current' : ''} />
        ))}
      </div>
      <header className="wz-status-viewer__top">
        <Avatar name={group.name} jid={group.mine ? undefined : group.jid} size={36} />
        <span className="wz-status-viewer__who">
          <span className="wz-status-viewer__name">{group.name}</span>
          <span className="wz-status-viewer__time">
            {formatDateTime(m.timestamp)}
            {ghost && !group.mine && ' · ghost'}
          </span>
        </span>
        {m.media && backend.media.canAttach && (
          <IconButton label="Save as…" icon={<Download size={18} />} onClick={save} />
        )}
        <IconButton label="Close" hint="Esc" icon={<ArrowLeft size={18} />} onClick={onClose} />
      </header>

      <div
        className="wz-status-viewer__content"
        style={!m.media && item.background ? { background: item.background } : undefined}
      >
        {m.media &&
          m.kind === 'image' &&
          (url ? (
            <img src={url} alt={m.text || 'Status photo'} />
          ) : (
            <div className="wz-status-viewer__placeholder">
              Photo · {formatFileSize(m.media.size ?? 0)}
            </div>
          ))}
        {m.media &&
          m.kind === 'video' &&
          (url ? (
            <video key={m.pk} src={url} controls autoPlay />
          ) : (
            <div className="wz-status-viewer__placeholder">Video</div>
          ))}
        {m.media && m.kind !== 'image' && m.kind !== 'video' && (
          <div className="wz-status-viewer__placeholder">{m.kind}</div>
        )}
        {!m.media && (
          <p className="wz-status-viewer__text wz-selectable" dir="auto">
            {m.text}
          </p>
        )}
        {index > 0 && (
          <button
            type="button"
            className="wz-status-viewer__nav wz-status-viewer__nav--prev"
            aria-label="Previous"
            onClick={() => onIndex(index - 1)}
          >
            <ChevronLeft size={28} />
          </button>
        )}
        {index < group.items.length - 1 && (
          <button
            type="button"
            className="wz-status-viewer__nav wz-status-viewer__nav--next"
            aria-label="Next"
            onClick={() => onIndex(index + 1)}
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {m.media && m.text && (
        <p className="wz-status-viewer__caption wz-selectable" dir="auto">
          {m.text}
        </p>
      )}
      {m.deleted && (
        <p className="wz-status-viewer__deleted">
          <Trash2 size={14} /> Deleted by {m.deleted.byName} · {formatDateTime(m.deleted.at)} · kept
          by WhatsZori
        </p>
      )}
    </div>
  );
}
