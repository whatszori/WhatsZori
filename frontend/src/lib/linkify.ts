export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// trailing punctuation usually belongs to the sentence, not the URL
const TRAILING = /[.,;:!?)\]}'"»]+$/;

export function linkify(text: string): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    const trail = url.match(TRAILING)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    const start = match.index ?? 0;
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push({ type: 'link', value: url, href: url.startsWith('www.') ? `https://${url}` : url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}
