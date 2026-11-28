import { useState, type MouseEvent } from 'react';
import { EyeOff } from 'lucide-react';
import { useChats, type ChatSection } from '../../stores/chats';
import { useSettings } from '../../stores/settings';
import { Menu, type PopoverAnchor } from '../../ui';
import './SectionTabs.css';

// Chats / Channels / Communities above the chat list. Channels and communities only show when
// there are some, and either can be hidden (right-click, or Settings → Appearance).

export type HideableTab = 'channels' | 'communities';

const LABELS: Record<ChatSection, string> = {
  chats: 'Chats',
  channels: 'Channels',
  communities: 'Communities',
};

// one empty list, so the selector returns the same thing every time
const NONE: HideableTab[] = [];

export function useHiddenTabs(): HideableTab[] {
  return useSettings((s) => (s.settings.ui.hiddenTabs as HideableTab[] | undefined) ?? NONE);
}

export function setTabHidden(tab: HideableTab, hidden: boolean): void {
  useSettings.getState().update((s) => {
    const cur = new Set(s.ui.hiddenTabs ?? []);
    if (hidden) cur.add(tab);
    else cur.delete(tab);
    return { ...s, ui: { ...s.ui, hiddenTabs: [...cur] } };
  });
  if (hidden && useChats.getState().section === tab) useChats.getState().setSection('chats');
}

// the tabs there are to show (chats alone means no row at all)
export function useSectionTabs(): ChatSection[] {
  const hidden = useHiddenTabs();
  const hasChannels = useChats((s) => Object.values(s.chats).some((c) => c.channel));
  const hasCommunities = useChats((s) => Object.values(s.chats).some((c) => c.isCommunity));
  const tabs: ChatSection[] = ['chats'];
  if (hasChannels && !hidden.includes('channels')) tabs.push('channels');
  if (hasCommunities && !hidden.includes('communities')) tabs.push('communities');
  return tabs;
}

export function SectionTabs({ tabs }: { tabs: ChatSection[] }) {
  const section = useChats((s) => s.section);
  const setSection = useChats((s) => s.setSection);
  const unread = useChats((s) => {
    const n: Record<ChatSection, number> = { chats: 0, channels: 0, communities: 0 };
    for (const c of Object.values(s.chats)) {
      if (!c.unread || c.archived || c.muted) continue;
      if (c.channel) n.channels++;
      else if (c.community) n.communities++;
    }
    return `${n.channels}/${n.communities}`;
  });
  const [unreadChannels, unreadCommunities] = unread.split('/').map(Number);
  const [menu, setMenu] = useState<{ tab: HideableTab; anchor: PopoverAnchor } | null>(null);

  if (tabs.length < 2) return null;

  const onContext = (tab: ChatSection) => (e: MouseEvent<HTMLButtonElement>) => {
    if (tab === 'chats') return;
    e.preventDefault();
    setMenu({ tab, anchor: { x: e.clientX, y: e.clientY } });
  };

  return (
    <div className="wz-sections" role="tablist" aria-label="Sections">
      {tabs.map((t) => {
        const badge =
          t === 'channels' ? unreadChannels : t === 'communities' ? unreadCommunities : 0;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={section === t}
            className={`wz-sections__tab${section === t ? ' wz-sections__tab--on' : ''}`}
            onClick={() => setSection(t)}
            onContextMenu={onContext(t)}
            title={t === 'chats' ? undefined : 'Right-click to hide this tab'}
          >
            {LABELS[t]}
            {badge > 0 && <span className="wz-sections__dot" aria-label={`${badge} unread`} />}
          </button>
        );
      })}
      <Menu
        open={!!menu}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        label="Tab"
        items={
          menu
            ? [
                {
                  id: 'hide',
                  label: `Hide the ${LABELS[menu.tab]} tab`,
                  icon: <EyeOff size={16} />,
                  onSelect: () => setTabHidden(menu.tab, true),
                },
              ]
            : []
        }
        header={
          <p className="wz-sections__hint">You can show it again in Settings → Appearance.</p>
        }
      />
    </div>
  );
}
