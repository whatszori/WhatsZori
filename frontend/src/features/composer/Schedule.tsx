import { useEffect, useState } from 'react';
import { AlertCircle, Clock, Pencil, SendHorizontal, Trash2 } from 'lucide-react';
import { backend, type JID, type ScheduledMessage } from '../../api';
import { formatDateTime } from '../../lib/format';
import { plainText } from '../../lib/markdown';
import { toastError, useToasts } from '../../stores/toasts';
import { Button, Dialog, IconButton, Input } from '../../ui';
import './Schedule.css';

// Messages to send later: picking the time, the strip above the composer, and the list.

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function quickPicks(now: Date): { label: string; at: Date }[] {
  const inHour = new Date(now.getTime() + 3600_000);
  inHour.setSeconds(0, 0);
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  const morning = new Date(now);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(9, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  monday.setHours(9, 0, 0, 0);
  return [
    { label: 'In an hour', at: inHour },
    ...(tonight > now ? [{ label: 'Tonight, 20:00', at: tonight }] : []),
    { label: 'Tomorrow, 9:00', at: morning },
    { label: 'Monday, 9:00', at: monday },
  ];
}

// Picks a time (and, when editing, the text). onPick gets ms; it may throw to keep the dialog.
export function ScheduleDialog({
  title,
  text: initialText,
  at: initialAt,
  editText,
  onPick,
  onClose,
}: {
  title: string;
  text: string;
  at?: number;
  editText?: boolean;
  onPick: (at: number, text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [now] = useState(() => new Date());
  const start = new Date(initialAt ?? now.getTime() + 3600_000);
  const [date, setDate] = useState(dateValue(start));
  const [time, setTime] = useState(timeValue(start));
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);

  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const at = new Date(y, mo - 1, d, h, mi).getTime();
  const ok = Number.isFinite(at) && at > now.getTime() && text.trim().length > 0;

  const pick = async (when: number) => {
    setBusy(true);
    try {
      await onPick(when, text);
      onClose();
    } catch (err) {
      toastError(err, 'Not scheduled');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok || busy} onClick={() => void pick(at)}>
            Schedule
          </Button>
        </>
      }
    >
      {editText ? (
        <textarea
          className="wz-sched__text"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Message"
        />
      ) : (
        <p className="wz-sched__preview">{plainText(text)}</p>
      )}
      <div className="wz-sched__quick">
        {quickPicks(now).map((q) => (
          <button
            key={q.label}
            type="button"
            className="wz-sched__chip"
            disabled={busy || !text.trim()}
            onClick={() => void pick(q.at.getTime())}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className="wz-sched__when">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
        />
        <Input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Time"
        />
      </div>
      <p className="wz-sched__note">
        Sent from this computer at that time, so WhatsZori needs to be running and online then. If
        it wasn’t, it sends when it’s back, unless that’s more than 12 hours late.
      </p>
    </Dialog>
  );
}

export function useScheduled(jid: JID) {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      backend.messages
        .scheduled(jid)
        .then((list) => live && setItems(list))
        .catch(() => {});
    void load();
    const off = backend.on('scheduled:changed', (e) => {
      if (e.chatJid === jid) void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [jid]);
  return items;
}

// "2 scheduled messages · next at 09:00" above the composer
export function ScheduledBar({ jid }: { jid: JID }) {
  const items = useScheduled(jid);
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const failed = items.some((i) => i.error);
  return (
    <>
      <button
        type="button"
        className={`wz-sched-bar${failed ? ' wz-sched-bar--warn' : ''}`}
        onClick={() => setOpen(true)}
      >
        {failed ? <AlertCircle size={14} /> : <Clock size={14} />}
        <span>
          {items.length === 1 ? '1 scheduled message' : `${items.length} scheduled messages`} · next{' '}
          {formatDateTime(items[0].sendAt)}
        </span>
      </button>
      {open && <ScheduledList items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

function ScheduledList({ items, onClose }: { items: ScheduledMessage[]; onClose: () => void }) {
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const run = async (p: Promise<unknown>, done?: string) => {
    try {
      await p;
      if (done) useToasts.getState().push({ kind: 'info', text: done });
    } catch (err) {
      toastError(err);
    }
  };
  useEffect(() => {
    if (items.length === 0) onClose();
  }, [items.length, onClose]);
  return (
    <>
      <Dialog open={!editing} title="Scheduled messages" onClose={onClose} width={460}>
        <ul className="wz-sched__list">
          {items.map((m) => (
            <li key={m.id} className="wz-sched__item">
              <div className="wz-sched__item-main">
                <span className="wz-sched__item-time">
                  <Clock size={12} /> {formatDateTime(m.sendAt)}
                </span>
                <span className="wz-sched__item-text">{plainText(m.text)}</span>
                {m.error && <span className="wz-sched__item-error">{m.error}</span>}
              </div>
              <div className="wz-sched__item-actions">
                <IconButton
                  label="Send now"
                  icon={<SendHorizontal size={16} />}
                  onClick={() => void run(backend.messages.sendScheduledNow(m.id), 'Sent')}
                />
                <IconButton
                  label="Edit"
                  icon={<Pencil size={16} />}
                  onClick={() => setEditing(m)}
                />
                <IconButton
                  label="Delete"
                  icon={<Trash2 size={16} />}
                  onClick={() => void run(backend.messages.unschedule(m.id))}
                />
              </div>
            </li>
          ))}
        </ul>
      </Dialog>
      {editing && (
        <ScheduleDialog
          title="Edit scheduled message"
          text={editing.text}
          at={editing.sendAt}
          editText
          onPick={(at, text) => backend.messages.reschedule(editing.id, text, at)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
