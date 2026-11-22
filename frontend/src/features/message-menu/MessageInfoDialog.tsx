import type { Message } from '../../api';
import { formatDateTime } from '../../lib/format';
import { Dialog } from '../../ui';

const STATUS: Record<string, string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
};

export function MessageInfoDialog({
  message: m,
  onClose,
}: {
  message: Message | null;
  onClose: () => void;
}) {
  const rows: [string, string][] = m
    ? [
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
      ]
    : [];

  return (
    <Dialog open={!!m} title="Message info" onClose={onClose} width={380}>
      <dl className="wz-info-list">
        {rows.map(([k, v]) => (
          <div key={k} className="wz-info-list__row">
            <dt>{k}</dt>
            <dd className={k === 'Message ID' ? 'wz-mono' : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
