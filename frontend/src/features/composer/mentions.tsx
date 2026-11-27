import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { backend, type Chat, type GroupMember, type JID } from '../../api';
import { Avatar } from '../../ui';

// "@" in a group's message box: a list of members to mention. The box shows "@Name"; on send
// the composer swaps each one for "@<number>" and passes the JIDs along, which is how WhatsApp
// marks mentions.

const MAX = 8;

export interface MentionPick {
  member: GroupMember;
  // where the "@" starts and where the typed query ends
  start: number;
  end: number;
}

export function useMentionPicker(chat: Chat, onPick: (p: MentionPick) => void) {
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [at, setAt] = useState<{ start: number; end: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  // members load the first time someone types "@" in this chat (the conversation, and with it
  // this state, is mounted again for every chat)
  useEffect(() => {
    if (!at || members || !chat.isGroup) return;
    let gone = false;
    backend.chats
      .getInfo(chat.jid)
      .then((i) => !gone && setMembers((i.members ?? []).filter((m) => !m.isMe)))
      .catch(() => !gone && setMembers([]));
    return () => {
      gone = true;
    };
  }, [at, members, chat.isGroup, chat.jid]);

  // call with the box's text and caret after every change or caret move
  const update = useCallback(
    (value: string, caret: number | null) => {
      if (!chat.isGroup || caret === null) {
        setAt(null);
        return;
      }
      const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
      if (!m) {
        setAt(null);
        return;
      }
      setAt((cur) => {
        const next = { start: caret - m[2].length - 1, end: caret, query: m[2].toLowerCase() };
        if (cur?.query !== next.query) setActive(0);
        return next;
      });
    },
    [chat.isGroup],
  );

  const list = useMemo(() => {
    if (!at || !members) return [];
    const q = at.query;
    const digits = q.replace(/\D/g, '');
    return members
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          (digits.length > 0 && m.phone.replace(/\D/g, '').includes(digits)),
      )
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)),
      )
      .slice(0, MAX);
  }, [at, members]);

  const open = !!at && list.length > 0;

  const pick = (m: GroupMember) => {
    if (!at) return;
    onPick({ member: m, start: at.start, end: at.end });
    setAt(null);
  };

  // true when the key was the picker's
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + d + list.length) % list.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(list[Math.min(active, list.length - 1)]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setAt(null);
      return true;
    }
    return false;
  };

  const view = open ? (
    <div className="wz-mentions" role="listbox" aria-label="Mention someone">
      {list.map((m, i) => (
        <button
          key={m.jid}
          type="button"
          role="option"
          aria-selected={i === active}
          className="wz-mentions__item"
          // keep the focus in the message box
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(m)}
        >
          <Avatar name={m.name} jid={m.jid} size={28} />
          <span className="wz-mentions__name">{m.name}</span>
          {m.phone && <span className="wz-mentions__phone">{m.phone}</span>}
        </button>
      ))}
    </div>
  ) : null;

  return { update, onKeyDown, view };
}

// the text to send: every "@Name" the user picked becomes "@<number>", longest names first so
// "@Anna" doesn't eat the start of "@Anna Petrova"
export function encodeMentions(
  text: string,
  picked: Record<string, JID>,
): { text: string; jids: JID[] } {
  const used = Object.entries(picked)
    .filter(([label]) => text.includes(label))
    .sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [label, who] of used) out = out.split(label).join('@' + who.split('@')[0]);
  return { text: out, jids: [...new Set(used.map(([, who]) => who))] };
}
