import { useEffect, useState } from 'react';
import { backend, type Chat } from '../../api';
import { toastError } from '../../stores/toasts';
import { Button } from '../../ui';
import '../chat-list/CommunityChannel.css';

// A channel can't be written to: this takes the composer's place. Opening one fetches its newest
// posts (and live updates while it's open).
export function ChannelBar({ chat }: { chat: Chat }) {
  const [busy, setBusy] = useState(false);
  const following = !!chat.channel?.role;
  useEffect(() => {
    // new posts arrive as msg:batch, like any message
    void backend.chats.refreshChannel(chat.jid, false).catch(() => {});
  }, [chat.jid]);
  const toggle = async () => {
    setBusy(true);
    try {
      if (following) await backend.chats.unfollowChannel(chat.jid);
      else await backend.chats.followChannel(chat.jid);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wz-channel-bar">
      <span>{following ? 'You follow this channel' : 'You don’t follow this channel'}</span>
      <Button
        size="sm"
        variant={following ? 'ghost' : 'primary'}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {following ? 'Unfollow' : 'Follow'}
      </Button>
    </div>
  );
}
