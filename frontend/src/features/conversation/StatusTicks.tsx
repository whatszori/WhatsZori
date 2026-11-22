import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import type { MessageStatus } from '../../api';

const LABEL: Record<MessageStatus, string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
};

export function StatusTicks({ status }: { status: MessageStatus }) {
  const props = { size: 15, strokeWidth: 2, 'aria-hidden': true } as const;
  const icon =
    status === 'pending' ? (
      <Clock {...props} size={13} />
    ) : status === 'sent' ? (
      <Check {...props} />
    ) : status === 'failed' ? (
      <AlertCircle {...props} size={13} />
    ) : (
      <CheckCheck {...props} />
    );
  return (
    <span className={`wz-ticks wz-ticks--${status}`} role="img" aria-label={LABEL[status]}>
      {icon}
    </span>
  );
}
