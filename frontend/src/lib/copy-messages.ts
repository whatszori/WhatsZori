import type { Message } from '../api';

const KIND_LABEL: Record<string, string> = {
  image: '<photo>',
  video: '<video>',
  voice: '<voice message>',
  document: '<file>',
  sticker: '<sticker>',
};

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The text for "Copy" on several selected messages, the same shape as WhatsApp's:
// "[31.12.2026, 23:59] Anna: text". A single message copies as just its text.
export function copyText(messages: Message[]): string {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length === 1) return sorted[0].text || KIND_LABEL[sorted[0].kind] || '';
  return sorted
    .map((m) => {
      const body = [KIND_LABEL[m.kind] && m.media ? KIND_LABEL[m.kind] : '', m.text]
        .filter(Boolean)
        .join(' ');
      return `[${stamp(m.timestamp)}] ${m.fromMe ? 'You' : m.senderName}: ${body}`;
    })
    .join('\n');
}
