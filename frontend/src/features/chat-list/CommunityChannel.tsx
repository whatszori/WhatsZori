import { useEffect, useState } from 'react';
import { Check, Link2, Megaphone, Plus, Users } from 'lucide-react';
import { backend, type Chat, type CommunityGroup } from '../../api';
import { useUI } from '../../stores/ui';
import { toastError } from '../../stores/toasts';
import { Avatar, Button, Dialog, Input, Spinner } from '../../ui';
import './CommunityChannel.css';

// The communities view's headings and the channels view's "follow" row, with their dialogs.

export function CommunityHeading({ chat }: { chat: Chat }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wz-community">
      <Avatar name={chat.name} jid={chat.jid} size={28} group />
      <span className="wz-community__name">{chat.name}</span>
      <button type="button" className="wz-community__all" onClick={() => setOpen(true)}>
        All groups
      </button>
      {open && <CommunityGroupsDialog community={chat} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CommunityGroupsDialog({ community, onClose }: { community: Chat; onClose: () => void }) {
  const [groups, setGroups] = useState<CommunityGroup[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    backend.chats
      .communityGroups(community.jid)
      .then(setGroups)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [community.jid]);
  return (
    <Dialog open title={community.name} onClose={onClose} width={400}>
      {error && <p className="wz-community__error">{error}</p>}
      {!groups && !error && (
        <div className="wz-community__loading">
          <Spinner size={18} />
        </div>
      )}
      {groups && (
        <ul className="wz-community__groups">
          {groups.map((g) => (
            <li key={g.jid}>
              <button
                type="button"
                className="wz-community__group"
                disabled={!g.joined}
                onClick={() => {
                  useUI.getState().openChat(g.jid);
                  onClose();
                }}
              >
                <span className="wz-community__icon">
                  {g.isAnnounce ? <Megaphone size={16} /> : <Users size={16} />}
                </span>
                <span className="wz-community__group-name">{g.name}</span>
                {g.joined ? (
                  <Check size={14} className="wz-community__joined" aria-label="Joined" />
                ) : (
                  <span className="wz-community__hint">Not joined</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {groups?.some((g) => !g.joined) && (
        <p className="wz-community__note">
          To join one of the other groups, ask in the community or join it on your phone.
        </p>
      )}
    </Dialog>
  );
}

export function FollowChannelRow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="wz-follow-row" onClick={() => setOpen(true)}>
        <span className="wz-follow-row__icon">
          <Plus size={18} />
        </span>
        Follow a channel by link
      </button>
      {open && <FollowChannelDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function FollowChannelDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const follow = async () => {
    setBusy(true);
    try {
      const chat = await backend.chats.followChannel(link);
      useUI.getState().openChat(chat.jid);
      onClose();
    } catch (err) {
      toastError(err, 'Couldn’t follow');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="Follow a channel"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!link.trim() || busy} onClick={() => void follow()}>
            Follow
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        icon={<Link2 size={16} />}
        placeholder="https://whatsapp.com/channel/…"
        aria-label="Channel link"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && link.trim() && void follow()}
      />
      <p className="wz-community__note">
        Channels share their link in their info. Following one shows its posts here; your name and
        number aren’t shown to the channel.
      </p>
    </Dialog>
  );
}
