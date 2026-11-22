import type { Message } from '../../api';
import { formatDay, isSameDay } from '../../lib/format';

export type ListRow =
  | { type: 'day'; key: string; label: string; ts: number }
  | {
      type: 'msg';
      key: string;
      message: Message;
      groupStart: boolean;
      groupEnd: boolean;
      ts: number;
    };

const GROUP_WINDOW = 5 * 60_000;

function sameGroup(a: Message, b: Message): boolean {
  return (
    a.senderJid === b.senderJid &&
    b.timestamp - a.timestamp < GROUP_WINDOW &&
    isSameDay(a.timestamp, b.timestamp)
  );
}

export function buildRows(messages: Message[], now = Date.now()): ListRow[] {
  const rows: ListRow[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    if (!prev || !isSameDay(prev.timestamp, m.timestamp)) {
      rows.push({ type: 'day', key: `day-${m.pk}`, label: formatDay(m.timestamp, now), ts: m.timestamp });
    }
    rows.push({
      type: 'msg',
      key: m.pk,
      message: m,
      groupStart: !prev || !sameGroup(prev, m),
      groupEnd: !next || !sameGroup(m, next),
      ts: m.timestamp,
    });
  }
  return rows;
}
