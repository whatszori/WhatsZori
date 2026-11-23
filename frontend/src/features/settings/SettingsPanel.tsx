import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { useConnection } from '../../stores/connection';
import { useProfile } from '../../stores/profile';
import { useUI, type SettingsSection } from '../../stores/ui';
import { Avatar, IconButton, Input, useLayer } from '../../ui';
import { SECTIONS, SectionBody } from './sections/registry';
import './SettingsView.css';
import './SettingsPanel.css';

// Settings inside the sidebar (rail layout): a list of sections, then one section with a back
// arrow. Esc goes back a level.
export function SettingsPanel() {
  const initial = useUI((s) => s.settingsSection);
  const direct = useUI((s) => s.settingsDirect);
  const [page, setPage] = useState<SettingsSection | null>(direct ? initial : null);
  const [query, setQuery] = useState('');
  const profile = useProfile((s) => s.profile);
  const myJid = useConnection((s) => s.auth.me?.jid);
  const closeSettings = useUI((s) => s.closeSettings);

  useLayer(true, () => (page ? setPage(null) : closeSettings()));

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => `${s.label} ${s.hint}`.toLowerCase().includes(q));
  }, [query]);

  if (page) {
    const info = SECTIONS.find((s) => s.id === page);
    return (
      <div className="wz-settings-panel">
        <header className="wz-settings-panel__header">
          <IconButton
            label="Back"
            hint="Esc"
            icon={<ArrowLeft size={18} />}
            onClick={() => setPage(null)}
          />
          <h1 className="wz-settings-panel__title">{info?.label}</h1>
        </header>
        <div className="wz-settings-panel__body" key={page}>
          <SectionBody section={page} />
        </div>
      </div>
    );
  }

  return (
    <div className="wz-settings-panel">
      <header className="wz-settings-panel__header">
        <h1 className="wz-settings-panel__title wz-settings-panel__title--large">Settings</h1>
      </header>
      <div className="wz-settings-panel__search">
        <Input
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          icon={<Search size={16} strokeWidth={1.75} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="wz-settings-panel__scroll">
        {!query && (
          <button
            type="button"
            className="wz-settings-panel__profile"
            onClick={() => setPage('profile')}
          >
            <Avatar name={profile.name || profile.phone} jid={myJid} size={56} />
            <span className="wz-settings-panel__profile-text">
              <span className="wz-settings-panel__profile-name">{profile.name}</span>
              <span className="wz-settings-panel__profile-sub">{profile.about}</span>
            </span>
          </button>
        )}
        <ul className="wz-settings-panel__list">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="wz-settings-panel__item"
                onClick={() => setPage(s.id)}
              >
                <span className="wz-settings-panel__icon">{s.icon}</span>
                <span className="wz-settings-panel__text">
                  <span className="wz-settings-panel__label">{s.label}</span>
                  <span className="wz-settings-panel__hint">{s.hint}</span>
                </span>
                <ChevronRight className="wz-settings-panel__chevron" size={16} />
              </button>
            </li>
          ))}
        </ul>
        {sections.length === 0 && <p className="wz-empty-text">Nothing matches “{query}”</p>}
      </div>
    </div>
  );
}
