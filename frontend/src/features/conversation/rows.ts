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
      // photos and videos sent together, drawn as one bubble; message is the last of them
      album?: Message[];
    };

const GROUP_WINDOW = 5 * 60_000;

function sameGroup(a: Message, b: Message): boolean {
  return (
    a.senderJid === b.senderJid &&
    b.timestamp - a.timestamp < GROUP_WINDOW &&
    isSameDay(a.timestamp, b.timestamp)
  );
}

// sent together: same sender, within a minute of each other, plain photos and videos
const ALBUM_GAP = 60_000;
export const ALBUM_MIN = 2;

function albumable(m: Message): boolean {
  return (
    (m.kind === 'image' || m.kind === 'video') &&
    !!m.media &&
    !m.media.round &&
    !m.media.gif &&
    !m.viewOnce &&
    !m.deleted &&
    !m.contentUnknown &&
    !m.replyTo &&
    !m.business
  );
}

// the run of album items starting at i (only the last one may have a caption)
function albumAt(messages: Message[], i: number): number {
  let j = i;
  while (
    j + 1 < messages.length &&
    albumable(messages[j]) &&
    !messages[j].text &&
    albumable(messages[j + 1]) &&
    messages[j + 1].senderJid === messages[i].senderJid &&
    messages[j + 1].timestamp - messages[j].timestamp <= ALBUM_GAP &&
    isSameDay(messages[j].timestamp, messages[j + 1].timestamp)
  )
    j++;
  return j - i + 1 >= ALBUM_MIN && albumable(messages[i]) ? j : i;
}

export function buildRows(messages: Message[], now = Date.now()): ListRow[] {
  const rows: ListRow[] = [];
  for (let i = 0; i < messages.length; i++) {
    const end = albumAt(messages, i);
    const album = end > i ? messages.slice(i, end + 1) : undefined;
    i = end;
    const m = messages[i];
    const prev = messages[i - (album ? album.length : 1)];
    const next = messages[i + 1];
    if (!prev || !isSameDay(prev.timestamp, m.timestamp)) {
      rows.push({
        type: 'day',
        key: `day-${m.pk}`,
        label: formatDay(m.timestamp, now),
        ts: m.timestamp,
      });
    }
    rows.push({
      type: 'msg',
      key: m.pk,
      message: m,
      groupStart: !prev || !sameGroup(prev, album?.[0] ?? m),
      groupEnd: !next || !sameGroup(m, next),
      ts: m.timestamp,
      album,
    });
  }
  return rows;
}
