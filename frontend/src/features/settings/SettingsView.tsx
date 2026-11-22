import type { ReactNode } from 'react';
import { ArrowLeft, Info, Palette, Puzzle, ShieldCheck, Store, History, Brush } from 'lucide-react';
import { useUI, type SettingsSection } from '../../stores/ui';
import { IconButton, useLayer } from '../../ui';
import { AboutSection } from './sections/AboutSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { HistorySection } from './sections/HistorySection';
import { MarketplaceSection, PluginsSection, ThemesSection } from './sections/ExtensionsSections';
import { PrivacySection } from './sections/PrivacySection';
import './SettingsView.css';

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={18} /> },
  { id: 'privacy', label: 'Privacy', icon: <ShieldCheck size={18} /> },
  { id: 'history', label: 'Anti-delete & history', icon: <History size={18} /> },
  { id: 'plugins', label: 'Plugins', icon: <Puzzle size={18} /> },
  { id: 'themes', label: 'Themes', icon: <Brush size={18} /> },
  { id: 'marketplace', label: 'Marketplace', icon: <Store size={18} /> },
  { id: 'about', label: 'About', icon: <Info size={18} /> },
];

function Body({ section }: { section: SettingsSection }) {
  switch (section) {
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

export function SettingsView() {
  const section = useUI((s) => s.settingsSection);
  const { setSettingsSection, closeSettings } = useUI.getState();
  useLayer(true, closeSettings);

  return (
    <div className="wz-settings">
      <nav className="wz-settings__nav" aria-label="Settings sections">
        <header className="wz-settings__nav-header">
          <IconButton label="Close settings" hint="Esc" icon={<ArrowLeft size={18} />} onClick={closeSettings} />
          <h1 className="wz-settings__title">Settings</h1>
        </header>
        <ul className="wz-settings__list">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`wz-settings__nav-item${section === s.id ? ' wz-settings__nav-item--active' : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => setSettingsSection(s.id)}
              >
                <span className="wz-settings__nav-icon">{s.icon}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="wz-settings__body" key={section}>
        <div className="wz-settings__content">
          <Body section={section} />
        </div>
      </div>
    </div>
  );
}
