import type { Chat, EditVersion, JID, MediaInfo, Me, Message, MessageKind, Reaction } from '../types';
import { createRng, type Rng } from '../../lib/rng';
import { EN, FILES, JA, LINK_TEXT, LONG_TEXT, MULTILINE, REACTIONS, RU } from './texts';

type Lang = 'en' | 'ru' | 'ja';

interface ChatSeed {
  name: string;
  group?: string[];
  lang?: Lang;
  count: number;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  unread?: number;
  // minutes since last activity
  ago: number;
  online?: boolean;
  lastSeenAgo?: number | null;
}

export const ME: Me = { jid: '491701234567@s.whatsapp.net', name: 'You', phone: '+49 170 1234567' };

const SEEDS: ChatSeed[] = [
  { name: 'Anna Petrova', count: 260, pinned: true, ago: 62, online: true },
  {
    name: 'Design team',
    group: ['Mark Ellison', 'Sophie Laurent', 'Priya Raman', 'Jonas Weber', 'Kenji Watanabe', 'Emma Lindqvist'],
    count: 340,
    pinned: true,
    ago: 34,
  },
  { name: 'Дмитрий Соколов', lang: 'ru', count: 180, pinned: true, ago: 42, lastSeenAgo: 35 },
  { name: 'Mark Ellison', count: 60, ago: 75, lastSeenAgo: 70 },
  {
    name: 'Product launch',
    group: ['Mark Ellison', 'Anna Petrova', 'Ryan Patel', 'Grace Kim', 'Oliver Hughes', 'Mia Rossi', 'Liam O’Connor'],
    count: 300,
    unread: 37,
    ago: 18,
  },
  { name: '山田太郎', lang: 'ja', count: 40, unread: 1, ago: 130, lastSeenAgo: null },
  {
    name: 'Семья',
    lang: 'ru',
    group: ['Мама', 'Папа', 'Ольга Иванова', 'Алексей Морозов'],
    count: 120,
    unread: 5,
    ago: 55,
  },
  {
    name: '東京オフィス',
    lang: 'ja',
    group: ['山田太郎', '佐藤 花子', '鈴木一郎', 'Kenji Watanabe'],
    count: 150,
    ago: 200,
  },
  { name: 'Sophie Laurent', count: 30, ago: 300, lastSeenAgo: 280 },
  { name: 'Jonas Weber', count: 12, ago: 600, lastSeenAgo: 590 },
  {
    name: 'Weekend hiking',
    group: ['Liam O’Connor', 'Hannah Fischer', 'Noah Brooks', 'Chloe Martin'],
    count: 45,
    unread: 3,
    ago: 380,
  },
  { name: 'Ольга Иванова', lang: 'ru', count: 25, ago: 900, lastSeenAgo: 800 },
  {
    name: 'Book club',
    group: ['Emma Lindqvist', 'Ines Moreau', 'Grace Kim'],
    count: 30,
    muted: true,
    unread: 8,
    ago: 1000,
  },
  { name: 'Priya Raman', count: 20, ago: 1300, lastSeenAgo: 1250 },
  { name: '佐藤 花子', lang: 'ja', count: 15, ago: 1500, lastSeenAgo: null },
  { name: 'Tomás García', count: 10, ago: 2000, online: true },
  {
    name: 'Apartment 4B',
    group: ['Noah Brooks', 'Mia Rossi', 'Oliver Hughes'],
    count: 25,
    muted: true,
    unread: 2,
    ago: 2300,
  },
  { name: 'Мама', lang: 'ru', count: 40, ago: 2600, lastSeenAgo: 2500 },
  { name: 'Kenji Watanabe', count: 18, ago: 3000, lastSeenAgo: 2900 },
  { name: 'Emma Lindqvist', count: 8, ago: 3500, lastSeenAgo: 3400 },
  {
    name: 'Football Sundays',
    group: ['Ryan Patel', 'Liam O’Connor', 'Tomás García', 'Noah Brooks', 'Oliver Hughes'],
    count: 35,
    ago: 4200,
  },
  { name: 'Noah Brooks', count: 6, ago: 5000, lastSeenAgo: 4900 },
  { name: 'Алексей Морозов', lang: 'ru', count: 14, ago: 5600, lastSeenAgo: 5500 },
  {
    name: 'Release notes',
    group: ['Mark Ellison', 'Anna Petrova'],
    count: 20,
    muted: true,
    unread: 120,
    ago: 6000,
  },
  { name: 'Hannah Fischer', count: 9, ago: 7000, lastSeenAgo: 6900 },
  {
    name: 'Курсы японского',
    lang: 'ru',
    group: ['Сергей Кузнецов', 'Ольга Иванова', '鈴木一郎'],
    count: 22,
    ago: 8000,
  },
  { name: '鈴木一郎', lang: 'ja', count: 7, ago: 9000, lastSeenAgo: 8900 },
  { name: 'Chloe Martin', count: 11, ago: 10000, lastSeenAgo: 9000 },
  { name: 'Ryan Patel', count: 5, ago: 12000, lastSeenAgo: 11000 },
  {
    name: 'Neighbours',
    group: ['Hannah Fischer', 'Ines Moreau', 'Chloe Martin', 'Сергей Кузнецов'],
    count: 18,
    muted: true,
    ago: 14000,
  },
  { name: 'Ines Moreau', count: 6, ago: 16000, lastSeenAgo: null },
  { name: 'Сергей Кузнецов', lang: 'ru', count: 9, ago: 18000, lastSeenAgo: 17000 },
  { name: 'Grace Kim', count: 4, ago: 21000, lastSeenAgo: 20000 },
  {
    name: 'Photography',
    group: ['Mia Rossi', 'Kenji Watanabe', 'Emma Lindqvist'],
    count: 14,
    ago: 25000,
  },
  { name: 'Oliver Hughes', count: 3, ago: 30000, lastSeenAgo: 29000 },
  { name: 'Liam O’Connor', count: 7, ago: 33000, lastSeenAgo: 32000 },
  {
    name: 'Climbing gym',
    group: ['Hannah Fischer', 'Jonas Weber'],
    count: 20,
    archived: true,
    ago: 40000,
  },
  {
    name: 'Old school friends',
    lang: 'ru',
    group: ['Алексей Морозов', 'Сергей Кузнецов', 'Дмитрий Соколов'],
    count: 30,
    archived: true,
    muted: true,
    unread: 4,
    ago: 45000,
  },
  {
    name: 'Conference 2025',
    group: ['Grace Kim', 'Ryan Patel', 'Priya Raman'],
    count: 25,
    archived: true,
    ago: 60000,
  },
  { name: 'Mia Rossi', count: 5, archived: true, ago: 70000, lastSeenAgo: 69000 },
];

const slug = (s: string) => Array.from(s).map((c) => c.codePointAt(0)!.toString(36)).join('').slice(0, 20);

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

const MIN = 60_000;

function textFor(lang: Lang, rng: Rng): string {
  if (lang === 'ru') return rng.chance(0.85) ? rng.pick(RU) : rng.pick(EN);
  if (lang === 'ja') return rng.chance(0.85) ? rng.pick(JA) : rng.pick(EN);
  return rng.pick(EN);
}

function randomMedia(rng: Rng): { kind: MessageKind; media: MediaInfo; text: string } {
  const r = rng.next();
  if (r < 0.4) {
    const landscape = rng.chance(0.6);
    return {
      kind: 'image',
      media: { width: landscape ? 1600 : 1080, height: landscape ? 1067 : 1440, size: rng.int(200, 3000) * 1000 },
      text: rng.chance(0.4) ? rng.pick(['From yesterday', 'Look at this', 'The view from the office']) : '',
    };
  }
  if (r < 0.55) {
    return {
      kind: 'video',
      media: { width: 1920, height: 1080, duration: rng.int(5, 140), size: rng.int(2000, 40000) * 1000 },
      text: '',
    };
  }
  if (r < 0.75) {
    return { kind: 'document', media: { ...rng.pick(FILES) }, text: '' };
  }
  const duration = rng.int(3, 95);
  return {
    kind: 'voice',
    media: { duration, waveform: Array.from({ length: 40 }, () => 0.15 + rng.next() * 0.85) },
    text: '',
  };
}

function randomReactions(rng: Rng): Reaction[] {
  const n = rng.int(1, 3);
  const out: Reaction[] = [];
  for (let i = 0; i < n; i++) {
    const emoji = rng.pick(REACTIONS);
    if (out.some((r) => r.emoji === emoji)) continue;
    out.push({ emoji, count: rng.int(1, 4), mine: rng.chance(0.3) });
  }
  return out;
}

export function preview(m: Message): string {
  if (m.contentUnknown) return 'Deleted message';
  if (m.text) return m.text.replace(/\s+/g, ' ');
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
    const lang = s.lang ?? 'en';
    const people = isGroup
      ? s.group!.map((n) => ({ jid: jidFor(n, false), name: n }))
      : [{ jid, name: s.name }];
    db.members.set(jid, people);

    // walk backwards from the last activity, in bursts
    const times: number[] = [];
    let t = now - s.ago * MIN;
    for (let i = 0; i < s.count; i++) {
      times.push(t);
      t -= rng.chance(0.12) ? rng.int(60, 900) * MIN : rng.int(10, 240) * 1000;
    }
    times.reverse();

    const unread = Math.min(s.unread ?? 0, s.count);
    const list: Message[] = [];
    let lastSender = '';
    for (let i = 0; i < times.length; i++) {
      const forcedIncoming = i >= times.length - unread;
      // keep runs of the same sender so grouping shows up
      const fromMe = forcedIncoming ? false : rng.chance(lastSender === 'me' ? 0.6 : 0.35);
      const who = fromMe ? null : rng.pick(people);
      lastSender = fromMe ? 'me' : who!.jid;

      const m: Message = {
        pk: pk(),
        id: `3EB0${(db.nextPk * 7919).toString(16).toUpperCase()}`,
        chatJid: jid,
        senderJid: fromMe ? ME.jid : who!.jid,
        senderName: fromMe ? ME.name : who!.name,
        fromMe,
        timestamp: times[i],
        kind: 'text',
        text: textFor(lang, rng),
        reactions: [],
      };
      const roll = rng.next();
      if (roll < 0.06) Object.assign(m, randomMedia(rng));
      else if (roll < 0.09) m.text = LONG_TEXT;
      else if (roll < 0.12) m.text = MULTILINE;
      else if (roll < 0.14) m.text = LINK_TEXT;
      if (rng.chance(0.07)) m.reactions = randomReactions(rng);
      if (list.length > 5 && rng.chance(0.06)) {
        const target = list[list.length - rng.int(1, Math.min(12, list.length))];
        m.replyTo = {
          pk: target.pk,
          senderName: target.senderName,
          fromMe: target.fromMe,
          kind: target.kind,
          text: preview(target),
        };
      }
      if (fromMe) m.status = 'read';
      list.push(m);
    }

    const last = list[list.length - 1];
    if (last?.fromMe) last.status = s.online ? 'read' : 'delivered';

    db.messages.set(jid, list);
    db.chats.set(jid, {
      jid,
      name: s.name,
      isGroup,
      memberCount: isGroup ? people.length + 1 : undefined,
      pinned: !!s.pinned,
      archived: !!s.archived,
      muted: !!s.muted,
      unread: s.unread ?? 0,
      lastMessage: null,
      lastActivity: last?.timestamp ?? now - s.ago * MIN,
      lastSeen: isGroup ? undefined : s.lastSeenAgo == null ? null : now - s.lastSeenAgo * MIN,
      online: isGroup ? undefined : !!s.online,
    });
  }

  addShowcase(db, now, pk);

  for (const [jid, list] of db.messages) refreshChatPreview(db, jid, list);
  return db;
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

// Hand-written messages at the end of the busiest chats so every bubble variant is on screen.
function addShowcase(db: MockDB, now: number, pk: () => string): void {
  const anna = jidFor('Anna Petrova', false);
  const design = jidFor('Design team', true);
  const mark = { jid: jidFor('Mark Ellison', false), name: 'Mark Ellison' };
  const sophie = { jid: jidFor('Sophie Laurent', false), name: 'Sophie Laurent' };
  const annaP = { jid: anna, name: 'Anna Petrova' };
  const me = { jid: ME.jid, name: ME.name };

  const mk = (
    chatJid: JID,
    who: { jid: JID; name: string },
    minsAgo: number,
    extra: Partial<Message>,
  ): Message => ({
    pk: pk(),
    id: `3EB0SHOW${db.nextPk}`,
    chatJid,
    senderJid: who.jid,
    senderName: who.name,
    fromMe: who.jid === ME.jid,
    timestamp: now - minsAgo * MIN,
    kind: 'text',
    text: '',
    reactions: [],
    status: who.jid === ME.jid ? 'read' : undefined,
    ...extra,
  });

  const a: Message[] = [];
  const plan = mk(anna, annaP, 58, { text: LINK_TEXT });
  a.push(plan);
  a.push(
    mk(anna, me, 56, {
      text: 'Looks solid. I left a couple of comments on the timeline section.',
      replyTo: { pk: plan.pk, senderName: plan.senderName, fromMe: false, kind: 'text', text: LINK_TEXT },
    }),
  );
  const edited = mk(anna, annaP, 52, {
    text: 'Dinner is at 19:30 at the place on Linden street, table under my name',
    editedAt: now - 47 * MIN,
    editCount: 2,
    reactions: [{ emoji: '👍', count: 1, mine: true }],
  });
  db.history.set(edited.pk, [
    { text: 'Dinner is at 19:00', at: now - 52 * MIN },
    { text: 'Dinner is at 19:30 at the place on Linden street', at: now - 50 * MIN },
    { text: edited.text, at: now - 47 * MIN },
  ]);
  a.push(edited);
  a.push(
    mk(anna, annaP, 46, {
      text: 'Ugh, ignore what I said about Mark, that came out wrong',
      deleted: { byJid: anna, byName: 'Anna Petrova', at: now - 44 * MIN },
    }),
  );
  a.push(
    mk(anna, annaP, 40, {
      kind: 'image',
      media: { width: 1600, height: 1067, size: 1_840_000 },
      text: 'The terrace, for reference',
    }),
  );
  a.push(
    mk(anna, me, 38, {
      kind: 'document',
      media: { fileName: 'reservation-confirmation.pdf', size: 248_000, mime: 'application/pdf' },
    }),
  );
  a.push(
    mk(anna, annaP, 30, {
      kind: 'voice',
      media: {
        duration: 23,
        waveform: [0.2, 0.4, 0.6, 0.5, 0.8, 0.9, 0.7, 0.4, 0.3, 0.5, 0.7, 0.9, 1, 0.8, 0.6, 0.4, 0.3, 0.5, 0.6, 0.8, 0.7, 0.5, 0.3, 0.2, 0.4, 0.6, 0.7, 0.5, 0.3, 0.2, 0.3, 0.5, 0.6, 0.4, 0.3, 0.2, 0.3, 0.2, 0.15, 0.1],
      },
    }),
  );
  a.push(mk(anna, annaP, 24, { contentUnknown: true, deleted: { byJid: anna, byName: 'Anna Petrova', at: now - 24 * MIN } }));
  a.push(
    mk(anna, me, 20, {
      text: 'Wait, what did you just delete?',
      deleted: { byJid: ME.jid, byName: 'You', at: now - 19 * MIN },
    }),
  );
  a.push(mk(anna, me, 18, { text: MULTILINE, reactions: [{ emoji: '😂', count: 1, mine: false }] }));
  a.push(mk(anna, annaP, 5, { kind: 'video', media: { width: 1080, height: 1920, duration: 14, size: 8_400_000 } }));
  a.push(mk(anna, annaP, 3, { text: 'Nothing important. See you at 19:30!' }));
  db.messages.get(anna)!.push(...a);

  const d: Message[] = [];
  d.push(mk(design, mark, 30, { text: LONG_TEXT, reactions: [{ emoji: '🙏', count: 3, mine: true }, { emoji: '👍', count: 2, mine: false }] }));
  const own = mk(design, me, 26, {
    text: 'I can take the release notes, draft by Tuesday',
    editedAt: now - 25 * MIN,
    editCount: 1,
  });
  db.history.set(own.pk, [
    { text: 'I can take the release notes', at: now - 26 * MIN },
    { text: own.text, at: now - 25 * MIN },
  ]);
  d.push(own);
  d.push(
    mk(design, sophie, 20, {
      text: 'Dark mode screenshots attached, the hairlines still look too strong on the sidebar',
      deleted: { byJid: sophie.jid, byName: 'Sophie Laurent', at: now - 15 * MIN },
    }),
  );
  d.push(mk(design, sophie, 19, { kind: 'image', media: { width: 1080, height: 1350, size: 920_000 } }));
  d.push(mk(design, mark, 9, { text: 'Thanks all, I think we are in good shape' }));
  db.messages.get(design)!.push(...d);

  // generated history ends before the showcase, so these counts match the tail
  db.chats.get(anna)!.unread = 2;
  db.chats.get(design)!.unread = 3;
}
