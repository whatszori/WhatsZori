import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type { JID } from '../../api';
import { useChats } from '../../stores/chats';
import { Button, Dialog, Input, Toggle } from '../../ui';
import './ListsDialog.css';

// Which of your lists a chat is in. Lists are WhatsZori's own and don't sync to the phone.
export function ListsDialog({ jid, onClose }: { jid: JID; onClose: () => void }) {
  const chat = useChats((s) => s.chats[jid]);
  const lists = useChats((s) => s.lists);
  const [name, setName] = useState('');
  const { setInList, createList } = useChats.getState();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const l = await createList(name);
    if (l) {
      setName('');
      await setInList(l.id, jid, true);
    }
  };

  return (
    <Dialog
      open
      title={`Lists for ${chat?.name ?? 'this chat'}`}
      onClose={onClose}
      width={380}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {lists.length === 0 && (
        <p className="wz-dialog-text">
          No lists yet. Make one below; it shows up next to All and Unread.
        </p>
      )}
      <div className="wz-lists">
        {lists.map((l) => (
          <Toggle
            key={l.id}
            label={l.name}
            checked={!!chat?.lists?.includes(l.id)}
            onChange={(on) => void setInList(l.id, jid, on)}
          />
        ))}
      </div>
      <form className="wz-lists__new" onSubmit={create}>
        <Input
          aria-label="New list name"
          placeholder="New list"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" icon={<Plus size={16} />} disabled={!name.trim()}>
          Add
        </Button>
      </form>
      <p className="wz-lists__note">Lists and favorites are kept in WhatsZori only.</p>
    </Dialog>
  );
}
