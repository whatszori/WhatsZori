import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCirclePlus, Search } from 'lucide-react';
import { backend, type Contact } from '../../api';
import { phoneDigits } from '../../lib/phone';
import { useChats } from '../../stores/chats';
import { useUI } from '../../stores/ui';
import { Avatar, Dialog, Input, Spinner } from '../../ui';
import './NewChat.css';

function matches(c: Contact, q: string, digits: string): boolean {
  if (!q) return true;
  if (c.name.toLowerCase().includes(q)) return true;
  return digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits);
}

// "+" in the sidebar: pick a contact, or type a number to message someone not in the chat list.
export function NewChatDialog() {
  const open = useUI((s) => s.newChatOpen);
  const close = () => useUI.getState().setNewChatOpen(false);
  return (
    <Dialog open={open} title="New chat" onClose={close} width={400}>
      {open && <Picker onDone={close} />}
    </Dialog>
  );
}

function Picker({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // after the dialog has focused itself
    const t = window.setTimeout(() => input.current?.focus(), 0);
    backend.contacts
      .list()
      .then((c) => setContacts(c.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setContacts([]));
    return () => window.clearTimeout(t);
  }, []);

  const q = query.trim().toLowerCase();
  const typed = query.replace(/\D/g, '');
  const number = phoneDigits(query);
  const list = useMemo(
    () => (contacts ?? []).filter((c) => matches(c, q, typed)),
    [contacts, q, typed],
  );
  // the number is already a contact: just show that row
  const known = number && list.some((c) => c.phone.replace(/\D/g, '') === number);

  const openWith = async (jid: string) => {
    await useChats.getState().openWith(jid);
    onDone();
  };

  const byNumber = async () => {
    setBusy(true);
    setError('');
    try {
      const c = await backend.contacts.lookup(query);
      await openWith(c.jid);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wz-newchat">
      <Input
        ref={input}
        icon={<Search size={16} />}
        placeholder="Name or phone number"
        aria-label="Name or phone number"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (number && !known) void byNumber();
          else if (list[0]) void openWith(list[0].jid);
        }}
      />
      {error && (
        <p className="wz-newchat__error" role="alert">
          {error}
        </p>
      )}
      <ul className="wz-newchat__list" aria-label="Contacts">
        {number && !known && (
          <li>
            <button
              type="button"
              className="wz-newchat__row"
              disabled={busy}
              onClick={() => void byNumber()}
            >
              <span className="wz-newchat__icon">
                {busy ? <Spinner size={18} /> : <MessageCirclePlus size={20} />}
              </span>
              <span className="wz-newchat__text">
                <span className="wz-newchat__name">Message +{number}</span>
                <span className="wz-newchat__sub">Checks the number with WhatsApp first</span>
              </span>
            </button>
          </li>
        )}
        {contacts === null && (
          <li className="wz-newchat__note">
            <Spinner size={18} />
          </li>
        )}
        {list.map((c) => (
          <li key={c.jid}>
            <button type="button" className="wz-newchat__row" onClick={() => void openWith(c.jid)}>
              <Avatar name={c.name} jid={c.jid} size={38} />
              <span className="wz-newchat__text">
                <span className="wz-newchat__name">{c.name}</span>
                <span className="wz-newchat__sub">{c.phone}</span>
              </span>
            </button>
          </li>
        ))}
        {contacts !== null && list.length === 0 && !number && (
          <li className="wz-newchat__note">
            {q ? 'No contacts found. Type a number with its country code.' : 'No contacts yet'}
          </li>
        )}
      </ul>
    </div>
  );
}
