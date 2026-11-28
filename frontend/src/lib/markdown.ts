// WhatsApp's text formatting, which is what every other client shows: *bold*, _italic_,
// ~strike~, ```monospace```, `inline code`, "> " quotes and "- " / "1. " lists. Plain
// Markdown habits (**bold**, ~~strike~~, __italic__) are turned into these on send.

export type Inline =
  { t: 'text'; v: string } | { t: 'b' | 'i' | 's'; c: Inline[] } | { t: 'code'; v: string };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'pre'; v: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const MARKS: Record<string, 'b' | 'i' | 's'> = { '*': 'b', _: 'i', '~': 's' };
const SPACE = /\s/;
// what may sit right outside a marker: space, punctuation, symbols
const EDGE = /[\s\p{P}\p{S}]/u;

function emphasis(s: string): Inline[] {
  // markers inside links don't count (example.com/a_b_c)
  const urls: [number, number][] = [];
  for (const m of s.matchAll(URL_RE)) urls.push([m.index, m.index + m[0].length]);
  const inUrl = (i: number) => urls.some(([a, b]) => i >= a && i < b);

  const out: Inline[] = [];
  let buf = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const kind = MARKS[ch];
    const opens =
      kind &&
      !inUrl(i) &&
      (i === 0 || (EDGE.test(s[i - 1]) && s[i - 1] !== ch)) &&
      i + 1 < s.length &&
      !SPACE.test(s[i + 1]) &&
      s[i + 1] !== ch;
    if (opens) {
      let close = -1;
      for (let j = i + 2; j < s.length; j++) {
        if (s[j] === '\n') break;
        if (
          s[j] === ch &&
          !inUrl(j) &&
          !SPACE.test(s[j - 1]) &&
          (j + 1 === s.length || (EDGE.test(s[j + 1]) && s[j + 1] !== ch))
        ) {
          close = j;
          break;
        }
      }
      if (close > 0) {
        if (buf) out.push({ t: 'text', v: buf });
        buf = '';
        out.push({ t: kind, c: emphasis(s.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  if (buf) out.push({ t: 'text', v: buf });
  return out;
}

// inline: code first (nothing inside it is formatting), then emphasis around it
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(/```([^\n]+?)```|`([^`\n]+)`/g)) {
    if (m.index > last) out.push(...emphasis(s.slice(last, m.index)));
    out.push({ t: 'code', v: m[1] ?? m[2] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(...emphasis(s.slice(last)));
  return out;
}

function lines(seg: string, out: Block[]) {
  let para: string[] = [];
  let quote: string[] = [];
  let ul: Inline[][] = [];
  let ol: { start: number; items: Inline[][] } | null = null;
  const flush = () => {
    if (para.length) out.push({ t: 'p', c: parseInline(para.join('\n')) });
    if (quote.length) out.push({ t: 'quote', c: parseInline(quote.join('\n')) });
    if (ul.length) out.push({ t: 'ul', items: ul });
    if (ol) out.push({ t: 'ol', start: ol.start, items: ol.items });
    para = [];
    quote = [];
    ul = [];
    ol = null;
  };
  for (const line of seg.split('\n')) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^> ?(.*)$/))) {
      if (!quote.length) flush();
      quote.push(m[1]);
    } else if ((m = line.match(/^[-*•] (.+)$/))) {
      if (!ul.length) flush();
      ul.push(parseInline(m[1]));
    } else if ((m = line.match(/^(\d{1,3})\. (.+)$/))) {
      if (!ol) {
        flush();
        ol = { start: Number(m[1]), items: [] };
      }
      ol.items.push(parseInline(m[2]));
    } else {
      if (!para.length) flush();
      para.push(line);
    }
  }
  flush();
}

export function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  let last = 0;
  // ``` blocks spanning lines; on one line they're inline monospace
  for (const m of text.matchAll(/```\n?([\s\S]*?\n[\s\S]*?)\n?```/g)) {
    const before = text.slice(last, m.index).replace(/\n$/, '');
    if (before) lines(before, out);
    out.push({ t: 'pre', v: m[1] });
    last = m.index + m[0].length;
    if (text[last] === '\n') last++;
  }
  if (last < text.length) lines(text.slice(last), out);
  return out;
}

// any formatting worth more than plain text?
export function hasFormatting(text: string): boolean {
  return /[*_~`]|^(?:> |[-*•] |\d{1,3}\. )/m.test(text);
}

// the text without its markers, for one-line previews
export function plainText(text: string): string {
  const flat = (xs: Inline[]): string =>
    xs.map((x) => (x.t === 'text' || x.t === 'code' ? x.v : flat(x.c))).join('');
  return flat(parseInline(text));
}

// Markdown habits to WhatsApp's: **b** -> *b*, ~~s~~ -> ~s~, __i__ -> _i_ (code left alone)
export function toWhatsApp(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '*$1*')
            .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '~$1~')
            .replace(/(^|[^\w])__(?=\S)([^_\n]*?\S)__(?=$|[^\w])/g, '$1_$2_'),
    )
    .join('');
}
