import { Brush, FileCode, FolderOpen } from 'lucide-react';
import { backend, type UserTheme } from '../../../api';
import { useSettings } from '../../../stores/settings';
import { useUserThemes } from '../../../themes/user-themes';
import { isModuleEnabled, moduleKey } from '../../../themes/loader';
import { BUILTIN_THEMES } from '../../../themes/registry';
import type { ThemePackage } from '../../../themes/types';
import { Button, Toggle } from '../../../ui';
import { Group, Page } from './common';

function ThemeEntry({ pkg }: { pkg: ThemePackage }) {
  const { manifest } = pkg;
  const enabled = useSettings((s) => !!s.settings.themes[manifest.id]);
  const modules = useSettings((s) => s.settings.themeModules);
  const update = useSettings((s) => s.update);
  const optional = manifest.modules.filter((m) => !m.required);
  const meta = [`v${manifest.version}`, manifest.author && `by ${manifest.author}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="wz-theme-entry">
      <div className="wz-ext-item">
        <span className="wz-ext-item__icon" aria-hidden="true">
          <Brush size={18} strokeWidth={1.75} />
        </span>
        <Toggle
          label={manifest.name}
          description={[manifest.description, meta].filter(Boolean).join(' · ')}
          checked={enabled}
          onChange={(on) =>
            update((s) => ({
              ...s,
              themes: { ...s.themes, [manifest.id]: on },
              // a theme built for a layout brings it along; the user can switch back after
              appearance:
                on && manifest.layout ? { ...s.appearance, layout: manifest.layout } : s.appearance,
            }))
          }
        />
      </div>
      {enabled && optional.length > 0 && (
        <div className="wz-theme-modules" role="group" aria-label={`${manifest.name} modules`}>
          {optional.map((m) => (
            <Toggle
              key={m.id}
              label={m.name}
              description={m.description}
              checked={isModuleEnabled(manifest.id, m, modules)}
              onChange={(on) =>
                update((s) => ({
                  ...s,
                  themeModules: { ...s.themeModules, [moduleKey(manifest.id, m.id)]: on },
                }))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserThemeEntry({ theme }: { theme: UserTheme }) {
  const active = useSettings((s) => s.settings.userTheme === theme.file);
  const update = useSettings((s) => s.update);
  const meta = [
    theme.version && `v${theme.version}`,
    theme.author && `by ${theme.author}`,
    theme.file,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="wz-ext-item">
      <span className="wz-ext-item__icon" aria-hidden="true">
        <FileCode size={18} strokeWidth={1.75} />
      </span>
      <Toggle
        label={theme.name}
        description={[theme.description, meta].filter(Boolean).join(' · ')}
        checked={active}
        // one file theme at a time; turning another on replaces it
        onChange={(on) => update((s) => ({ ...s, userTheme: on ? theme.file : null }))}
      />
    </div>
  );
}

function UserThemes() {
  const themes = useUserThemes((s) => s.themes);
  const desktop = backend.kind === 'wails';
  return (
    <Group title="From your themes folder">
      {themes.length > 0 ? (
        <div className="wz-ext-list">
          {themes.map((t) => (
            <UserThemeEntry key={t.file} theme={t} />
          ))}
        </div>
      ) : (
        <p className="wz-setting-row wz-setting-row__desc">
          {desktop
            ? 'Drop a .css file into the themes folder and it shows up here. Edits apply as soon as you save.'
            : 'Themes from disk work in the desktop app.'}
        </p>
      )}
    </Group>
  );
}

export function ThemesSection() {
  const desktop = backend.kind === 'wails';
  return (
    <Page
      title="Themes"
      lead="A theme is a folder with a manifest and CSS modules that override the --wz-* variables. Turn modules on and off to mix and match."
    >
      <Group title="Installed">
        <div className="wz-ext-list">
          {BUILTIN_THEMES.map((t) => (
            <ThemeEntry key={t.manifest.id} pkg={t} />
          ))}
        </div>
      </Group>
      <UserThemes />
      <div className="wz-settings-actions">
        <Button
          icon={<FolderOpen size={16} />}
          disabled={!desktop}
          title={desktop ? undefined : 'Available in the desktop app'}
          onClick={() => void backend.system.openConfigFolder('themes')}
        >
          Open themes folder
        </Button>
      </div>
    </Page>
  );
}
