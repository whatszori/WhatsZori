import type { Backend } from '../backend';
import type {
  AppSettings,
  AuthStatus,
  BackendEventName,
  BackendEvents,
  Chat,
  ConnState,
  EditVersion,
  GhostSettings,
  JID,
  Message,
  MessagePK,
  MessagePage,
  Reaction,
  SearchHit,
} from '../types';
import { createMockDB, preview, refreshChatPreview, type MockDB } from './data';
import { DEFAULT_GHOST, DEFAULT_SETTINGS } from '../defaults';
import { Emitter } from './emitter';
import { Simulator } from './simulator';

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

function readStore(): Partial<{ loggedIn: boolean; settings: AppSettings; ghost: GhostSettings }> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export class MockBackend implements Backend {
  readonly db: MockDB;
  private emitter = new Emitter();
  private auth_: AuthStatus = { state: 'logged-out', me: null };
  private settings_: AppSettings;
  private ghost_: GhostSettings;
  private byPk = new Map<MessagePK, Message>();
  private qrTimer: number | undefined;
  private loginTimer: number | undefined;
  private simulator: Simulator;
  // chat the user last opened, the simulator prefers it so events are visible
  focusChat: JID | null = null;

  constructor(private opts: MockOptions = {}) {
    this.db = createMockDB(opts.now);
    for (const list of this.db.messages.values()) for (const m of list) this.byPk.set(m.pk, m);
    const stored = opts.persist ? readStore() : {};
    this.settings_ = { ...clone(DEFAULT_SETTINGS), ...stored.settings };
    this.ghost_ = { ...DEFAULT_GHOST, ...stored.ghost };
    if (stored.loggedIn) {
      this.auth_ = { state: 'logged-in', me: this.db.me };
      window.setTimeout(() => this.setConn('connected'), 700);
    }
    this.simulator = new Simulator(this);
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
    logout: async (): Promise<void> => {
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
    search: async (query: string): Promise<SearchHit[]> => {
      await this.wait();
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits: SearchHit[] = [];
      for (const [jid, list] of this.db.messages) {
        const chat = this.db.chats.get(jid)!;
        for (const m of list) {
          if (m.text.toLowerCase().includes(q))
            hits.push({ chatJid: jid, chatName: chat.name, message: m });
        }
      }
      hits.sort((a, b) => b.message.timestamp - a.message.timestamp);
      return clone(hits.slice(0, 50));
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
