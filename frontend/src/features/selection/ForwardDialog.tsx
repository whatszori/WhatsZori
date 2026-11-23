import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { backend, type JID } from '../../api';
import { pluralize } from '../../lib/format';
import { useChats } from '../../stores/chats';
import { toastError, useToasts } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Avatar, Button, Dialog, Input } from '../../ui';
import './Selection.css';

const MAX = 5;

interface Target {
  jid: JID;
  name: string;
  sub: string;
  group: boolean;
  at: number;
}

// The chat picker for forwarding: recent chats first, then contacts without a chat.
export function ForwardDialog() {
  const pks = useUI((s) => s.forwarding);
  const close = () => useUI.getState().setForwarding(null);
  return (
    <Dialog
      open={!!pks}
      title={pks && pks.length > 1 ? `Forward ${pks.length} messages` : 'Forward message'}
      onClose={close}
      width={420}
    >
      {pks && <Picker pks={pks} onDone={close} />}
    </Dialog>
  );
}

function Picker({ pks, onDone }: { pks: string[]; onDone: () => void }) {
  const chats = useChats((s) => s.chats);
  const [contacts, setContacts] = useState<Target[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<JID[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => input.current?.focus(), 0);
    backend.contacts
      .list()
      .then((cs) =>
        setContacts(
          cs.map((c) => ({ jid: c.jid, name: c.name, sub: c.phone, group: false, at: 0 })),
        ),
      )
      .catch(() => {});
    return () => window.clearTimeout(t);
  }, []);

  const targets = useMemo(() => {
    const fromChats: Target[] = Object.values(chats)
      .filter((c) => !c.archived || picked.includes(c.jid))
      .map((c) => ({
        jid: c.jid,
        name: c.name,
        sub: c.isGroup ? pluralize(c.memberCount ?? 0, 'member') : '',
        group: c.isGroup,
        at: c.lastActivity,
      }))
      .sort((a, b) => b.at - a.at);
    const seen = new Set(fromChats.map((c) => c.jid));
    const all = [
      ...fromChats,
      ...contacts.filter((c) => !seen.has(c.jid)).sort((a, b) => a.name.localeCompare(b.name)),
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((t) => t.name.toLowerCase().includes(q) || t.sub.includes(q)) : all;
  }, [chats, contacts, query, picked]);

  const toggle = (jid: JID) =>
    setPicked((p) =>
      p.includes(jid) ? p.filter((j) => j !== jid) : p.length >= MAX ? p : [...p, jid],
    );

  const send = async () => {
    setBusy(true);
    try {
      const n = await backend.messages.forward(pks, picked);
      useToasts.getState().push({
        kind: 'info',
        text: picked.length === 1 ? 'Forwarded' : `Forwarded to ${picked.length} chats`,
      });
      useUI.getState().clearSelection();
      onDone();
      if (picked.length === 1 && n > 0) void useChats.getState().openWith(picked[0]);
    } catch (err) {
      toastError(err, 'Not forwarded');
    } finally {
      setBusy(false);
    }
  };

  const names = picked.map((j) => targets.find((t) => t.jid === j)?.name ?? chats[j]?.name ?? j);
  return (
    <div className="wz-forward">
      <Input
        ref={input}
        icon={<Search size={16} />}
        placeholder="Search chats and contacts"
        aria-label="Search chats and contacts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul
        className="wz-forward__list"
        aria-label="Chats"
        aria-multiselectable="true"
        role="listbox"
      >
        {targets.map((t) => {
          const on = picked.includes(t.jid);
          const full = !on && picked.length >= MAX;
          return (
            <li key={t.jid} role="option" aria-selected={on}>
              <button
                type="button"
                className={`wz-forward__row${on ? ' wz-forward__row--on' : ''}`}
                disabled={full}
                title={full ? `At most ${MAX} chats at once` : undefined}
                onClick={() => toggle(t.jid)}
              >
                <span className="wz-check" aria-hidden="true">
                  {on && <Check size={14} strokeWidth={3} />}
                </span>
                <Avatar name={t.name} jid={t.jid} size={36} group={t.group} />
                <span className="wz-forward__text">
                  <span className="wz-forward__name">{t.name}</span>
                  {t.sub && <span className="wz-forward__sub">{t.sub}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="wz-forward__footer">
        <span className="wz-forward__names">{names.join(', ') || `Up to ${MAX} chats`}</span>
        <Button variant="primary" disabled={!picked.length || busy} onClick={() => void send()}>
          Forward
        </Button>
      </footer>
    </div>
  );
}
