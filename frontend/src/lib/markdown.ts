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

// a pair of markers in [from, to) of s, with the pairs inside it
interface Pair {
  a: number;
  b: number;
  k: 'b' | 'i' | 's';
  inner: Pair[];
}

function urlTest(s: string) {
  // markers inside links don't count (example.com/a_b_c)
  const urls: [number, number][] = [];
  for (const m of s.matchAll(URL_RE)) urls.push([m.index, m.index + m[0].length]);
  return (i: number) => urls.some(([a, b]) => i >= a && i < b);
}

function scan(s: string, from: number, to: number, inUrl: (i: number) => boolean): Pair[] {
  const out: Pair[] = [];
  let i = from;
  while (i < to) {
    const ch = s[i];
    const kind = MARKS[ch];
    const opens =
      kind &&
      !inUrl(i) &&
      (i === from || (EDGE.test(s[i - 1]) && s[i - 1] !== ch)) &&
      i + 1 < to &&
      !SPACE.test(s[i + 1]) &&
      s[i + 1] !== ch;
    if (opens) {
      let close = -1;
      for (let j = i + 2; j < to; j++) {
        if (s[j] === '\n') break;
        if (
          s[j] === ch &&
          !inUrl(j) &&
          !SPACE.test(s[j - 1]) &&
          (j + 1 === to || (EDGE.test(s[j + 1]) && s[j + 1] !== ch))
        ) {
          close = j;
          break;
        }
      }
      if (close > 0) {
        out.push({ a: i, b: close, k: kind, inner: scan(s, i + 1, close, inUrl) });
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

function build(s: string, from: number, to: number, pairs: Pair[]): Inline[] {
  const out: Inline[] = [];
  let last = from;
  for (const p of pairs) {
    if (p.a > last) out.push({ t: 'text', v: s.slice(last, p.a) });
    out.push({ t: p.k, c: build(s, p.a + 1, p.b, p.inner) });
    last = p.b + 1;
  }
  if (last < to) out.push({ t: 'text', v: s.slice(last, to) });
  return out;
}

function emphasis(s: string): Inline[] {
  return build(s, 0, s.length, scan(s, 0, s.length, urlTest(s)));
}

const CODE_RE = /```([^\n]+?)```|`([^`\n]+)`/g;

// inline: code first (nothing inside it is formatting), then emphasis around it
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(CODE_RE)) {
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

// The text as typed, every character kept, with classes for the composer's live preview:
// mk (a marker), b, i, s, code.
export interface SourceSpan {
  v: string;
  cls: string;
}

export function sourceSpans(text: string): SourceSpan[] {
  const n = text.length;
  const cls: string[][] = Array.from({ length: n }, () => []);
  const add = (a: number, b: number, c: string) => {
    for (let i = a; i < b; i++) cls[i].push(c);
  };
  const inUrl = urlTest(text);
  const plain: [number, number][] = [];
  let last = 0;
  // code blocks over lines, then inline code; nothing inside is formatting
  for (const m of text.matchAll(/```[\s\S]+?```|`[^`\n]+`/g)) {
    const f = m[0].startsWith('```') ? 3 : 1;
    const a = m.index;
    const b = a + m[0].length;
    plain.push([last, a]);
    add(a, a + f, 'mk');
    add(b - f, b, 'mk');
    add(a + f, b - f, 'code');
    last = b;
  }
  plain.push([last, n]);
  const mark = (pairs: Pair[]) => {
    for (const p of pairs) {
      add(p.a, p.a + 1, 'mk');
      add(p.b, p.b + 1, 'mk');
      add(p.a + 1, p.b, p.k);
      mark(p.inner);
    }
  };
  for (const [a, b] of plain) mark(scan(text, a, b, inUrl));
  // line starts: quotes and list markers
  let at = 0;
  for (const line of text.split('\n')) {
    const m = line.match(/^(?:> ?|[-*•] |\d{1,3}\. )/);
    if (m && !cls[at]?.includes('code')) add(at, at + m[0].length, 'mk');
    at += line.length + 1;
  }
  const out: SourceSpan[] = [];
  for (let i = 0; i < n; i++) {
    const c = cls[i].join(' ');
    if (out.length && out[out.length - 1].cls === c) out[out.length - 1].v += text[i];
    else out.push({ v: text[i], cls: c });
  }
  return out;
}
