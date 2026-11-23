import { useEffect, useState } from 'react';
import { LogIn, LogOut, ShieldCheck, ShieldOff, Sparkles, UserMinus, UserPlus } from 'lucide-react';
import { backend, type GroupEvent, type JID } from '../../api';
import { formatDateTime } from '../../lib/format';
import { toastError } from '../../stores/toasts';
import { Button, Dialog, Spinner } from '../../ui';
import './MembershipDialog.css';

function describe(e: GroupEvent): string {
  const who = e.actorName || 'Someone';
  switch (e.kind) {
    case 'add':
      return `${who} added ${e.targetName}`;
    case 'remove':
      return `${who} removed ${e.targetName}`;
    case 'leave':
      return `${e.targetName} left`;
    case 'join':
      return `${e.targetName} joined`;
    case 'promote':
      return `${who} made ${e.targetName} an admin`;
    case 'demote':
      return `${who} removed ${e.targetName} as admin`;
    case 'create':
      return `${who} created the group`;
  }
  return e.kind;
}

const ICONS = {
  add: UserPlus,
  remove: UserMinus,
  leave: LogOut,
  join: LogIn,
  promote: ShieldCheck,
  demote: ShieldOff,
  create: Sparkles,
} as const;

export function MembershipDialog({ jid, onClose }: { jid: JID; onClose: () => void }) {
  const [events, setEvents] = useState<GroupEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    backend.chats
      .groupEvents(jid)
      .then((e) => alive && setEvents(e))
      .catch((err) => {
        toastError(err);
        if (alive) setEvents([]);
      });
    return () => {
      alive = false;
    };
  }, [jid]);

  return (
    <Dialog
      open
      title="Membership changes"
      onClose={onClose}
      width={440}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {!events ? (
        <div className="wz-members-log__loading">
          <Spinner size={18} />
        </div>
      ) : events.length === 0 ? (
        <p className="wz-dialog-text">Nothing recorded yet.</p>
      ) : (
        <ol className="wz-members-log">
          {events.map((e, i) => {
            const Icon = ICONS[e.kind] ?? UserPlus;
            return (
              <li key={i} className={`wz-members-log__item wz-members-log__item--${e.kind}`}>
                <Icon size={16} aria-hidden="true" />
                <span className="wz-members-log__text">{describe(e)}</span>
                <time className="wz-members-log__time">{formatDateTime(e.at)}</time>
              </li>
            );
          })}
        </ol>
      )}
      <p className="wz-members-log__note">
        Changes WhatsZori saw since it was linked, plus what the phone sent along with the chat
        history. WhatsApp doesn’t keep anything older.
      </p>
    </Dialog>
  );
}
