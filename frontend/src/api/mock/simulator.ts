import type { Chat, JID, Message } from '../types';
import { createRng } from '../../lib/rng';
import { INCOMING_DEMO, REACTIONS } from './texts';
import type { MockBackend } from './MockBackend';

// Random live activity for ?demo=1 so anti-delete, edit history and typing can be seen.
export class Simulator {
  private timer: number | undefined;
  private rng = createRng(Date.now());
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
      .filter((c) => !c.archived)
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 8);
  }

  private targetChat(): Chat {
    const focus = this.be.focusChat ? this.be.db.chats.get(this.be.focusChat) : undefined;
    if (focus && this.rng.chance(0.65)) return focus;
    return this.rng.pick(this.activeChats());
  }

  private sender(chat: Chat): { jid: JID; name: string } {
    return this.rng.pick(this.be.db.members.get(chat.jid) ?? [{ jid: chat.jid, name: chat.name }]);
  }

  private recentIncoming(chat: Chat, filter: (m: Message) => boolean): Message | undefined {
    const list = (this.be.db.messages.get(chat.jid) ?? [])
      .slice(-15)
      .filter((m) => !m.fromMe && filter(m));
    return list.length ? this.rng.pick(list) : undefined;
  }

  private tick(): void {
    const r = this.rng.next();
    const chat = this.targetChat();
    if (r < 0.4) this.incoming(chat);
    else if (r < 0.52) this.typingOnly(chat);
    else if (r < 0.68) this.edit(chat);
    else if (r < 0.84) this.revoke(chat);
    else if (r < 0.92) this.reaction(chat);
    else this.presence();
  }

  private incoming(chat: Chat): void {
    const who = this.sender(chat);
    this.be.emit('chat:typing', {
      chatJid: chat.jid,
      senderJid: who.jid,
      senderName: who.name,
      typing: true,
    });
    window.setTimeout(
      () => {
        this.be.emit('chat:typing', {
          chatJid: chat.jid,
          senderJid: who.jid,
          senderName: who.name,
          typing: false,
        });
        const m: Message = {
          pk: String(this.be.db.nextPk++),
          id: `3EB0SIM${this.be.db.nextPk}`,
          chatJid: chat.jid,
          senderJid: who.jid,
          senderName: who.name,
          fromMe: false,
          timestamp: Date.now(),
          kind: 'text',
          text: this.rng.pick(INCOMING_DEMO),
          reactions: [],
        };
        this.be.insert(m);
        this.be.emit('msg:batch', { messages: [structuredClone(m)] });
      },
      this.rng.int(1200, 2400),
    );
  }

  private typingOnly(chat: Chat): void {
    const who = this.sender(chat);
    this.be.emit('chat:typing', {
      chatJid: chat.jid,
      senderJid: who.jid,
      senderName: who.name,
      typing: true,
    });
    window.setTimeout(
      () =>
        this.be.emit('chat:typing', {
          chatJid: chat.jid,
          senderJid: who.jid,
          senderName: who.name,
          typing: false,
        }),
      this.rng.int(2000, 4000),
    );
  }

  private edit(chat: Chat): void {
    const m = this.recentIncoming(chat, (x) => x.kind === 'text' && !x.deleted && !!x.text);
    if (!m) return this.incoming(chat);
    const suffix = this.rng.pick([
      ' (edited: typo)',
      ', sorry',
      ' — actually make it tomorrow',
      '!',
    ]);
    this.be.applyEdit(
      m,
      m.text.replace(/( \(edited: typo\)|, sorry| — actually make it tomorrow|!)$/, '') + suffix,
    );
  }

  private revoke(chat: Chat): void {
    const m = this.recentIncoming(chat, (x) => !x.deleted);
    if (!m) return this.incoming(chat);
    this.be.applyRevoke(m, m.senderJid, m.senderName);
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
