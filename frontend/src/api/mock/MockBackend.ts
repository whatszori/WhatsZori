import type { Backend } from '../backend';
import type {
  ChangeItem,
  ChangeKind,
  ChangePage,
  AppSettings,
  AuthStatus,
  BackendEventName,
  BackendEvents,
  Chat,
  ChatInfo,
  ChatList,
  ExportOptions,
  GroupEvent,
  SharedKind,
  Profile,
  ConnState,
  Contact,
  EditVersion,
  GhostSettings,
  JID,
  Message,
  MessagePK,
  MessagePage,
  Reaction,
  SearchHit,
} from '../types';
import { buildChatInfo, createMockDB, preview, refreshChatPreview, type MockDB } from './data';
import { DEFAULT_GHOST, withDefaults } from '../defaults';
import type { SystemPalette } from '../events';
import type { UserTheme } from '../types';
import { Emitter } from './emitter';
import { phoneDigits } from '../../lib/phone';
import { Simulator } from './simulator';

// Browsers don't expose the OS accent, so "Use system accent" gets a calm blue here.
export const MOCK_SYSTEM_ACCENT = '#4a6fa5';

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function browserPalette(): SystemPalette {
  const q = darkQuery();
  return {
    source: 'browser',
    scheme: q ? (q.matches ? 'dark' : 'light') : 'none',
    accent: MOCK_SYSTEM_ACCENT,
    accentFg: '#ffffff',
    raw: {},
  };
}

export interface DevControls {
  simulateScan(): void;
  setDemo(on: boolean): void;
  isDemo(): boolean;
  setConnState(state: ConnState): void;
}

export interface MockOptions {
  latency?: [number, number];
  persist?: boolean;
  now?: number;
}

const STORE_KEY = 'wz.mock';
const QR_TTL = 20_000;

const clone = <T>(v: T): T => structuredClone(v);

function readStore(): Partial<{
  loggedIn: boolean;
  settings: AppSettings;
  ghost: GhostSettings;
  profile: Profile;
}> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export class MockBackend implements Backend {
  readonly kind = 'mock' as const;
  readonly db: MockDB;
  private emitter = new Emitter();
  private auth_: AuthStatus = { state: 'logged-out', me: null };
  private conn_: ConnState = 'offline';
  private settings_: AppSettings;
  private ghost_: GhostSettings;
  private profile_: Profile;
  private byPk = new Map<MessagePK, Message>();
  private qrTimer: number | undefined;
  private loginTimer: number | undefined;
  private simulator: Simulator;
  // chat the user last opened, the simulator prefers it so events are visible
  focusChat: JID | null = null;
  private lists_: ChatList[] = [];
  private nextListId = 1;
  private blocked = new Set<JID>();

  constructor(private opts: MockOptions = {}) {
    this.db = createMockDB(opts.now);
    for (const list of this.db.messages.values()) for (const m of list) this.byPk.set(m.pk, m);
    const stored = opts.persist ? readStore() : {};
    this.settings_ = withDefaults(stored.settings);
    this.ghost_ = { ...DEFAULT_GHOST, ...stored.ghost };
    this.profile_ = {
      name: 'Alex Morgan',
      about: 'Available',
      phone: this.db.me.phone,
      ...stored.profile,
    };
    if (stored.loggedIn) {
      this.auth_ = { state: 'logged-in', me: this.db.me };
      window.setTimeout(() => this.setConn('connected'), 700);
    }
    this.simulator = new Simulator(this);
    darkQuery()?.addEventListener('change', () =>
      this.emit('wz:systheme:changed', browserPalette()),
    );
  }

  private wait(): Promise<void> {
    const [min, max] = this.opts.latency ?? [50, 300];
    if (max <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
  }

  private save(): void {
    if (!this.opts.persist) return;
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        loggedIn: this.auth_.state === 'logged-in',
        settings: this.settings_,
        ghost: this.ghost_,
        profile: this.profile_,
      }),
    );
  }

  emit<E extends BackendEventName>(event: E, payload: BackendEvents[E]): void {
    this.emitter.emit(event, payload);
  }

  on<E extends BackendEventName>(event: E, handler: (p: BackendEvents[E]) => void) {
    return this.emitter.on(event, handler);
  }

  get currentSettings(): AppSettings {
    return this.settings_;
  }

  getByPk(pk: MessagePK): Message | undefined {
    return this.byPk.get(pk);
  }

  private setAuth(next: AuthStatus): void {
    this.auth_ = next;
    this.save();
    this.emit('auth:state', clone(next));
  }

  private setConn(state: ConnState): void {
    this.conn_ = state;
    this.emit('conn:state', { state });
  }

  private emitQR(): void {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '2@';
    for (let i = 0; i < 48; i++) code += chars[Math.floor(Math.random() * chars.length)];
    this.emit('auth:qr', { code, expiresIn: QR_TTL });
  }

  private completeLogin(): void {
    window.clearInterval(this.qrTimer);
    window.clearTimeout(this.loginTimer);
    this.setAuth({ state: 'logging-in', me: null });
    this.setConn('connecting');
    window.setTimeout(() => {
      this.setAuth({ state: 'logged-in', me: this.db.me });
      this.setConn('connected');
    }, 1200);
  }

  readonly dev: DevControls = {
    simulateScan: () => {
      if (this.auth_.state === 'qr' || this.auth_.state === 'pairing') this.completeLogin();
    },
    setDemo: (on) => (on ? this.simulator.start() : this.simulator.stop()),
    isDemo: () => this.simulator.running,
    setConnState: (s) => this.setConn(s),
  };

  auth = {
    getState: async (): Promise<AuthStatus> => {
      await this.wait();
      return clone(this.auth_);
    },
    getConnState: async (): Promise<ConnState> => this.conn_,
    startQRLogin: async (): Promise<void> => {
      await this.wait();
      window.clearInterval(this.qrTimer);
      this.setAuth({ state: 'qr', me: null });
      this.emitQR();
      this.qrTimer = window.setInterval(() => this.emitQR(), QR_TTL);
      window.clearTimeout(this.loginTimer);
      // long enough to see one QR refresh; clicking the code logs in right away
      this.loginTimer = window.setTimeout(() => this.completeLogin(), 25_000);
    },
    pairWithPhone: async (phone: string): Promise<string> => {
      await this.wait();
      if (phone.replace(/\D/g, '').length < 8) throw new Error('Phone number looks too short');
      window.clearInterval(this.qrTimer);
      this.setAuth({ state: 'pairing', me: null });
      const chars = 'ABCDEFGHJKLMNPQRSTVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
      window.clearTimeout(this.loginTimer);
      this.loginTimer = window.setTimeout(() => this.completeLogin(), 8_000);
      return code;
    },
    // wipe has nothing to delete here: the mock regenerates its data on every load
    logout: async (_wipe?: boolean): Promise<void> => {
      await this.wait();
      this.simulator.stop();
      window.clearInterval(this.qrTimer);
      window.clearTimeout(this.loginTimer);
      this.setConn('offline');
      this.setAuth({ state: 'logged-out', me: null });
    },
  };

  chats = {
    listChats: async (): Promise<Chat[]> => {
      await this.wait();
      return clone([...this.db.chats.values()]);
    },
    markRead: async (jid: JID): Promise<void> => {
      this.focusChat = jid;
      const chat = this.db.chats.get(jid);
      if (!chat || chat.unread === 0) return;
      await this.wait();
      chat.unread = 0;
      this.emit('chat:update', { chat: clone(chat) });
    },
    setPinned: (jid: JID, pinned: boolean) => this.patchChat(jid, { pinned }),
    setArchived: (jid: JID, archived: boolean) => this.patchChat(jid, { archived }),
    setMuted: (jid: JID, muted: boolean) => this.patchChat(jid, { muted }),
    getInfo: async (jid: JID): Promise<ChatInfo> => {
      await this.wait();
      const chat = this.db.chats.get(jid);
      if (!chat) {
        // a group member we never wrote to
        const member = [...this.db.members.values()].flat().find((m) => m.jid === jid);
        return {
          jid,
          name: member?.name ?? '+' + jid.split('@')[0],
          about: 'Hey there! I am using WhatsApp.',
          phone: '+' + jid.split('@')[0],
          mediaCount: 0,
          docCount: 0,
          linkCount: 0,
          recentMedia: [],
          deletedKept: 0,
          edited: 0,
          noChat: true,
          blocked: this.blocked.has(jid),
        };
      }
      return clone({
        ...buildChatInfo(this.db, jid),
        name: chat.name,
        blocked: this.blocked.has(jid),
      });
    },
    setTyping: async (): Promise<void> => undefined,
    open: async (jid: JID): Promise<Chat> => {
      await this.wait();
      let chat = this.db.chats.get(jid);
      if (!chat) {
        const member = [...this.db.members.values()].flat().find((m) => m.jid === jid);
        chat = {
          jid,
          name: member?.name ?? '+' + jid.split('@')[0],
          isGroup: false,
          pinned: false,
          archived: false,
          muted: false,
          unread: 0,
          lastMessage: null,
          lastActivity: Date.now(),
        };
        this.db.chats.set(jid, chat);
        this.db.messages.set(jid, []);
      }
      return clone(chat);
    },
    setFavorite: (jid: JID, favorite: boolean) => this.patchChat(jid, { favorite }),
    clear: async (jid: JID): Promise<void> => {
      await this.wait();
      const chat = this.db.chats.get(jid);
      if (!chat) return;
      this.db.messages.set(jid, []);
      chat.lastMessage = null;
      chat.unread = 0;
      this.emit('chat:cleared', { jid });
      this.emit('chat:update', { chat: clone(chat) });
    },
    delete: async (jid: JID): Promise<void> => {
      await this.wait();
      this.db.chats.delete(jid);
      this.db.messages.delete(jid);
      this.emit('chat:removed', { jid });
    },
    setBlocked: async (jid: JID, blocked: boolean): Promise<void> => {
      await this.wait();
      if (blocked) this.blocked.add(jid);
      else this.blocked.delete(jid);
    },
    leave: async (jid: JID): Promise<void> => {
      await this.wait();
      const chat = this.db.chats.get(jid);
      if (chat) this.emit('chat:update', { chat: clone(chat) });
    },
    removeMember: async (group: JID, member: JID): Promise<void> => {
      await this.wait();
      const list = this.db.members.get(group);
      if (list)
        this.db.members.set(
          group,
          list.filter((m) => m.jid !== member),
        );
    },
    groupEvents: async (jid: JID): Promise<GroupEvent[]> => {
      await this.wait();
      const members = this.db.members.get(jid) ?? [];
      const day = 86_400_000;
      const now = Date.now();
      const admin = members[0];
      if (!admin) return [];
      const out: GroupEvent[] = members.slice(1, 6).map((m, i) => ({
        at: now - (i + 1) * 3 * day,
        kind: i % 3 === 2 ? 'join' : 'add',
        actorJid: i % 3 === 2 ? m.jid : admin.jid,
        actorName: i % 3 === 2 ? m.name : admin.name,
        targetJid: m.jid,
        targetName: m.name,
      }));
      out.push({
        at: now - 40 * day,
        kind: 'create',
        actorJid: admin.jid,
        actorName: admin.name,
        targetJid: '',
        targetName: '',
      });
      return out;
    },
    setActive: async (): Promise<void> => undefined,
    lists: async (): Promise<ChatList[]> => clone(this.lists_),
    createList: async (name: string): Promise<ChatList> => {
      await this.wait();
      const n = name.trim().slice(0, 40);
      if (!n) throw new Error('A list needs a name');
      const l = { id: this.nextListId++, name: n, position: this.lists_.length };
      this.lists_.push(l);
      return clone(l);
    },
    renameList: async (id: number, name: string): Promise<void> => {
      await this.wait();
      const l = this.lists_.find((x) => x.id === id);
      if (!l || !name.trim()) throw new Error('A list needs a name');
      l.name = name.trim().slice(0, 40);
    },
    deleteList: async (id: number): Promise<void> => {
      await this.wait();
      this.lists_ = this.lists_.filter((l) => l.id !== id);
      for (const c of this.db.chats.values()) {
        if (c.lists?.includes(id)) {
          c.lists = c.lists.filter((x) => x !== id);
          this.emit('chat:update', { chat: clone(c) });
        }
      }
    },
    setInList: async (id: number, jid: JID, inList: boolean): Promise<void> => {
      const c = this.db.chats.get(jid);
      if (!c) return;
      const cur = new Set(c.lists ?? []);
      if (inList) cur.add(id);
      else cur.delete(id);
      await this.patchChat(jid, { lists: [...cur].sort((a, b) => a - b) });
    },
  };

  contacts = {
    list: async (): Promise<Contact[]> => {
      await this.wait();
      return [...this.db.chats.values()]
        .filter((c) => !c.isGroup)
        .map((c) => ({ jid: c.jid, name: c.name, phone: '+' + c.jid.split('@')[0] }));
    },
    // every valid number "is on WhatsApp" in the preview
    lookup: async (phone: string): Promise<Contact> => {
      await this.wait();
      const d = phoneDigits(phone);
      if (!d) throw new Error('Enter the number with its country code, like +49 151 2345678');
      return { jid: d + '@s.whatsapp.net', name: '+' + d, phone: '+' + d };
    },
  };

  notifications = {
    available: async (): Promise<boolean> => false,
    test: async (): Promise<void> => {
      throw new Error('Desktop notifications work in the desktop app');
    },
  };

  export = {
    run: async (_opts: ExportOptions): Promise<string | null> => {
      throw new Error('Exporting chats works in the desktop app');
    },
    cancel: async (): Promise<void> => undefined,
    open: async (): Promise<void> => undefined,
  };

  // mock media are placeholders, there's nothing to load or attach
  media = {
    url: (): string => '',
    avatarUrl: (): string => '',
    saveAs: async (): Promise<string | null> => {
      throw new Error('Saving files works in the desktop app');
    },
    copy: async (): Promise<void> => {
      throw new Error('Copying files works in the desktop app');
    },
    reveal: async (): Promise<void> => undefined,
    canAttach: false,
  };

  profile = {
    get: async (): Promise<Profile> => {
      await this.wait();
      return clone(this.profile_);
    },
    setName: async (name: string): Promise<void> => {
      await this.wait();
      const n = name.trim();
      if (!n) throw new Error("Name can't be empty");
      this.profile_ = { ...this.profile_, name: n.slice(0, 25) };
      this.save();
    },
    setAbout: async (about: string): Promise<void> => {
      await this.wait();
      this.profile_ = { ...this.profile_, about: about.trim().slice(0, 139) };
      this.save();
    },
  };

  private async patchChat(jid: JID, patch: Partial<Chat>): Promise<void> {
    await this.wait();
    const chat = this.db.chats.get(jid);
    if (!chat) throw new Error(`unknown chat ${jid}`);
    Object.assign(chat, patch);
    this.emit('chat:update', { chat: clone(chat) });
  }

  messages = {
    getMessages: async (
      jid: JID,
      beforePk: MessagePK | null,
      limit: number,
    ): Promise<MessagePage> => {
      await this.wait();
      const list = this.db.messages.get(jid) ?? [];
      let end = list.length;
      if (beforePk) {
        const i = list.findIndex((m) => m.pk === beforePk);
        if (i >= 0) end = i;
      }
      const start = Math.max(0, end - limit);
      return { messages: clone(list.slice(start, end)), hasMore: start > 0 };
    },
    changes: async (
      kind: ChangeKind,
      before: { at: number; pk: MessagePK } | null,
      limit: number,
    ): Promise<ChangePage> => {
      await this.wait();
      const all: ChangeItem[] = [];
      for (const [jid, list] of this.db.messages) {
        const chat = this.db.chats.get(jid);
        for (const m of list) {
          const deleted = !!m.deleted && !m.contentUnknown;
          const edited = !!m.editedAt && !m.deleted;
          if ((deleted && kind !== 'edited') || (edited && kind !== 'deleted'))
            all.push({
              chatJid: jid,
              chatName: chat?.name ?? jid,
              message: clone(m),
              change: deleted ? 'deleted' : 'edited',
              at: deleted ? m.deleted!.at : m.editedAt!,
            });
        }
      }
      all.sort((a, b) => b.at - a.at || Number(b.message.pk) - Number(a.message.pk));
      const start = before
        ? all.findIndex(
            (it) =>
              it.at < before.at ||
              (it.at === before.at && Number(it.message.pk) < Number(before.pk)),
          )
        : 0;
      const rest = start < 0 ? [] : all.slice(start);
      return { items: rest.slice(0, limit), hasMore: rest.length > limit };
    },
    getEditHistory: async (pk: MessagePK): Promise<EditVersion[]> => {
      await this.wait();
      return clone(this.db.history.get(pk) ?? []);
    },
    sendText: async (jid: JID, text: string, replyToPk?: MessagePK): Promise<Message> => {
      await this.wait();
      const target = replyToPk ? this.byPk.get(replyToPk) : undefined;
      const m: Message = {
        pk: String(this.db.nextPk++),
        id: `3EB0OUT${this.db.nextPk}`,
        chatJid: jid,
        senderJid: this.db.me.jid,
        senderName: this.db.me.name,
        fromMe: true,
        timestamp: Date.now(),
        kind: 'text',
        text,
        status: 'pending',
        reactions: [],
        replyTo: target && {
          pk: target.pk,
          senderName: target.senderName,
          fromMe: target.fromMe,
          kind: target.kind,
          text: preview(target),
        },
      };
      this.insert(m);
      this.progressStatus(m);
      return clone(m);
    },
    edit: async (pk: MessagePK, text: string): Promise<void> => {
      await this.wait();
      const m = this.byPk.get(pk);
      if (!m || !m.fromMe) throw new Error('can only edit own messages');
      this.applyEdit(m, text);
    },
    forward: async (pks: MessagePK[], jids: JID[]): Promise<number> => {
      await this.wait();
      if (jids.length > 5) throw new Error('You can forward to at most 5 chats at once');
      const src = pks
        .map((pk) => this.byPk.get(pk))
        .filter((m): m is Message => !!m && !m.deleted)
        .sort((a, b) => a.timestamp - b.timestamp);
      let n = 0;
      for (const jid of jids) {
        if (!this.db.messages.has(jid)) this.db.messages.set(jid, []);
        for (const s of src) {
          const m: Message = {
            ...clone(s),
            pk: String(this.db.nextPk++),
            id: `3EB0FWD${this.db.nextPk}`,
            chatJid: jid,
            senderJid: this.db.me.jid,
            senderName: this.db.me.name,
            fromMe: true,
            timestamp: Date.now() + n,
            status: 'pending',
            reactions: [],
            replyTo: undefined,
            editedAt: undefined,
            editCount: undefined,
            forwarded: (s.forwarded ?? 0) + 1,
          };
          this.insert(m);
          this.emit('msg:batch', { messages: [clone(m)] });
          this.progressStatus(m);
          n++;
        }
      }
      return n;
    },
    vote: async (pk: MessagePK, options: string[]): Promise<void> => {
      await this.wait();
      const m = this.byPk.get(pk);
      if (!m?.poll) throw new Error('Not a poll');
      for (const o of m.poll.options) {
        const was = o.mine;
        o.mine = options.includes(o.name);
        if (was !== o.mine) {
          o.votes += o.mine ? 1 : -1;
          o.voters = o.mine ? [...o.voters, 'You'] : o.voters.filter((v) => v !== 'You');
        }
      }
      const voters = new Set(m.poll.options.flatMap((o) => o.voters));
      m.poll.totalVoters = voters.size;
      this.emit('msg:batch', { messages: [clone(m)] });
    },
    deleteLocal: async (jid: JID, pks: MessagePK[]): Promise<void> => {
      await this.wait();
      const list = this.db.messages.get(jid);
      if (!list) return;
      const gone = new Set(pks);
      this.db.messages.set(
        jid,
        list.filter((m) => !gone.has(m.pk)),
      );
      for (const pk of pks) this.byPk.delete(pk);
      refreshChatPreview(this.db, jid, this.db.messages.get(jid)!);
      this.emit('msg:removed', { chatJid: jid, pks });
      this.emit('chat:update', { chat: clone(this.db.chats.get(jid)!) });
    },
    revoke: async (pk: MessagePK): Promise<void> => {
      await this.wait();
      const m = this.byPk.get(pk);
      if (!m || !m.fromMe) throw new Error('can only revoke own messages');
      this.applyRevoke(m, this.db.me.jid, this.db.me.name);
    },
    react: async (pk: MessagePK, emoji: string): Promise<Reaction[]> => {
      await this.wait();
      const m = this.byPk.get(pk);
      if (!m) throw new Error('unknown message');
      const prev = m.reactions.find((r) => r.mine);
      let next = m.reactions
        .map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r))
        .filter((r) => r.count > 0);
      // WA allows one reaction per person; same emoji again = remove
      if (prev?.emoji !== emoji) {
        const ex = next.find((r) => r.emoji === emoji);
        next = ex
          ? next.map((r) => (r === ex ? { ...r, count: r.count + 1, mine: true } : r))
          : [...next, { emoji, count: 1, mine: true }];
      }
      m.reactions = next;
      this.emit('msg:reaction', { chatJid: m.chatJid, pk, reactions: clone(next) });
      return clone(next);
    },
    search: async (query: string, only?: JID): Promise<SearchHit[]> => {
      await this.wait();
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits: SearchHit[] = [];
      for (const [jid, list] of this.db.messages) {
        if (only && jid !== only) continue;
        const chat = this.db.chats.get(jid)!;
        for (const m of list) {
          if (m.text.toLowerCase().includes(q))
            hits.push({ chatJid: jid, chatName: chat.name, message: m });
        }
      }
      hits.sort((a, b) => b.message.timestamp - a.message.timestamp);
      return clone(hits.slice(0, only ? 200 : 50));
    },
    attachFile: async (): Promise<Message | null> => null,
    // the browser preview keeps the voice note as a placeholder bubble; nothing is uploaded
    sendVoice: async (jid: JID, recording: Blob, waveform: number[]): Promise<Message> => {
      await this.wait();
      const m: Message = {
        pk: String(this.db.nextPk++),
        id: `3EB0VOICE${this.db.nextPk}`,
        chatJid: jid,
        senderJid: this.db.me.jid,
        senderName: this.db.me.name,
        fromMe: true,
        timestamp: Date.now(),
        kind: 'voice',
        text: '',
        status: 'pending',
        reactions: [],
        media: {
          duration: Math.max(1, Math.round(recording.size / 4000)),
          waveform: waveform.map((v) => v / 100),
          size: recording.size,
        },
      };
      this.insert(m);
      this.progressStatus(m);
      return clone(m);
    },
    listShared: async (
      jid: JID,
      kind: SharedKind,
      beforePk: MessagePK | null,
      limit: number,
    ): Promise<MessagePage> => {
      await this.wait();
      const match = (m: Message) =>
        kind === 'media'
          ? (m.kind === 'image' || m.kind === 'video') && !!m.media && !m.media.round
          : kind === 'docs'
            ? m.kind === 'document'
            : /https?:\/\/|www\./.test(m.text);
      const all = (this.db.messages.get(jid) ?? [])
        .filter((m) => match(m) && !m.contentUnknown)
        .reverse();
      const start = beforePk ? all.findIndex((m) => m.pk === beforePk) + 1 : 0;
      const page = all.slice(start, start + limit);
      return { messages: clone(page), hasMore: start + limit < all.length };
    },
  };

  privacy = {
    getGhost: async (): Promise<GhostSettings> => {
      await this.wait();
      return clone(this.ghost_);
    },
    setGhost: async (ghost: GhostSettings): Promise<void> => {
      await this.wait();
      this.ghost_ = clone(ghost);
      this.save();
    },
  };

  settings = {
    get: async (): Promise<AppSettings> => {
      await this.wait();
      return clone(this.settings_);
    },
    set: async (s: AppSettings): Promise<void> => {
      await this.wait();
      this.settings_ = clone(s);
      this.save();
    },
  };

  system = {
    version: async (): Promise<string> => __APP_VERSION__,
    platform: async (): Promise<string> => 'browser',
    isSafeMode: async (): Promise<boolean> => false,
    bootOK: async (): Promise<void> => undefined,
    openExternal: async (url: string): Promise<void> => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    // there's no config folder in a browser; the buttons are disabled in mock mode
    openConfigFolder: async (): Promise<void> => undefined,
  };

  systemTheme = {
    get: async (): Promise<SystemPalette> => browserPalette(),
  };

  window = {
    setTheme: async (): Promise<void> => undefined,
    setUnread: async (): Promise<void> => undefined,
  };

  userThemes = {
    list: async (): Promise<UserTheme[]> => [],
    href: (file: string, hash: string) =>
      `/wz-themes/${encodeURIComponent(file)}${hash ? `?h=${hash}` : ''}`,
  };

  insert(m: Message): void {
    const list = this.db.messages.get(m.chatJid);
    if (!list) return;
    list.push(m);
    this.byPk.set(m.pk, m);
    const chat = this.db.chats.get(m.chatJid)!;
    if (!m.fromMe && this.focusChat !== m.chatJid) chat.unread += 1;
    // a new message un-archives a chat unless it's muted, like the official client
    if (chat.archived && !chat.muted && !m.fromMe) chat.archived = false;
    refreshChatPreview(this.db, m.chatJid, list);
    this.emit('chat:update', { chat: clone(chat) });
  }

  private progressStatus(m: Message): void {
    const steps: [number, 'sent' | 'delivered' | 'read'][] = [
      [400, 'sent'],
      [1400, 'delivered'],
      [3400, 'read'],
    ];
    for (const [ms, status] of steps) {
      window.setTimeout(() => {
        m.status = status;
        this.emit('msg:status', { chatJid: m.chatJid, pk: m.pk, status });
        const chat = this.db.chats.get(m.chatJid);
        if (chat?.lastMessage?.pk === m.pk) {
          chat.lastMessage.status = status;
          this.emit('chat:update', { chat: clone(chat) });
        }
      }, ms);
    }
  }

  applyEdit(m: Message, text: string): void {
    const now = Date.now();
    const hist = this.db.history.get(m.pk) ?? [{ text: m.text, at: m.timestamp }];
    if (this.settings_.history.keepEditHistory) hist.push({ text, at: now });
    else hist.splice(0, hist.length, { text, at: now });
    this.db.history.set(m.pk, hist);
    m.text = text;
    m.editedAt = now;
    m.editCount = (m.editCount ?? 0) + 1;
    this.emit('msg:edited', {
      chatJid: m.chatJid,
      pk: m.pk,
      text,
      editedAt: now,
      editCount: m.editCount,
    });
    refreshChatPreview(this.db, m.chatJid);
    this.emit('chat:update', { chat: clone(this.db.chats.get(m.chatJid)!) });
  }

  applyRevoke(m: Message, byJid: JID, byName: string): void {
    const deleted = { byJid, byName, at: Date.now() };
    m.deleted = deleted;
    const purged = !this.settings_.history.keepDeleted;
    if (purged) {
      m.text = '';
      m.media = undefined;
      m.contentUnknown = true;
    }
    this.emit('msg:deleted', { chatJid: m.chatJid, pk: m.pk, deleted, purged });
    refreshChatPreview(this.db, m.chatJid);
    this.emit('chat:update', { chat: clone(this.db.chats.get(m.chatJid)!) });
  }
}
