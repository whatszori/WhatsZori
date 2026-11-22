import { ArrowLeft } from 'lucide-react';
import { useUI } from '../../stores/ui';
import { IconButton, useLayer } from '../../ui';
import { SECTIONS, SectionBody } from './sections/registry';
import './SettingsView.css';

export function SettingsView() {
  const section = useUI((s) => s.settingsSection);
  const { setSettingsSection, closeSettings } = useUI.getState();
  useLayer(true, closeSettings);

  return (
    <div className="wz-settings">
      <nav className="wz-settings__nav" aria-label="Settings sections">
        <header className="wz-settings__nav-header">
          <IconButton
            label="Close settings"
            hint="Esc"
            icon={<ArrowLeft size={18} />}
            onClick={closeSettings}
          />
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
          <SectionBody section={section} />
        </div>
      </div>
    </div>
  );
}
