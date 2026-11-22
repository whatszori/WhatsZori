import type { ReactNode } from 'react';
import {
  Brush,
  CircleUser,
  History,
  Info,
  Palette,
  Puzzle,
  ShieldCheck,
  Store,
} from 'lucide-react';
import type { SettingsSection } from '../../../stores/ui';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { MarketplaceSection, PluginsSection } from './ExtensionsSections';
import { HistorySection } from './HistorySection';
import { PrivacySection } from './PrivacySection';
import { ProfileSection } from './ProfileSection';
import { ThemesSection } from './ThemesSection';

export interface SectionInfo {
  id: SettingsSection;
  label: string;
  hint: string;
  icon: ReactNode;
}

export const SECTIONS: SectionInfo[] = [
  {
    id: 'profile',
    label: 'Profile',
    hint: 'Name, about, phone number',
    icon: <CircleUser size={18} />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    hint: 'Theme, accent, layout, text size',
    icon: <Palette size={18} />,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    hint: 'Ghost mode, read receipts',
    icon: <ShieldCheck size={18} />,
  },
  {
    id: 'history',
    label: 'Anti-delete & history',
    hint: 'Deleted messages, edit history',
    icon: <History size={18} />,
  },
  { id: 'plugins', label: 'Plugins', hint: 'Installed plugins', icon: <Puzzle size={18} /> },
  {
    id: 'themes',
    label: 'Themes',
    hint: 'Installed themes and their modules',
    icon: <Brush size={18} />,
  },
  { id: 'marketplace', label: 'Marketplace', hint: 'Coming soon', icon: <Store size={18} /> },
  {
    id: 'about',
    label: 'About',
    hint: 'Version, disclaimer, links, log out',
    icon: <Info size={18} />,
  },
];

export function SectionBody({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'profile':
      return <ProfileSection />;
    case 'privacy':
      return <PrivacySection />;
    case 'history':
      return <HistorySection />;
    case 'plugins':
      return <PluginsSection />;
    case 'themes':
      return <ThemesSection />;
    case 'marketplace':
      return <MarketplaceSection />;
    case 'about':
      return <AboutSection />;
    default:
      return <AppearanceSection />;
  }
}
