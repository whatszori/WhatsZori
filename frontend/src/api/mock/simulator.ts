import type { Chat, JID, Message, MessagePK } from '../types';
import { createRng } from '../../lib/rng';
import { INCOMING, REACTIONS, REGRETS, TYPO_FIXES } from './texts';
import type { MockBackend } from './MockBackend';

type Lang = 'en' | 'ru' | 'ja';

// Random live activity for ?demo=1 so anti-delete, edit history and typing can be seen.
// What people "do" follows how people behave: typos get fixed a few seconds later, and the
// message somebody takes back is the one they regret sending, usually right away.
export class Simulator {
  private timer: number | undefined;
  private rng = createRng(Date.now());
  // messages sent with a typo, waiting for their fix
  private pendingFix = new Map<MessagePK, string>();
  running = false;

  constructor(private be: MockBackend) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    window.clearTimeout(this.timer);
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = window.setTimeout(
      () => {
        this.tick();
        this.schedule();
      },
      this.rng.int(3000, 6000),
    );
  }

  private activeChats(): Chat[] {
    return [...this.be.db.chats.values()]
      .filter((c) => !c.archived && !c.muted)
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 8);
  }

  private targetChat(): Chat | undefined {
    const focus = this.be.focusChat ? this.be.db.chats.get(this.be.focusChat) : undefined;
    if (focus && this.rng.chance(0.65)) return focus;
    return this.rng.pick(this.activeChats());
  }

  private sender(chat: Chat): { jid: JID; name: string } {
    return this.rng.pick(this.be.db.members.get(chat.jid) ?? [{ jid: chat.jid, name: chat.name }]);
  }

  private lang(chat: Chat): Lang {
    const names = [chat.name, ...(this.be.db.members.get(chat.jid) ?? []).map((m) => m.name)];
    const share = (re: RegExp) => names.filter((n) => re.test(n)).length / names.length;
    if (share(/\p{Script=Cyrillic}/u) >= 0.5) return 'ru';
    if (share(/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u) >= 0.5) return 'ja';
    return 'en';
  }

  private tick(): void {
    const r = this.rng.next();
    const chat = this.targetChat();
    if (!chat) return;
    if (r < 0.4) this.incoming(chat);
    else if (r < 0.52) this.typingOnly(chat);
    else if (r < 0.68) this.edit(chat);
    else if (r < 0.84) this.revoke(chat);
    else if (r < 0.92) this.reaction(chat);
    else this.presence();
  }

  private typing(chat: Chat, who: { jid: JID; name: string }, typing: boolean): void {
    this.be.emit('chat:typing', {
      chatJid: chat.jid,
      senderJid: who.jid,
      senderName: who.name,
      typing,
    });
  }

  // types for a moment, then sends and hands the message to `then`
  private send(
    chat: Chat,
    text: string,
    who = this.sender(chat),
    then?: (m: Message) => void,
  ): void {
    this.typing(chat, who, true);
    window.setTimeout(
      () => {
        this.typing(chat, who, false);
        const m: Message = {
          pk: String(this.be.db.nextPk++),
          id: `3EB0SIM${this.be.db.nextPk}`,
          chatJid: chat.jid,
          senderJid: who.jid,
          senderName: who.name,
          fromMe: false,
          timestamp: Date.now(),
          kind: 'text',
          text,
          reactions: [],
        };
        this.be.insert(m);
        this.be.emit('msg:batch', { messages: [structuredClone(m)] });
        then?.(m);
      },
      this.rng.int(1200, 2400),
    );
  }

  private incoming(chat: Chat): void {
    const pool = INCOMING[this.lang(chat)];
    this.send(chat, this.rng.pick(chat.isGroup ? pool.group : pool.direct));
  }

  private typingOnly(chat: Chat): void {
    const who = this.sender(chat);
    this.typing(chat, who, true);
    window.setTimeout(() => this.typing(chat, who, false), this.rng.int(2000, 4000));
  }

  // fixes a typo sent earlier, or sends one to fix next time
  private edit(chat: Chat): void {
    const waiting = (this.be.db.messages.get(chat.jid) ?? []).find(
      (m) => this.pendingFix.has(m.pk) && !m.deleted,
    );
    if (waiting) {
      this.be.applyEdit(waiting, this.pendingFix.get(waiting.pk)!);
      this.pendingFix.delete(waiting.pk);
      return;
    }
    const [wrong, right] = this.rng.pick(TYPO_FIXES[this.lang(chat)]);
    this.send(chat, wrong, undefined, (m) => this.pendingFix.set(m.pk, right));
  }

  // sends something they shouldn't have, takes it back, then explains
  private revoke(chat: Chat): void {
    const [regret, after] = this.rng.pick(REGRETS[this.lang(chat)]);
    const who = this.sender(chat);
    this.send(chat, regret, who, (m) =>
      window.setTimeout(
        () => {
          this.be.applyRevoke(m, m.senderJid, m.senderName);
          window.setTimeout(() => this.send(chat, after, who), this.rng.int(600, 1500));
        },
        this.rng.int(2500, 5000),
      ),
    );
  }

  private reaction(chat: Chat): void {
    const list = (this.be.db.messages.get(chat.jid) ?? []).slice(-10).filter((m) => !m.deleted);
    if (!list.length) return;
    const m = this.rng.pick(list);
    const emoji = this.rng.pick(REACTIONS);
    const ex = m.reactions.find((x) => x.emoji === emoji);
    m.reactions = ex
      ? m.reactions.map((x) => (x === ex ? { ...x, count: x.count + 1 } : x))
      : [...m.reactions, { emoji, count: 1, mine: false }];
    this.be.emit('msg:reaction', {
      chatJid: chat.jid,
      pk: m.pk,
      reactions: structuredClone(m.reactions),
    });
  }

  private presence(): void {
    const direct = this.activeChats().filter((c) => !c.isGroup);
    if (!direct.length) return;
    const c = this.rng.pick(direct);
    c.online = !c.online;
    if (!c.online) c.lastSeen = Date.now();
    this.be.emit('presence', { jid: c.jid, online: !!c.online, lastSeen: c.lastSeen ?? null });
  }
}
