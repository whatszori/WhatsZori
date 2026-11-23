// Splits text into plain and matching parts for every word of query, the same prefix matching
// the backend's full-text search does ("lun" marks "lunch"). Case-insensitive.
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const words = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0 || !text) return [{ text, hit: false }];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${words.join('|')})`, 'giu');
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), hit: false });
    out.push({ text: m[0], hit: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}
