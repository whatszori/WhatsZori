import type { ReactNode } from 'react';
import { Archive, CircleDashed, History, MessageSquareText, Phone, Settings } from 'lucide-react';
import { useChats } from '../../stores/chats';
import { useConnection } from '../../stores/connection';
import { useProfile } from '../../stores/profile';
import { useUI, type RailPanel } from '../../stores/ui';
import { Avatar, Tooltip } from '../../ui';
import { RailViewButtons } from '../../plugin-core/host';
import './NavRail.css';

type RailItem = 'chats' | 'archived' | 'calls' | 'status' | 'changes' | 'settings' | 'plugin';

function useActiveItem(): RailItem {
  const view = useUI((s) => s.view);
  const panel = useUI((s) => s.railPanel);
  const archived = useChats((s) => s.showArchived);
  if (view === 'settings') return 'settings';
  if (view === 'changes') return 'changes';
  if (view === 'status') return 'status';
  if (view === 'plugin') return 'plugin';
  if (panel !== 'chats') return panel;
  return archived ? 'archived' : 'chats';
}

function go(item: RailItem): void {
  const ui = useUI.getState();
  const chats = useChats.getState();
  if (item === 'settings') {
    if (ui.view === 'settings') ui.closeSettings();
    else ui.openSettings('appearance');
    return;
  }
  if (item === 'status') {
    if (ui.view === 'status') ui.closeStatus();
    else ui.openStatus();
    return;
  }
  if (item === 'changes') {
    if (ui.view === 'changes') ui.closeChanges();
    else ui.openChanges();
    return;
  }
  const panel: RailPanel = item === 'calls' ? item : 'chats';
  ui.setRailPanel(panel);
  if (panel === 'chats') chats.setShowArchived(item === 'archived');
}

function RailButton({
  item,
  label,
  hint,
  icon,
  badge,
  active,
}: {
  item: RailItem;
  label: string;
  hint?: string;
  icon: ReactNode;
  badge?: number;
  active: boolean;
}) {
  return (
    <Tooltip label={label} hint={hint}>
      <button
        type="button"
        aria-label={badge ? `${label}, ${badge} unread` : label}
        aria-current={active ? 'page' : undefined}
        className={`wz-rail__item${active ? ' wz-rail__item--active' : ''}`}
        onClick={() => go(item)}
      >
        {icon}
        {badge ? <span className="wz-rail__badge">{badge > 99 ? '99+' : badge}</span> : null}
      </button>
    </Tooltip>
  );
}

export function NavRail() {
  const active = useActiveItem();
  const profile = useProfile((s) => s.profile);
  const myJid = useConnection((s) => s.auth.me?.jid);
  // count of chats with unread, like the official client, not of messages
  const unreadChats = useChats(
    (s) => Object.values(s.chats).filter((c) => c.unread > 0 && !c.archived && !c.muted).length,
  );

  return (
    <nav className="wz-rail" aria-label="Sections">
      <div className="wz-rail__group">
        <RailButton
          item="chats"
          label="Chats"
          icon={<MessageSquareText size={20} />}
          badge={unreadChats}
          active={active === 'chats'}
        />
        <RailButton
          item="calls"
          label="Calls"
          icon={<Phone size={20} />}
          active={active === 'calls'}
        />
        <RailButton
          item="status"
          label="Status"
          icon={<CircleDashed size={20} />}
          active={active === 'status'}
        />
        <span className="wz-rail__separator" role="separator" />
        <RailButton
          item="archived"
          label="Archived"
          icon={<Archive size={20} />}
          active={active === 'archived'}
        />
        <RailButton
          item="changes"
          label="Deleted & edited"
          icon={<History size={20} />}
          active={active === 'changes'}
        />
        <RailViewButtons />
      </div>
      <div className="wz-rail__group">
        <RailButton
          item="settings"
          label="Settings"
          hint="Ctrl ,"
          icon={<Settings size={20} />}
          active={active === 'settings'}
        />
        <Tooltip label="Profile">
          <button
            type="button"
            className="wz-rail__profile"
            aria-label="Your profile"
            onClick={() => {
              const ui = useUI.getState();
              ui.openSettings('profile', true);
            }}
          >
            <Avatar name={profile.name || profile.phone} jid={myJid} size={30} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
