import type {
  Chat,
  ChatInfo,
  GroupMember,
  MediaRef,
  EditVersion,
  JID,
  Me,
  Message,
  Reaction,
  ReplyRef,
} from '../types';
import { createRng, type Rng } from '../../lib/rng';
import {
  FILES,
  LINK_TEXT,
  LONG_TEXT,
  MULTILINE,
  REACTIONS,
  SNIPPETS,
  SWAPPABLE,
  type Topic,
} from './texts';

interface ChatSeed {
  name: string;
  group?: string[];
  topic: Topic;
  count: number;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  unread?: number;
  // minutes since last activity (chats with a hand-written tail end where the tail ends)
  ago: number;
  online?: boolean;
  lastSeenAgo?: number | null;
}

export const ME: Me = { jid: '491701234567@s.whatsapp.net', name: 'You', phone: '+49 170 1234567' };

const WORK_CREW = ['Mark Ellison', 'Sophie Laurent', 'Priya Raman', 'Jonas Weber'];

const SEEDS: ChatSeed[] = [
  { name: 'Anna Petrova', topic: 'friend', count: 140, pinned: true, ago: 2, online: true },
  {
    name: 'Семья',
    group: ['Мама', 'Папа', 'Оля', 'Дядя Миша'],
    topic: 'ru-family',
    count: 90,
    pinned: true,
    ago: 55,
  },
  {
    name: 'Design team',
    group: [...WORK_CREW, 'Kenji Watanabe', 'Emma Lindqvist'],
    topic: 'team',
    count: 180,
    pinned: true,
    ago: 8,
  },
  { name: 'Дмитрий Соколов', topic: 'ru-friend', count: 90, ago: 40, lastSeenAgo: 35 },
  {
    name: 'Product launch',
    group: [
      'Mark Ellison',
      'Ryan Patel',
      'Grace Kim',
      'Oliver Hughes',
      'Mia Rossi',
      'Liam O’Connor',
      'Priya Raman',
    ],
    topic: 'team',
    count: 160,
    unread: 37,
    ago: 18,
  },
  { name: 'Mark Ellison', topic: 'work', count: 60, ago: 75, lastSeenAgo: 70 },
  { name: 'Northwind Coffee', topic: 'work', count: 0, ago: 95, lastSeenAgo: null },
  { name: '山田太郎', topic: 'ja-work', count: 24, unread: 1, ago: 130, lastSeenAgo: null },
  { name: 'Мама', topic: 'mum', count: 50, ago: 160, lastSeenAgo: 150 },
  { name: 'Sophie Laurent', topic: 'work', count: 30, ago: 300, lastSeenAgo: 280 },
  {
    name: 'Weekend hiking',
    group: ['Liam O’Connor', 'Hannah Fischer', 'Noah Brooks', 'Chloe Martin'],
    topic: 'hike',
    count: 60,
    unread: 3,
    ago: 380,
  },
  { name: 'Jonas Weber', topic: 'friend', count: 20, ago: 600, lastSeenAgo: 590 },
  { name: 'Оля', topic: 'ru-friend', count: 30, ago: 900, lastSeenAgo: 800 },
  {
    name: 'Book club',
    group: ['Emma Lindqvist', 'Ines Moreau', 'Grace Kim'],
    topic: 'books',
    count: 30,
    muted: true,
    unread: 8,
    ago: 1000,
  },
  { name: 'Priya Raman', topic: 'work', count: 20, ago: 1300, lastSeenAgo: 1250 },
  { name: 'Tomás García', topic: 'friend', count: 14, ago: 2000, online: true },
  {
    name: 'Apartment 4B',
    group: ['Noah Brooks', 'Mia Rossi', 'Oliver Hughes'],
    topic: 'house',
    count: 40,
    muted: true,
    unread: 2,
    ago: 2300,
  },
  { name: 'Kenji Watanabe', topic: 'work', count: 18, ago: 3000, lastSeenAgo: 2900 },
  { name: 'Emma Lindqvist', topic: 'friend', count: 10, ago: 3500, lastSeenAgo: 3400 },
  {
    name: 'Sunday football',
    group: ['Ryan Patel', 'Liam O’Connor', 'Tomás García', 'Noah Brooks', 'Oliver Hughes'],
    topic: 'football',
    count: 25,
    ago: 4200,
  },
  { name: 'Noah Brooks', topic: 'friend', count: 8, ago: 5000, lastSeenAgo: 4900 },
  { name: 'Алексей Морозов', topic: 'ru-friend', count: 14, ago: 5600, lastSeenAgo: 5500 },
  {
    name: 'Company announcements',
    group: ['Grace Kim', 'Mark Ellison'],
    topic: 'announce',
    count: 30,
    muted: true,
    unread: 120,
    ago: 6000,
  },
  { name: 'Hannah Fischer', topic: 'friend', count: 9, ago: 7000, lastSeenAgo: 6900 },
  {
    name: 'Курсы испанского',
    group: ['Марина Белова', 'Сергей Кузнецов', 'Ирина Лебедева'],
    topic: 'ru-course',
    count: 22,
    ago: 8000,
  },
  { name: 'Chloe Martin', topic: 'friend', count: 11, ago: 10000, lastSeenAgo: 9000 },
  { name: 'Ryan Patel', topic: 'work', count: 5, ago: 12000, lastSeenAgo: 11000 },
  {
    name: 'Neighbours',
    group: ['Hannah Fischer', 'Ines Moreau', 'Chloe Martin', 'Сергей Кузнецов'],
    topic: 'house',
    count: 18,
    muted: true,
    ago: 14000,
  },
  { name: 'Ines Moreau', topic: 'friend', count: 6, ago: 16000, lastSeenAgo: null },
  { name: 'Сергей Кузнецов', topic: 'ru-friend', count: 9, ago: 18000, lastSeenAgo: 17000 },
  { name: 'Grace Kim', topic: 'work', count: 4, ago: 21000, lastSeenAgo: 20000 },
  {
    name: 'Photo walks',
    group: ['Mia Rossi', 'Kenji Watanabe', 'Emma Lindqvist'],
    topic: 'photo',
    count: 14,
    ago: 25000,
  },
  { name: 'Oliver Hughes', topic: 'friend', count: 3, ago: 30000, lastSeenAgo: 29000 },
  { name: 'Liam O’Connor', topic: 'friend', count: 7, ago: 33000, lastSeenAgo: 32000 },
  {
    name: 'Climbing gym',
    group: ['Hannah Fischer', 'Jonas Weber'],
    topic: 'climb',
    count: 20,
    archived: true,
    ago: 40000,
  },
  {
    name: 'Одноклассники',
    group: ['Алексей Морозов', 'Сергей Кузнецов', 'Дмитрий Соколов'],
    topic: 'ru-oldfriends',
    count: 30,
    archived: true,
    muted: true,
    unread: 4,
    ago: 45000,
  },
  {
    name: 'Conference trip',
    group: ['Grace Kim', 'Ryan Patel', 'Priya Raman'],
    topic: 'team',
    count: 25,
    archived: true,
    ago: 60000,
  },
  { name: 'Mia Rossi', topic: 'friend', count: 5, archived: true, ago: 70000, lastSeenAgo: 69000 },
];

const slug = (s: string) =>
  Array.from(s)
    .map((c) => c.codePointAt(0)!.toString(36))
    .join('')
    .slice(0, 20);

export function jidFor(name: string, group: boolean): JID {
  return group ? `1203630${slug(name)}@g.us` : `${slug(name)}@s.whatsapp.net`;
}

export interface MockDB {
  me: Me;
  chats: Map<JID, Chat>;
  messages: Map<JID, Message[]>;
  members: Map<JID, { jid: JID; name: string }[]>;
  history: Map<string, EditVersion[]>;
  nextPk: number;
}

type Person = { jid: JID; name: string };

const MIN = 60_000;
const MEP: Person = { jid: ME.jid, name: ME.name };

function waveform(rng: Rng): number[] {
  // a voice rises and falls in phrases, not white noise
  return Array.from({ length: 40 }, (_, i) => {
    const phrase = 0.55 + 0.4 * Math.sin(i / 2.3 + rng.next());
    return Math.round(Math.min(1, Math.max(0.12, phrase * (0.6 + rng.next() * 0.5))) * 100) / 100;
  });
}

// "[photo] caption", "[video]", "[voice]", "[doc name.ext] caption"
function parseMedia(text: string, rng: Rng): Partial<Message> | null {
  const m = /^\[(photo|video|voice|doc)(?: ([^\]]+))?\]\s*(.*)$/.exec(text);
  if (!m) return null;
  const [, kind, arg, caption] = m;
  if (kind === 'photo') {
    const landscape = rng.chance(0.6);
    return {
      kind: 'image',
      text: caption,
      media: {
        width: landscape ? 1600 : 1080,
        height: landscape ? 1067 : 1440,
        size: rng.int(400, 3200) * 1000,
      },
    };
  }
  if (kind === 'video') {
    const portrait = rng.chance(0.6);
    return {
      kind: 'video',
      text: caption,
      media: {
        width: portrait ? 1080 : 1920,
        height: portrait ? 1920 : 1080,
        duration: rng.int(6, 48),
        size: rng.int(3000, 30000) * 1000,
      },
    };
  }
  if (kind === 'voice')
    return {
      kind: 'voice',
      text: '',
      media: { duration: rng.int(5, 74), waveform: waveform(rng) },
    };
  const file = FILES.find((f) => f.fileName === arg) ?? {
    fileName: arg,
    size: rng.int(50, 4000) * 1000,
    mime: 'application/octet-stream',
  };
  return { kind: 'document', text: caption, media: { ...file } };
}

// a believable slip of the thumb: two neighbouring letters swapped in a longer word
function typo(text: string, rng: Rng): string | null {
  const words = text.split(' ');
  const idx = words.map((w, i) => (/^\p{L}{5,}$/u.test(w) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const i = rng.pick(idx);
  const w = Array.from(words[i]);
  const j = rng.int(1, w.length - 2);
  [w[j], w[j + 1]] = [w[j + 1], w[j]];
  words[i] = w.join('');
  const out = words.join(' ');
  return out === text ? null : out;
}

function randomReactions(rng: Rng, group: boolean): Reaction[] {
  const n = group ? rng.int(1, 3) : 1;
  const out: Reaction[] = [];
  for (let i = 0; i < n; i++) {
    const emoji = rng.pick(REACTIONS);
    if (out.some((r) => r.emoji === emoji)) continue;
    out.push({ emoji, count: group ? rng.int(1, 4) : 1, mine: rng.chance(0.3) });
  }
  return out;
}

function shuffled(n: number, rng: Rng): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// people mostly don't chat between 1 and 8 in the morning; push those to the evening before
function daytime(t: number, rng: Rng): number {
  const evening = rng.int(0, 150);
  const d = new Date(t);
  if (d.getHours() >= 8) return t;
  d.setDate(d.getDate() - 1);
  d.setHours(21, 0, 0, 0);
  return d.getTime() + evening * MIN;
}

function gap(rng: Rng): number {
  const r = rng.next();
  if (r < 0.45) return rng.int(40, 300) * MIN;
  if (r < 0.85) return rng.int(6 * 60, 30 * 60) * MIN;
  return rng.int(30 * 60, 4 * 24 * 60) * MIN;
}

export function preview(m: Message): string {
  if (m.contentUnknown) return 'Deleted message';
  if (m.text) {
    // names in place of "@<number>", like the desktop app's previews
    let t = m.text;
    for (const x of m.mentions ?? []) if (x.name) t = t.split('@' + x.token).join('@' + x.name);
    return t.replace(/\s+/g, ' ');
  }
  switch (m.kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'document':
      return m.media?.fileName ?? 'Document';
    case 'voice':
      return 'Voice message';
    case 'sticker':
      return 'Sticker';
    default:
      return '';
  }
}

const quote = (m: Message): ReplyRef => ({
  pk: m.pk,
  senderName: m.senderName,
  fromMe: m.fromMe,
  kind: m.kind,
  text: preview(m),
});

export function createMockDB(now = Date.now(), seed = 7): MockDB {
  const rng = createRng(seed);
  const db: MockDB = {
    me: ME,
    chats: new Map(),
    messages: new Map(),
    members: new Map(),
    history: new Map(),
    nextPk: 1,
  };
  const pk = () => String(db.nextPk++);

  for (const s of SEEDS) {
    const isGroup = !!s.group;
    const jid = jidFor(s.name, isGroup);
    const people: Person[] = isGroup
      ? s.group!.map((n) => ({ jid: jidFor(n, false), name: n }))
      : [{ jid, name: s.name }];
    db.members.set(jid, people);

    const tail = TAILS[s.name];
    const historyEnd = tail
      ? daytime(now - (tail.from * MIN + rng.int(90, 600) * MIN), rng)
      : now - s.ago * MIN;
    const historyUnread = tail ? (tail.historyUnread ?? 0) : (s.unread ?? 0);
    const list = generateHistory(db, s, jid, people, historyEnd, historyUnread, rng);
    const last = list[list.length - 1];
    if (last?.fromMe) last.status = s.online ? 'read' : 'delivered';
    db.messages.set(jid, list);
    if (tail) tail.build(tailKit(db, jid, list, now, pk, rng));

    db.chats.set(jid, {
      jid,
      name: s.name,
      isGroup,
      memberCount: isGroup ? people.length + 1 : undefined,
      pinned: !!s.pinned,
      archived: !!s.archived,
      muted: !!s.muted,
      unread: tail ? tail.unread : (s.unread ?? 0),
      lastMessage: null,
      lastActivity: list[list.length - 1]?.timestamp ?? now - s.ago * MIN,
      lastSeen: isGroup ? undefined : s.lastSeenAgo == null ? null : now - s.lastSeenAgo * MIN,
      online: isGroup ? undefined : !!s.online,
    });
  }

  addMandarin(db, now, pk);

  for (const [jid, list] of db.messages) refreshChatPreview(db, jid, list);
  return db;
}

// Older history: whole short exchanges laid out in sessions over the past days and weeks.
function generateHistory(
  db: MockDB,
  s: ChatSeed,
  jid: JID,
  people: Person[],
  end: number,
  unread: number,
  rng: Rng,
): Message[] {
  const pool = SNIPPETS[s.topic];
  const isGroup = !!s.group;
  let deck: number[] = [];
  const sessions: { who: Person[]; texts: string[]; times: number[] }[] = [];
  let left = s.count;
  while (left > 0) {
    if (!deck.length) deck = shuffled(pool.length, rng);
    let lines = pool[deck.pop()!].map((l) => ({ role: l[0], text: l.slice(3) }));
    if (!isGroup && SWAPPABLE.has(s.topic) && rng.chance(0.4))
      lines = lines.map((l) => ({ ...l, role: l.role === 'm' ? 'a' : 'm' }));
    if (lines.length > left) lines = lines.slice(lines.length - left);
    const cast = shuffled(people.length, rng).map((i) => people[i]);
    const roleOf = (r: string): Person =>
      r === 'm' ? MEP : cast[('abc'.indexOf(r) >>> 0) % cast.length];
    const times: number[] = [];
    let t = end;
    for (let i = lines.length - 1; i >= 0; i--) {
      times[i] = t;
      t -= rng.chance(0.15) ? rng.int(4, 25) * MIN : rng.int(15, 200) * 1000;
    }
    sessions.unshift({
      who: lines.map((l) => roleOf(l.role)),
      texts: lines.map((l) => l.text),
      times,
    });
    left -= lines.length;
    end = daytime(times[0] - gap(rng), rng);
  }

  const list: Message[] = [];
  const total = s.count;
  for (const ses of sessions) {
    const start = list.length;
    ses.texts.forEach((text, i) => {
      let who = ses.who[i];
      // unread history has to be incoming; in a group someone else says it
      if (who === MEP && list.length >= total - unread) who = rng.pick(people);
      const fromMe = who === MEP;
      const m: Message = {
        pk: String(db.nextPk++),
        id: `3EB0${(db.nextPk * 7919).toString(16).toUpperCase()}`,
        chatJid: jid,
        senderJid: who.jid,
        senderName: who.name,
        fromMe,
        timestamp: ses.times[i],
        kind: 'text',
        text,
        reactions: [],
        status: fromMe ? 'read' : undefined,
      };
      const media = parseMedia(text, rng);
      if (media) Object.assign(m, media);

      const roll = rng.next();
      if (rng.chance(0.06)) m.reactions = randomReactions(rng, isGroup);
      if (m.kind === 'text' && roll < 0.03) {
        const before = typo(m.text, rng);
        if (before) {
          const at = m.timestamp + rng.int(1, 3) * MIN;
          m.editedAt = at;
          m.editCount = 1;
          db.history.set(m.pk, [
            { text: before, at: m.timestamp },
            { text: m.text, at },
          ]);
        }
      } else if (!fromMe && roll < 0.045) {
        m.deleted = { byJid: who.jid, byName: who.name, at: m.timestamp + rng.int(1, 20) * MIN };
      } else if (isGroup && !fromMe && m.kind !== 'text' && roll < 0.2) {
        // people forward photos and files between chats, rarely their own small talk
        m.forwarded = rng.chance(0.2) ? 5 : 1;
      }
      // quote something said a moment ago by someone else in the same exchange
      if (i >= 2 && rng.chance(0.08)) {
        const target = list
          .slice(start, list.length - 1)
          .reverse()
          .find((x) => x.fromMe !== fromMe || x.senderJid !== who.jid);
        if (target) m.replyTo = quote(target);
      }
      list.push(m);
    });
  }
  return list;
}

export function refreshChatPreview(db: MockDB, jid: JID, list = db.messages.get(jid) ?? []): void {
  const chat = db.chats.get(jid);
  if (!chat) return;
  const last = list[list.length - 1];
  if (!last) return;
  chat.lastActivity = last.timestamp;
  chat.lastMessage = {
    pk: last.pk,
    fromMe: last.fromMe,
    senderName: last.senderName,
    kind: last.kind,
    text: preview(last),
    deleted: !!last.deleted,
    status: last.status,
  };
}

interface TailKit {
  me: Person;
  p: (name: string) => Person;
  add: (who: Person, minsAgo: number, extra?: Partial<Message>) => Message;
  edits: (m: Message, versions: [string, number][]) => void;
  deletedBy: (who: Person, minsAgo: number) => Message['deleted'];
  photo: (w: number, h: number, caption?: string) => Partial<Message>;
  voice: (duration: number) => Partial<Message>;
}

function tailKit(
  db: MockDB,
  chatJid: JID,
  list: Message[],
  now: number,
  pk: () => string,
  rng: Rng,
): TailKit {
  const at = (minsAgo: number) => now - Math.round(minsAgo * MIN);
  return {
    me: MEP,
    p: (name) => ({ jid: jidFor(name, false), name }),
    add: (who, minsAgo, extra = {}) => {
      const fromMe = who.jid === ME.jid;
      const m: Message = {
        pk: pk(),
        id: `3EB0SHOW${db.nextPk}`,
        chatJid,
        senderJid: who.jid,
        senderName: who.name,
        fromMe,
        timestamp: at(minsAgo),
        kind: 'text',
        text: '',
        reactions: [],
        status: fromMe ? 'read' : undefined,
        ...extra,
      };
      list.push(m);
      return m;
    },
    edits: (m, versions) => {
      db.history.set(
        m.pk,
        versions.map(([text, minsAgo]) => ({ text, at: at(minsAgo) })),
      );
      m.text = versions[versions.length - 1][0];
      m.editedAt = at(versions[versions.length - 1][1]);
      m.editCount = versions.length - 1;
    },
    deletedBy: (who, minsAgo) => ({ byJid: who.jid, byName: who.name, at: at(minsAgo) }),
    photo: (width, height, caption = '') => ({
      kind: 'image',
      text: caption,
      media: { width, height, size: rng.int(600, 3000) * 1000 },
    }),
    voice: (duration) => ({ kind: 'voice', media: { duration, waveform: waveform(rng) } }),
  };
}

// Hand-written latest messages of the chats people look at first, so every bubble variant
// (link, reply, edit, kept deletion, photo, file, voice, poll, view once...) is on screen.
interface Tail {
  // minutes ago of the tail's first message
  from: number;
  unread: number;
  // unread messages before the tail, when the unread run starts in older history
  historyUnread?: number;
  build: (k: TailKit) => void;
}

const TAILS: Record<string, Tail> = {
  'Product launch': {
    from: 13,
    unread: 37,
    historyUnread: 33,
    build: (k) => {
      const grace = k.p('Grace Kim');
      const oliver = k.p('Oliver Hughes');
      const mia = k.p('Mia Rossi');
      k.add(grace, 13, { text: 'Landing page copy is final 🎉 thanks for all the comments' });
      k.add(oliver, 12, k.photo(1600, 1000, 'Hero banner, final version'));
      k.add(mia, 11, { text: 'Love it. Can we make the button a bit bigger on mobile?' });
      k.add(oliver, 10, { text: 'On it, new version in 10 min' });
    },
  },

  'Anna Petrova': {
    from: 58,
    unread: 2,
    build: (k) => {
      const anna = k.p('Anna Petrova');
      const plan = k.add(anna, 58, { text: LINK_TEXT });
      k.add(k.me, 56, {
        text: 'Oh that looks great. A heated terrace in November, fancy 😄',
        replyTo: quote(plan),
      });
      k.add(anna, 54, { text: 'Right? I asked, they have blankets too' });
      const booked = k.add(anna, 52, { reactions: [{ emoji: '👍', count: 1, mine: true }] });
      k.edits(booked, [
        ['Booked for 7', 52],
        ['Booked for 7:30 at the Greek place', 50],
        ["Booked for 7:30 at the Greek place on Linden St, the table's under my name", 47],
      ]);
      k.add(anna, 46, {
        text: "Honestly let's not invite Mark, he'll spend the whole evening talking about his startup",
        deleted: k.deletedBy(anna, 45.5),
      });
      k.add(k.me, 45, { text: 'I saw that 👀' });
      k.add(anna, 44, { text: 'Of course you did 🙈 Forget it' });
      k.add(anna, 40, k.photo(1600, 1067, 'The terrace, for reference'));
      k.add(k.me, 38, {
        kind: 'document',
        media: { fileName: 'gift-ideas-lena.pdf', size: 248_000, mime: 'application/pdf' },
        text: "Ideas for Lena's present, pick your favourite",
      });
      k.add(anna, 30, k.voice(23));
      k.add(anna, 24, { contentUnknown: true, deleted: k.deletedBy(anna, 24) });
      k.add(k.me, 20, {
        text: 'Should we ask Mark to chip in for the present?',
        deleted: k.deletedBy(k.me, 19),
      });
      k.add(k.me, 18, { text: MULTILINE, reactions: [{ emoji: '❤️', count: 1, mine: false }] });
      k.add(anna, 5, {
        kind: 'video',
        media: { width: 1080, height: 1920, duration: 14, size: 8_400_000 },
        text: 'Practising my birthday song 🎤',
      });
      k.add(anna, 4, { text: "The waiters sing too if you tell them it's a birthday 😂" });
      k.add(anna, 3, {
        kind: 'image',
        viewOnce: true,
        media: { width: 1080, height: 1350, size: 640_000, mime: 'image/jpeg' },
      });
      k.add(anna, 2, {
        kind: 'video',
        viewOnce: true,
        media: { size: 2_400_000, mime: 'video/mp4', unavailable: true },
      });
    },
  },

  'Design team': {
    from: 34,
    unread: 3,
    build: (k) => {
      const mark = k.p('Mark Ellison');
      const jonas = k.p('Jonas Weber');
      const priya = k.p('Priya Raman');
      const sophie = k.p('Sophie Laurent');
      const summary = k.add(mark, 34, {
        text: LONG_TEXT,
        reactions: [
          { emoji: '🙏', count: 3, mine: true },
          { emoji: '👍', count: 2, mine: false },
        ],
      });
      const dry = k.add(jonas, 31, {
        text: 'One thing: can we do a dry run of the migration on staging first?',
        replyTo: quote(summary),
      });
      k.add(mark, 30, { text: 'Good call. Thursday morning?', replyTo: quote(dry) });
      k.add(jonas, 29, { text: 'Works 👍' });
      const own = k.add(k.me, 26, {});
      k.edits(own, [
        ['I can take the release notes', 26],
        ['I can take the release notes, draft by Tuesday', 25],
      ]);
      k.add(priya, 24, {
        text: 'Thank you! Can you mention the export fix? People kept asking about it',
        replyTo: quote(own),
      });
      k.add(k.me, 23, { text: 'Already on the list 🙂' });
      k.add(sophie, 20, {
        text: 'The sidebar hairlines in dark mode are still way too strong, who signed off on this 🙄',
        deleted: k.deletedBy(sophie, 15),
      });
      k.add(sophie, 19, k.photo(1080, 1350, 'Dark mode: current vs. proposed'));
      k.add(mark, 9, { text: "Thanks all, I think we're in good shape for the 14th" });
      k.add(mark, 8, {
        kind: 'poll',
        text: '📊 Retro on Friday or Monday?\n• Friday\n• Monday\n• Skip this week',
        poll: {
          name: 'Retro on Friday or Monday?',
          selectable: 1,
          totalVoters: 3,
          options: [
            { name: 'Friday', votes: 2, mine: false, voters: ['Mark Ellison', 'Jonas Weber'] },
            { name: 'Monday', votes: 1, mine: false, voters: ['Sophie Laurent'] },
            { name: 'Skip this week', votes: 0, mine: false, voters: [] },
          ],
        },
      });
    },
  },

  Семья: {
    from: 190,
    unread: 4,
    build: (k) => {
      const mum = k.p('Мама');
      const dad = k.p('Папа');
      const olya = k.p('Оля');
      const misha = k.p('Дядя Миша');
      k.add(mum, 190, { text: 'Дети, в воскресенье обед у нас, к двум часам' });
      k.add(dad, 186, { text: 'Я мясо замариную 🥩' });
      k.add(olya, 180, { text: 'Мы будем, только чуть опоздаем, у Сони тренировка до часу' });
      const ask = k.add(k.me, 172, { text: 'Я тоже приеду. Что-нибудь привезти?' });
      k.add(mum, 170, { text: 'Хлеба и что-нибудь к чаю', replyTo: quote(ask) });
      k.add(dad, 120, {
        ...k.photo(1080, 1440, 'Первый снег на даче ❄️'),
        reactions: [{ emoji: '❤️', count: 3, mine: true }],
      });
      k.add(olya, 118, { text: 'Красота какая!' });
      k.add(misha, 95, {
        kind: 'poll',
        text: '📊 Что дарим бабушке на юбилей?\n• Тёплый плед\n• Сертификат в санаторий\n• Фотокнигу с нами',
        poll: {
          name: 'Что дарим бабушке на юбилей?',
          selectable: 1,
          totalVoters: 5,
          options: [
            { name: 'Тёплый плед', votes: 1, mine: false, voters: ['Дядя Миша'] },
            { name: 'Сертификат в санаторий', votes: 1, mine: false, voters: ['Папа'] },
            { name: 'Фотокнигу с нами', votes: 3, mine: true, voters: ['Мама', 'Оля', 'You'] },
          ],
        },
      });
      k.add(mum, 60, k.voice(41));
      k.add(mum, 58, { text: 'Миша, плед у неё уже есть, давайте фотокнигу 😊' });
      k.add(misha, 57, { text: 'Ок, тогда фотокнига. Оля, сделаешь макет?' });
      k.add(olya, 55, { text: 'Сделаю, скидывайте фотки до пятницы' });
    },
  },

  'Northwind Coffee': {
    from: 100,
    unread: 0,
    build: (k) => {
      const shop = k.p('Northwind Coffee');
      k.add(k.me, 100, { text: 'Hi! Do you have oat milk?' });
      k.add(shop, 99, {
        text: 'Hi there 👋 Yes, oat, almond and soy. What would you like to do?',
        business: {
          header: 'Northwind Coffee',
          footer: 'Replies usually within a few minutes',
          buttons: [
            { kind: 'reply', text: 'Order for pickup', id: 'pickup' },
            { kind: 'reply', text: 'Talk to a barista', id: 'human' },
            { kind: 'url', text: 'See the menu', url: 'https://example.com/menu' },
          ],
        },
      });
      k.add(shop, 97, {
        text: 'Pick a drink and we will start making it when you are 5 minutes away.',
        business: {
          header: 'Pickup order',
          buttons: [{ kind: 'list', text: 'Choose a drink' }],
          list: {
            button: 'Choose a drink',
            title: 'Drinks',
            sections: [
              {
                title: 'Coffee',
                rows: [
                  { id: 'flat-white', title: 'Flat white', description: 'Double shot, oat milk' },
                  { id: 'cappuccino', title: 'Cappuccino', description: 'Single shot' },
                ],
              },
              { title: 'Not coffee', rows: [{ id: 'matcha', title: 'Matcha latte' }] },
            ],
          },
        },
      });
      k.add(shop, 96, {
        text: 'Your welcome code: 10% off the first order',
        business: {
          footer: 'Valid until Sunday',
          buttons: [
            { kind: 'copy', text: 'Copy code', code: 'NORTH10' },
            { kind: 'other', text: 'Pay now', name: 'review_and_pay' },
          ],
        },
      });
    },
  },

  'Дмитрий Соколов': {
    from: 150,
    unread: 0,
    build: (k) => {
      const dima = k.p('Дмитрий Соколов');
      k.add(dima, 150, { text: 'Смотри, где мы были в выходные' });
      k.add(dima, 149.5, k.photo(1600, 1067));
      const lake = k.add(dima, 149, k.photo(1600, 1067, 'Озеро в 7 утра, ни души'));
      k.add(dima, 148.5, k.photo(1080, 1440));
      k.add(dima, 148, k.photo(1600, 1067));
      k.add(k.me, 140, { text: 'Вау, это где?', replyTo: quote(lake) });
      k.add(dima, 138, { text: 'Под Выборгом, два часа на машине' });
      k.add(dima, 137, { text: 'Прогноз на субботу: −5, солнечно, без осадков', forwarded: 1 });
      k.add(dima, 135, { text: 'Поехали в следующие выходные? Возьмём палатку' });
      k.add(k.me, 120, { text: 'Палатку в ноябре? 😅' });
      k.add(dima, 119, {
        kind: 'video',
        media: { width: 640, height: 640, duration: 9, size: 1_300_000, round: true },
      });
      k.add(k.me, 100, { text: 'Ладно, уговорил. Только с ночёвкой в домике' });
      k.add(dima, 98, { text: 'Договорились 🤝' });
      k.add(dima, 40, {
        kind: 'document',
        media: { fileName: 'ozero-originals.zip', size: 84_200_000, mime: 'application/zip' },
        text: 'Оригиналы, там качество лучше',
      });
      k.add(dima, 30, {
        kind: 'location',
        text: '',
        location: {
          lat: 60.7096,
          lon: 28.7489,
          name: 'Домики у озера',
          address: 'Выборгский район, Ленинградская область',
          live: false,
        },
      });
      k.add(k.me, 26, {
        kind: 'contact',
        text: '',
        contacts: [
          {
            name: 'Серёга Лодочник',
            org: 'Прокат лодок «Залив»',
            phones: [
              {
                number: '+7 921 555-01-23',
                label: 'cell',
                waid: '79215550123',
                jid: '79215550123@s.whatsapp.net',
              },
            ],
            emails: [],
          },
        ],
      });
      k.add(dima, 20, {
        kind: 'event',
        text: '',
        event: {
          name: 'Выезд на озеро',
          description: 'Берём палатки, мангал и гитару. Сбор у метро.',
          start: Date.now() + 3 * 86_400_000,
          end: Date.now() + 5 * 86_400_000,
          place: 'Домики у озера, Выборгский район',
          lat: 60.7096,
          lon: 28.7489,
          canceled: false,
          call: false,
        },
      });
      k.add(dima, 4, {
        kind: 'location',
        text: 'Еду, буду через 20 минут',
        location: {
          lat: 59.9386,
          lon: 30.3141,
          live: true,
          accuracy: 12,
          speed: 11,
          heading: 40,
          sequence: 7,
          updatedAt: Date.now() - 60_000,
        },
      });
    },
  },
};

const ABOUT_EN = [
  'Available',
  'Busy',
  'At the gym',
  'Out of office until Monday',
  'Coffee first',
  'Urgent calls only',
];
const ABOUT_RU = ['На связи', 'Занят', 'В отпуске', 'Пишите, перезвоню'];
const ABOUT_JA = ['よろしくお願いします', '仕事中', '旅行中'];
const GROUP_ABOUT: Record<string, string> = {
  'Design team':
    'Design reviews, screenshots and the occasional meme. Specs live in the shared drive.',
  'Product launch': 'Coordination for the December launch. Decisions go in the pinned doc.',
  Семья: 'Семейный чат 🏡',
  'Weekend hiking': 'Routes, carpools and weather. Saturday mornings.',
  'Book club': 'One book a month, Thursdays at someone’s place.',
  'Apartment 4B': 'Bills, chores and who ate my yoghurt.',
  'Company announcements': 'Only admins can post here.',
};

function pickBy<T>(seed: string, list: readonly T[]): T {
  let h = 0;
  for (const c of seed) h = (Math.imul(h, 31) + c.codePointAt(0)!) >>> 0;
  return list[h % list.length];
}

// stable numbers from the ranges set aside for fiction (555-01xx, 07700 900xxx...), with a
// country code that matches the name's script
export function phoneFor(name: string): string {
  let h = 7;
  for (const c of name) h = (Math.imul(h, 131) + c.codePointAt(0)!) >>> 0;
  // re-mix per digit, otherwise every group repeats the same tail
  const digit = () => {
    h = (Math.imul(h ^ (h >>> 13), 0x5bd1e995) + 0x6b43a9b5) >>> 0;
    return (h >>> 8) % 10;
  };
  const d = (n: number) => Array.from({ length: n }, digit).join('');
  if (/\p{Script=Cyrillic}/u.test(name)) return `+7 900 000-${d(2)}-${d(2)}`;
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(name))
    return `+81 90 0000 ${d(4)}`;
  const region = pickBy(name, ['us', 'uk', 'de']);
  if (region === 'us') return `+1 ${pickBy(name, ['202', '312', '415', '617'])} 555 01${d(2)}`;
  if (region === 'uk') return `+44 7700 900${d(3)}`;
  return `+49 170 000 ${d(4)}`;
}

function aboutFor(name: string): string {
  if (/\p{Script=Cyrillic}/u.test(name)) return pickBy(name, ABOUT_RU);
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(name))
    return pickBy(name, ABOUT_JA);
  return pickBy(name, ABOUT_EN);
}

export function buildChatInfo(db: MockDB, jid: JID): ChatInfo {
  const chat = db.chats.get(jid);
  if (!chat) throw new Error(`unknown chat ${jid}`);
  const list = db.messages.get(jid) ?? [];
  const media = list.filter((m) => (m.kind === 'image' || m.kind === 'video') && !m.contentUnknown);
  const recentMedia: MediaRef[] = media
    .slice(-6)
    .reverse()
    .map((m) => ({
      pk: m.pk,
      kind: m.kind,
      width: m.media?.width,
      height: m.media?.height,
      duration: m.media?.duration,
    }));

  const base = {
    jid,
    name: chat.name,
    mediaCount: media.length,
    docCount: list.filter((m) => m.kind === 'document').length,
    linkCount: list.filter((m) => /https?:\/\/|www\./.test(m.text)).length,
    recentMedia,
    deletedKept: list.filter((m) => m.deleted && !m.contentUnknown).length,
    edited: list.filter((m) => m.editedAt).length,
  };

  if (!chat.isGroup) return { ...base, about: aboutFor(chat.name), phone: phoneFor(chat.name) };

  const others = db.members.get(jid) ?? [];
  // the first listed member created the group and is its admin; you're an admin of some groups
  const meAdmin = pickBy(chat.name, [true, false, false]);
  const members: GroupMember[] = [
    { jid: db.me.jid, name: 'You', phone: db.me.phone, isMe: true, isAdmin: meAdmin },
    ...others.map((p, i) => ({
      jid: p.jid,
      name: p.name,
      phone: phoneFor(p.name),
      isMe: false,
      isAdmin: i === 0,
    })),
  ];
  return {
    ...base,
    about: GROUP_ABOUT[chat.name] ?? '',
    members,
    createdAt: (list[0]?.timestamp ?? chat.lastActivity) - 3 * 86_400_000,
    createdBy: others[0]?.name,
  };
}

// A real-looking 1:1 chat from yesterday, typed in as-is (typos included).
function addMandarin(db: MockDB, now: number, pk: () => string): void {
  const name = 'Мандарин';
  const jid = jidFor(name, false);
  const them = { jid, name };
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const at = (h: number, m: number) => {
    const d = new Date(yesterday);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  const msg = (
    fromMe: boolean,
    h: number,
    m: number,
    text: string,
    extra: Partial<Message> = {},
  ): Message => ({
    pk: pk(),
    id: `3EB0MAND${db.nextPk}`,
    chatJid: jid,
    senderJid: fromMe ? ME.jid : them.jid,
    senderName: fromMe ? ME.name : them.name,
    fromMe,
    timestamp: at(h, m),
    kind: 'text',
    text,
    status: fromMe ? 'read' : undefined,
    reactions: [],
    ...extra,
  });
  // stands in for a custom Telegram sticker reaction, which WhatsApp doesn't have
  const sticker = '🩵';

  const list: Message[] = [
    msg(true, 2, 4, 'уже спишь или как?'),
    msg(true, 2, 4, 'мой батя либо самый настоящий воздух'),
    msg(true, 2, 4, 'либо он будет проверять завтра'),
    msg(true, 2, 5, 'кароче, спокойной ночи'),
    msg(true, 2, 5, 'и удачи там'),
    msg(true, 2, 5, 'да в целом во всем удачи тебе', {
      reactions: [
        { emoji: '❤️', count: 1, mine: false },
        { emoji: sticker, count: 1, mine: false },
      ],
    }),
    msg(true, 12, 9, 'ой'),
    msg(true, 12, 9, 'пр пр'),
  ];
  const owner = msg(true, 12, 10, 'давай щас зайду и овнерку передашь?', {
    reactions: [
      { emoji: '👌', count: 1, mine: false },
      { emoji: sticker, count: 1, mine: false },
    ],
  });
  list.push(owner, msg(true, 12, 10, 'я там зашел ес шо'), msg(true, 12, 10, 'и в чат щас зайду'));
  const thanks = msg(true, 12, 10, 'спасибо то что выручила');
  list.push(
    thanks,
    msg(true, 12, 10, 'я так быстро никогда не удалял чаты, лол'),
    msg(false, 12, 10, 'д', { replyTo: quote(owner) }),
    msg(false, 12, 10, 'д кнш', { replyTo: quote(thanks) }),
    msg(false, 12, 11, 'вс'),
    msg(true, 12, 11, 'огромное спасибо'),
  );

  db.members.set(jid, [them]);
  db.messages.set(jid, list);
  db.chats.set(jid, {
    jid,
    name,
    isGroup: false,
    pinned: false,
    archived: false,
    muted: false,
    unread: 0,
    lastMessage: null,
    lastActivity: list[list.length - 1].timestamp,
    lastSeen: at(12, 14),
    online: false,
  });
}
