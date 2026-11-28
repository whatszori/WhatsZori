import { useEffect, useState } from 'react';
import { CheckCheck, Check, Clock, Play } from 'lucide-react';
import { backend, type Message, type MessageReceipts, type ReceiptPerson } from '../../api';
import { formatDateTime } from '../../lib/format';
import { useChats } from '../../stores/chats';
import { Avatar, Dialog, Spinner } from '../../ui';
import './MessageInfoDialog.css';

const STATUS: Record<string, string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
};

// Who a message of ours reached and who read it, per person (groups and 1:1 alike), kept fresh
// while the dialog is open. Plus the usual facts about the message.
export function MessageInfoDialog({
  message: m,
  onClose,
}: {
  message: Message | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!m} title="Message info" onClose={onClose} width={420}>
      {m && <Body m={m} />}
    </Dialog>
  );
}

function Body({ m }: { m: Message }) {
  const isGroup = useChats((s) => !!s.chats[m.chatJid]?.isGroup);
  const [receipts, setReceipts] = useState<MessageReceipts | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!m.fromMe) return;
    let gone = false;
    const load = () =>
      backend.messages
        .receipts(m.pk)
        .then((r) => !gone && setReceipts(r))
        .catch(() => !gone && setFailed(true));
    void load();
    // a new tick on this message: someone else got it or read it
    const off = backend.on('msg:status', (e) => e.pk === m.pk && void load());
    return () => {
      gone = true;
      off();
    };
  }, [m.fromMe, m.pk]);

  const facts: [string, string][] = [
    ['From', m.fromMe ? 'You' : m.senderName],
    ['Sent', formatDateTime(m.timestamp)],
    ...(m.fromMe && m.status ? ([['Status', STATUS[m.status]]] as [string, string][]) : []),
    ...(m.editedAt
      ? ([['Last edited', `${formatDateTime(m.editedAt)} (${m.editCount ?? 1}×)`]] as [
          string,
          string,
        ][])
      : []),
    ...(m.deleted
      ? ([['Deleted', `${formatDateTime(m.deleted.at)} by ${m.deleted.byName}`]] as [
          string,
          string,
        ][])
      : []),
    ['Type', m.kind],
    ['Message ID', m.id],
  ];

  const people = receipts?.people ?? [];
  const read = people.filter((p) => p.readAt || p.playedAt);
  const delivered = people.filter((p) => !p.readAt && !p.playedAt && p.deliveredAt);
  const waiting = people.filter((p) => !p.readAt && !p.playedAt && !p.deliveredAt);

  return (
    <div className="wz-minfo">
      {m.fromMe && (
        <section className="wz-minfo__receipts">
          {!receipts && !failed && (
            <div className="wz-minfo__loading">
              <Spinner size={16} />
            </div>
          )}
          {failed && <p className="wz-minfo__empty">Couldn’t load who got it.</p>}
          {receipts &&
            (isGroup ? (
              <>
                <Group
                  title="Read by"
                  icon={<CheckCheck size={16} />}
                  tone="read"
                  people={read}
                  when="read"
                />
                <Group
                  title="Delivered to"
                  icon={<CheckCheck size={16} />}
                  people={delivered}
                  when="delivered"
                />
                <Group
                  title="Not delivered yet"
                  icon={<Clock size={16} />}
                  people={waiting}
                  when="none"
                />
                {people.length === 0 && (
                  <p className="wz-minfo__empty">No members known for this group yet.</p>
                )}
              </>
            ) : (
              <OneToOne p={people[0]} />
            ))}
        </section>
      )}
      <dl className="wz-info-list">
        {facts.map(([k, v]) => (
          <div key={k} className="wz-info-list__row">
            <dt>{k}</dt>
            <dd className={k === 'Message ID' ? 'wz-mono' : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OneToOne({ p }: { p: ReceiptPerson | undefined }) {
  const row = (icon: React.ReactNode, label: string, at: number, tone?: string) => (
    <div
      className={`wz-minfo__step${at ? '' : ' wz-minfo__step--pending'}${tone ? ` wz-minfo__step--${tone}` : ''}`}
    >
      <span className="wz-minfo__step-icon">{icon}</span>
      <span className="wz-minfo__step-label">{label}</span>
      <span className="wz-minfo__step-at">{at ? formatDateTime(at) : '—'}</span>
    </div>
  );
  return (
    <div className="wz-minfo__steps">
      {row(<CheckCheck size={16} />, 'Read', p?.readAt ?? 0, 'read')}
      {!!p?.playedAt && row(<Play size={16} />, 'Played', p.playedAt, 'read')}
      {row(<CheckCheck size={16} />, 'Delivered', p?.deliveredAt ?? 0)}
    </div>
  );
}

function Group({
  title,
  icon,
  tone,
  people,
  when,
}: {
  title: string;
  icon: React.ReactNode;
  tone?: 'read';
  people: ReceiptPerson[];
  when: 'read' | 'delivered' | 'none';
}) {
  if (people.length === 0) return null;
  return (
    <div className="wz-minfo__group">
      <h3 className={`wz-minfo__title${tone ? ` wz-minfo__title--${tone}` : ''}`}>
        {icon}
        {title}
        <span className="wz-minfo__count">{people.length}</span>
      </h3>
      <ul className="wz-minfo__list">
        {people.map((p) => (
          <li key={p.jid} className="wz-minfo__person">
            <Avatar name={p.name} jid={p.jid} size={32} />
            <span className="wz-minfo__name">{p.name}</span>
            <span className="wz-minfo__at">
              {when === 'read' ? (
                <>
                  {p.playedAt ? <Play size={12} /> : <Check size={12} />}
                  {formatDateTime(p.playedAt || p.readAt)}
                </>
              ) : when === 'delivered' ? (
                formatDateTime(p.deliveredAt)
              ) : (
                ''
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
