import type { Backend } from '../backend';
import type {
  Attachment,
  MessageReceipts,
  MarketEntry,
  PluginFetchRequest,
  PluginFetchResponse,
  Sticker,
  UserThemePackage,
  PluginInfo,
  StatusGroup,
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
  LocationDraft,
  EventDraft,
  CommunityGroup,
  ScheduledMessage,
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
  // the browser preview keeps attachments as blobs; sent photos stay viewable for the session
  private uploads = new Map<string, { item: Attachment; blob: Blob; url: string }>();
  private sentUrls = new Map<MessagePK, string>();

  constructor(private opts: MockOptions = {}) {
    this.db = createMockDB(opts.now);
    for (const list of this.db.messages.values()) for (const m of list) this.byPk.set(m.pk, m);
    const stored = opts.persist ? readStore() : {};
    this.settings_ = withDefaults(stored.settings);
    this.ghost_ = { ...DEFAULT_GHOST, ...stored.ghost };
    this.profile_ = {
      name: 'Alex Brandt',
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
    // a timer left from a QR started again after the click must not log in a second time
    if (this.auth_.state !== 'qr' && this.auth_.state !== 'pairing') return;
    this.setAuth({ state: 'logging-in', me: null });
    this.setConn('connecting');
    window.setTimeout(() => {
      this.setAuth({ state: 'logged-in', me: this.db.me });
      this.setConn('connected');
    }, 1200);
  }

  readonly dev: DevControls = {
    simulateScan: () => {
      this.completeLogin();
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
      // already logging in (the code was clicked while this call waited): nothing to start
      if (this.auth_.state === 'logging-in' || this.auth_.state === 'logged-in') return;
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
    communityGroups: async (jid: JID): Promise<CommunityGroup[]> => {
      await this.wait();
      const mine = [...this.db.chats.values()]
        .filter((c) => c.community?.jid === jid)
        .map((c) => ({ jid: c.jid, name: c.name, isAnnounce: !!c.isAnnounce, joined: true }));
      return [
        ...mine,
        { jid: 'mock-garden@g.us', name: 'Garden club', isAnnounce: false, joined: false },
      ];
    },
    syncChannels: async (): Promise<void> => undefined,
    refreshChannel: async (): Promise<boolean> => false,
    followChannel: async (link: string): Promise<Chat> => {
      await this.wait();
      if (!/whatsapp\.com\/channel\/\w+|@newsletter$/.test(link))
        throw new Error('that isn’t a WhatsApp channel link (whatsapp.com/channel/…)');
      const jid = link.endsWith('@newsletter') ? link : '120363999999999999@newsletter';
      const chat: Chat = this.db.chats.get(jid) ?? {
        jid,
        name: 'Daily Space Photos',
        isGroup: false,
        pinned: false,
        archived: false,
        muted: false,
        unread: 0,
        lastMessage: null,
        lastActivity: Date.now(),
        channel: { followers: 48_200, verified: false, role: 'subscriber' },
      };
      chat.channel = { ...chat.channel!, role: 'subscriber' };
      this.db.chats.set(jid, chat);
      if (!this.db.messages.has(jid)) this.db.messages.set(jid, []);
      this.emit('chat:update', { chat: clone(chat) });
      return clone(chat);
    },
    unfollowChannel: async (jid: JID): Promise<void> => {
      await this.wait();
      const chat = this.db.chats.get(jid);
      if (!chat?.channel) return;
      chat.channel = { ...chat.channel, role: '' };
      this.emit('chat:update', { chat: clone(chat) });
    },
    setDisappearing: async (jid: JID, seconds: number): Promise<void> => {
      await this.wait();
      const chat = this.db.chats.get(jid);
      if (!chat) return;
      chat.disappearing = seconds || undefined;
      this.emit('chat:update', { chat: clone(chat) });
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

  private sched: ScheduledMessage[] = [];
  private schedTimer = 0;

  private async sendScheduled(s: ScheduledMessage): Promise<void> {
    this.sched = this.sched.filter((x) => x.id !== s.id);
    const m = await this.messages.sendText(s.chatJid, s.text, s.replyToPk);
    this.emit('msg:batch', { messages: [m] });
    this.emit('scheduled:changed', { chatJid: s.chatJid });
  }

  private watchScheduled(): void {
    if (this.schedTimer) return;
    this.schedTimer = window.setInterval(() => {
      for (const s of this.sched.filter((x) => x.sendAt <= Date.now())) void this.sendScheduled(s);
      if (this.sched.length === 0) {
        window.clearInterval(this.schedTimer);
        this.schedTimer = 0;
      }
    }, 2000);
  }

  // one of our own messages, sent like text is
  private async own(jid: JID, extra: Partial<Message>): Promise<Message> {
    await this.wait();
    const m: Message = {
      pk: String(this.db.nextPk++),
      id: `3EB0OUT${this.db.nextPk}`,
      chatJid: jid,
      senderJid: this.db.me.jid,
      senderName: this.db.me.name,
      fromMe: true,
      timestamp: Date.now(),
      kind: 'text',
      text: '',
      status: 'pending',
      reactions: [],
      ...extra,
    };
    this.insert(m);
    this.progressStatus(m);
    return clone(m);
  }

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

  // mock media are placeholders, except photos sent in this session
  media = {
    url: (pk: MessagePK): string => this.sentUrls.get(pk) ?? '',
    avatarUrl: (): string => '',
    saveAs: async (): Promise<string | null> => {
      throw new Error('Saving files works in the desktop app');
    },
    saveAvatar: async (): Promise<string | null> => {
      throw new Error('Saving works in the desktop app');
    },
    copyAvatar: async (): Promise<void> => {
      throw new Error('Copying works in the desktop app');
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
    // made up from the message's status: everyone read it, or some got it, or nobody yet
    receipts: async (pk: MessagePK): Promise<MessageReceipts> => {
      await this.wait();
      const m = this.byPk.get(pk);
      if (!m) throw new Error('no such message');
      const chat = this.db.chats.get(m.chatJid);
      const others = chat?.isGroup
        ? (this.db.members.get(m.chatJid) ?? [])
        : [{ jid: m.chatJid, name: chat?.name ?? m.chatJid }];
      return {
        people: others.map((p, i) => {
          const delivered =
            m.status === 'read' || m.status === 'delivered' ? m.timestamp + 2_000 + i * 900 : 0;
          const read =
            m.status === 'read' || (m.status === 'delivered' && i % 3 === 0 && chat?.isGroup)
              ? m.timestamp + 60_000 + i * 45_000
              : 0;
          return { jid: p.jid, name: p.name, deliveredAt: delivered, readAt: read, playedAt: 0 };
        }),
      };
    },
    getEditHistory: async (pk: MessagePK): Promise<EditVersion[]> => {
      await this.wait();
      return clone(this.db.history.get(pk) ?? []);
    },
    sendText: async (
      jid: JID,
      text: string,
      replyToPk?: MessagePK,
      mentions?: JID[],
    ): Promise<Message> => {
      await this.wait();
      const target = replyToPk ? this.byPk.get(replyToPk) : undefined;
      const members = this.db.members.get(jid) ?? [];
      const mentioned = (mentions ?? [])
        .map((j) => ({
          jid: j,
          token: j.split('@')[0],
          name: members.find((p) => p.jid === j)?.name ?? '',
        }))
        .filter((x) => text.includes('@' + x.token));
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
        disappearing: this.db.chats.get(jid)?.disappearing ? true : undefined,
        reactions: [],
        mentions: mentioned.length ? mentioned : undefined,
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
    sendContacts: async (jid: JID, contacts: JID[]): Promise<Message> =>
      this.own(jid, {
        kind: 'contact',
        contacts: contacts.map((c) => {
          const n = c.split('@')[0];
          return {
            name: this.db.chats.get(c)?.name ?? '+' + n,
            phones: [{ number: '+' + n, label: 'cell', waid: n, jid: c }],
            emails: [],
          };
        }),
      }),
    sendLocation: async (jid: JID, p: LocationDraft): Promise<Message> =>
      this.own(jid, {
        kind: 'location',
        location: {
          lat: p.lat,
          lon: p.lon,
          name: p.name || undefined,
          address: p.address || undefined,
          live: false,
        },
      }),
    sendPoll: async (
      jid: JID,
      question: string,
      options: string[],
      multiple: boolean,
    ): Promise<Message> =>
      this.own(jid, {
        kind: 'poll',
        text: question,
        poll: {
          name: question,
          selectable: multiple ? 0 : 1,
          totalVoters: 0,
          options: options.map((name) => ({ name, votes: 0, mine: false, voters: [] })),
        },
      }),
    schedule: async (
      jid: JID,
      text: string,
      sendAt: number,
      replyToPk?: MessagePK,
    ): Promise<ScheduledMessage> => {
      await this.wait();
      if (sendAt <= Date.now()) throw new Error('pick a time in the future');
      const s: ScheduledMessage = {
        id: String(this.db.nextPk++),
        chatJid: jid,
        text,
        sendAt,
        replyToPk,
      };
      this.sched.push(s);
      this.sched.sort((a, b) => a.sendAt - b.sendAt);
      this.emit('scheduled:changed', { chatJid: jid });
      this.watchScheduled();
      return { ...s };
    },
    scheduled: async (jid: JID): Promise<ScheduledMessage[]> =>
      this.sched.filter((s) => !jid || s.chatJid === jid).map((s) => ({ ...s })),
    reschedule: async (id: string, text: string, sendAt: number): Promise<void> => {
      const s = this.sched.find((x) => x.id === id);
      if (!s) throw new Error('that scheduled message is gone');
      Object.assign(s, { text, sendAt, error: undefined });
      this.sched.sort((a, b) => a.sendAt - b.sendAt);
      this.emit('scheduled:changed', { chatJid: s.chatJid });
    },
    unschedule: async (id: string): Promise<void> => {
      const s = this.sched.find((x) => x.id === id);
      this.sched = this.sched.filter((x) => x.id !== id);
      if (s) this.emit('scheduled:changed', { chatJid: s.chatJid });
    },
    sendScheduledNow: async (id: string): Promise<void> => {
      const s = this.sched.find((x) => x.id === id);
      if (!s) throw new Error('that scheduled message is gone');
      await this.sendScheduled(s);
    },
    sendEvent: async (jid: JID, e: EventDraft): Promise<Message> =>
      this.own(jid, {
        kind: 'event',
        event: {
          name: e.name,
          description: e.description || undefined,
          start: e.start,
          end: e.end || undefined,
          place: e.place || undefined,
          joinLink: e.joinLink || undefined,
          canceled: false,
          call: false,
        },
      }),
    answer: async (pk: MessagePK, id: string): Promise<Message> => {
      const m = this.byPk.get(pk);
      const b = m?.business;
      if (!m || !b) throw new Error('Not a business message');
      const text =
        b.buttons.find((x) => x.kind === 'reply' && x.id === id)?.text ??
        b.list?.sections.flatMap((s) => s.rows).find((r) => r.id === id)?.title;
      if (!text) throw new Error("That button isn't in this message");
      return this.messages.sendText(m.chatJid, text, pk);
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
    played: async (): Promise<void> => undefined,
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
    // a hidden <input type=file>: the browser's own picker
    pickAttachments: (): Promise<Attachment[]> =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('cancel', () => resolve([]));
        input.addEventListener('change', () => {
          const files = [...(input.files ?? [])];
          void Promise.all(files.map((f) => this.messages.uploadAttachment(f, f.name))).then(
            resolve,
            () => resolve([]),
          );
        });
        input.click();
      }),
    uploadAttachment: async (file: Blob, name: string): Promise<Attachment> => {
      if (file.size === 0) throw new Error('the file is empty');
      if (file.size > 100 << 20) throw new Error('files can be at most 100 MB');
      const mime = file.type || 'application/octet-stream';
      const kind: Attachment['kind'] = /^image\/(jpeg|png|webp|gif|bmp)$/.test(mime)
        ? 'image'
        : mime.startsWith('video/')
          ? 'video'
          : 'file';
      const token = `mock${Math.random().toString(36).slice(2)}`;
      const item: Attachment = { token, name: name || 'file', size: file.size, mime, kind };
      this.uploads.set(token, { item, blob: file, url: URL.createObjectURL(file) });
      return { ...item };
    },
    attachmentUrl: (token: string): string => this.uploads.get(token)?.url ?? '',
    sendAttachment: async (
      jid: JID,
      token: string,
      caption: string,
      asFile: boolean,
    ): Promise<Message> => {
      await this.wait();
      const up = this.uploads.get(token);
      if (!up) throw new Error('this attachment is gone, add it again');
      const photo = !asFile && (up.item.mime === 'image/jpeg' || up.item.mime === 'image/png');
      let width: number | undefined;
      let height: number | undefined;
      if (photo) {
        const bmp = await createImageBitmap(up.blob).catch(() => null);
        width = bmp?.width;
        height = bmp?.height;
        bmp?.close();
      }
      const m: Message = {
        pk: String(this.db.nextPk++),
        id: `3EB0FILE${this.db.nextPk}`,
        chatJid: jid,
        senderJid: this.db.me.jid,
        senderName: this.db.me.name,
        fromMe: true,
        timestamp: Date.now(),
        kind: photo ? 'image' : 'document',
        text: caption.trim(),
        status: 'pending',
        reactions: [],
        media: photo
          ? { width, height, size: up.item.size, mime: up.item.mime }
          : { fileName: up.item.name, size: up.item.size, mime: up.item.mime },
      };
      this.uploads.delete(token);
      if (photo) this.sentUrls.set(m.pk, up.url);
      else URL.revokeObjectURL(up.url);
      this.insert(m);
      this.progressStatus(m);
      return clone(m);
    },
    dropAttachment: async (token: string): Promise<void> => {
      const up = this.uploads.get(token);
      if (up) URL.revokeObjectURL(up.url);
      this.uploads.delete(token);
    },
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
      query?: string,
    ): Promise<MessagePage> => {
      await this.wait();
      const match = (m: Message) =>
        kind === 'media'
          ? (m.kind === 'image' || m.kind === 'video') && !!m.media && !m.media.round
          : kind === 'docs'
            ? m.kind === 'document'
            : kind === 'audio'
              ? m.kind === 'voice'
              : /https?:\/\/|www\./.test(m.text);
      const q = (query ?? '').trim().toLowerCase();
      const hit = (m: Message) =>
        !q || m.text.toLowerCase().includes(q) || !!m.media?.fileName?.toLowerCase().includes(q);
      const all = (this.db.messages.get(jid) ?? [])
        .filter((m) => match(m) && hit(m) && !m.contentUnknown)
        .reverse();
      const start = beforePk ? all.findIndex((m) => m.pk === beforePk) + 1 : 0;
      const page = all.slice(start, start + limit);
      return { messages: clone(page), hasMore: start + limit < all.length };
    },
  };

  // a few statuses so the screen has something in the browser preview
  private statusSeen = new Set<MessagePK>();
  private statuses_: StatusGroup[] | null = null;
  private statusGroups(): StatusGroup[] {
    if (!this.statuses_) {
      const now = Date.now();
      const people = [...this.db.chats.values()].filter((c) => !c.isGroup).slice(0, 4);
      const texts = [
        'Monday again в•',
        'Sunset from the roof',
        'New job, new city!',
        'Gym streak: 30 days',
      ];
      const colors = ['#1e88e5', '#8e24aa', '#43a047', '#f4511e'];
      let pk = 900000;
      this.statuses_ = people.map((c, i) => ({
        jid: c.jid,
        name: c.name,
        mine: false,
        unseen: 0,
        lastTs: now - i * 47 * 60_000,
        items: Array.from({ length: (i % 2) + 1 }, (_, j) => ({
          seen: false,
          background: colors[(i + j) % colors.length],
          message: {
            pk: String(pk++),
            id: 'STATUS' + pk,
            chatJid: 'status@broadcast',
            senderJid: c.jid,
            senderName: c.name,
            fromMe: false,
            timestamp: now - i * 47 * 60_000 - (1 - j) * 9 * 60_000,
            kind: 'text' as const,
            text: texts[(i + j) % texts.length],
            reactions: [],
            deleted:
              i === 2 && j === 0
                ? { byJid: c.jid, byName: c.name, at: now - 30 * 60_000 }
                : undefined,
          },
        })),
      }));
    }
    return this.statuses_.map((g) => {
      const items = g.items.map((it) => ({ ...it, seen: this.statusSeen.has(it.message.pk) }));
      return { ...g, items, unseen: items.filter((it) => !it.seen).length };
    });
  }

  // stickers made in the preview live as object URLs until reload
  private stickers_: Sticker[] = [];
  stickers = {
    mine: async (): Promise<Sticker[]> => clone(this.stickers_),
    recent: async (): Promise<Sticker[]> => [],
    add: async (picture: Blob): Promise<Sticker> => {
      const s = { id: `mock-${this.stickers_.length + 1}.webp`, url: URL.createObjectURL(picture) };
      this.stickers_.unshift(s);
      return clone(s);
    },
    remove: async (id: string): Promise<void> => {
      this.stickers_ = this.stickers_.filter((s) => s.id !== id);
    },
    send: async (jid: JID): Promise<Message> => {
      await this.wait();
      const m: Message = {
        pk: String(this.db.nextPk++),
        id: `3EB0STK${this.db.nextPk}`,
        chatJid: jid,
        senderJid: this.db.me.jid,
        senderName: this.db.me.name,
        fromMe: true,
        timestamp: Date.now(),
        kind: 'sticker',
        text: '',
        status: 'pending',
        reactions: [],
        media: { width: 512, height: 512, mime: 'image/webp', size: 20_000 },
      };
      this.insert(m);
      this.progressStatus(m);
      return clone(m);
    },
  };

  // the browser preview has no plugin folder; its demo plugins register directly
  private pluginKV = new Map<string, string>();
  plugins = {
    list: async (): Promise<PluginInfo[]> => [],
    setEnabled: async (): Promise<void> => {
      throw new Error('Plugins load from the config folder in the desktop app');
    },
    isSafeMode: async (): Promise<boolean> => false,
    url: () => '',
    settings: async (id: string): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (const [k, v] of this.pluginKV) if (k.startsWith(`s:${id}:`)) out[k.split(':')[2]] = v;
      return out;
    },
    setSetting: async (id: string, key: string, value: string) => {
      this.pluginKV.set(`s:${id}:${key}`, value);
    },
    deleteSetting: async (id: string, key: string) => {
      this.pluginKV.delete(`s:${id}:${key}`);
    },
    storageGet: async (id: string, key: string): Promise<string | null> =>
      this.pluginKV.get(`k:${id}:${key}`) ?? null,
    storageSet: async (id: string, key: string, value: string) => {
      this.pluginKV.set(`k:${id}:${key}`, value);
    },
    storageDelete: async (id: string, key: string) => {
      this.pluginKV.delete(`k:${id}:${key}`);
    },
    storageKeys: async (id: string): Promise<string[]> =>
      [...this.pluginKV.keys()].filter((k) => k.startsWith(`k:${id}:`)).map((k) => k.split(':')[2]),
    permissionInfo: async (): Promise<Record<string, string>> => ({}),
    approve: async (): Promise<void> => undefined,
    revoke: async (): Promise<void> => undefined,
    // the browser preview has no proxy; the request goes straight out (and CORS applies)
    fetch: async (_id: string, req: PluginFetchRequest): Promise<PluginFetchResponse> => {
      const body = req.body ? Uint8Array.from(atob(req.body), (c) => c.charCodeAt(0)) : undefined;
      const res = await fetch(req.url, { method: req.method || 'GET', headers: req.headers, body });
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return {
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers),
        body: btoa(bin),
        url: res.url,
      };
    },
    notify: async (_id: string, title: string, body: string): Promise<void> => {
      this.emit('toast', { kind: 'info', text: `${title}: ${body}` });
    },
    saveFile: async (): Promise<string | null> => {
      throw new Error('Saving files works in the desktop app');
    },
  };

  // the browser preview shows a fixed marketplace; installing needs the desktop app
  marketplace = {
    list: async (): Promise<MarketEntry[]> => {
      await this.wait();
      const item = (
        p: Partial<MarketEntry['item']> & { id: string; name: string },
      ): MarketEntry['item'] => ({
        kind: 'plugin',
        version: '1.0.0',
        description: '',
        author: 'WhatsZori',
        tags: [],
        screenshots: [],
        permissions: [],
        network: [],
        dir: '',
        files: [],
        ...p,
      });
      return [
        {
          item: item({
            id: 'chat-insights',
            name: 'Chat Insights',
            version: '2.0.0',
            description:
              'Stats for any chat: who writes most, when, top words and emoji. Bookmarks, highlighted words and a grayscale tool for the photo editor.',
            tags: ['stats', 'bookmarks'],
            apiVersion: 2,
            permissions: ['messages', 'notifications', 'clipboard'],
            key: '9f0a eff5 cfc2 9b5c',
          }),
          installed: '',
          update: false,
          publisher: 'WhatsZori',
        },
        {
          item: item({
            id: 'weather',
            name: 'Weather',
            description:
              'The weather for your city in a panel, and a command that puts it into the message box. Runs sandboxed.',
            tags: ['weather'],
            apiVersion: 2,
            sandbox: true,
            permissions: ['network', 'composer'],
            network: ['api.open-meteo.com', 'geocoding-api.open-meteo.com'],
            key: '9f0a eff5 cfc2 9b5c',
          }),
          installed: '',
          update: false,
          publisher: 'WhatsZori',
        },
        {
          item: item({
            kind: 'theme',
            id: 'ocean',
            name: 'Ocean',
            description: 'Deep blue accent with a wave pattern behind messages.',
            tags: ['blue'],
          }),
          installed: '',
          update: false,
          publisher: '',
        },
      ];
    },
    install: async (): Promise<void> => {
      throw new Error('Installing works in the desktop app');
    },
    uninstall: async (): Promise<void> => undefined,
  };

  status = {
    list: async (): Promise<StatusGroup[]> => {
      await this.wait();
      return clone(this.statusGroups());
    },
    view: async (pk: MessagePK, ghost: boolean): Promise<boolean> => {
      await this.wait();
      this.statusSeen.add(pk);
      return !ghost && !this.ghost_.statusGhost;
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
    packages: async (): Promise<UserThemePackage[]> => [],
    pickWallpaper: async (): Promise<string | null> => {
      throw new Error('Your own wallpaper works in the desktop app');
    },
    wallpaperUrl: (rel: string) => '/wz-themes/' + rel.split('/').map(encodeURIComponent).join('/'),
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
