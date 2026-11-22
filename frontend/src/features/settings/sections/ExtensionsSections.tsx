import { Brush, FolderOpen, Puzzle } from 'lucide-react';
import { PluginSlot, useSlotEntries } from '../../../plugin-core/slots';
import { useSettings } from '../../../stores/settings';
import { Button, Toggle } from '../../../ui';
import { Group, Page } from './common';

// Placeholder entries until plugin loading exists.
const PLUGINS = [
  {
    id: 'message-timestamps',
    name: 'Exact timestamps',
    description: 'Show seconds in message times.',
    version: '0.1.0',
  },
  {
    id: 'translate-button',
    name: 'Translate',
    description: 'Adds a translate action to the message menu.',
    version: '0.3.2',
  },
  {
    id: 'quick-reply-templates',
    name: 'Reply templates',
    description: 'Insert saved snippets from the composer.',
    version: '1.0.0',
  },
];

const THEMES = [
  {
    id: 'nord-quiet',
    name: 'Nord Quiet',
    description: 'Cool greys with a muted frost accent.',
    version: '1.2.0',
  },
  {
    id: 'paper-high-contrast',
    name: 'Paper, high contrast',
    description: 'Stronger borders and text for bright rooms.',
    version: '0.9.0',
  },
];

function ExtList({
  kind,
  entries,
}: {
  kind: 'plugins' | 'themes';
  entries: { id: string; name: string; description: string; version: string }[];
}) {
  const state = useSettings((s) => s.settings[kind]);
  const update = useSettings((s) => s.update);
  return (
    <div className="wz-ext-list">
      {entries.map((e) => (
        <div key={e.id} className="wz-ext-item">
          <span className="wz-ext-item__icon" aria-hidden="true">
            {kind === 'plugins' ? (
              <Puzzle size={18} strokeWidth={1.75} />
            ) : (
              <Brush size={18} strokeWidth={1.75} />
            )}
          </span>
          <Toggle
            label={e.name}
            description={`${e.description} · v${e.version}`}
            checked={!!state[e.id]}
            onChange={(on) => update((s) => ({ ...s, [kind]: { ...s[kind], [e.id]: on } }))}
          />
        </div>
      ))}
    </div>
  );
}

export function PluginsSection() {
  const pluginSettings = useSlotEntries('settings.sections');
  return (
    <Page title="Plugins" lead="Plugins add buttons and menu items in fixed places of the app.">
      <Group title="Installed">
        <ExtList kind="plugins" entries={PLUGINS} />
      </Group>
      <div className="wz-settings-actions">
        <Button icon={<FolderOpen size={16} />} onClick={() => undefined}>
          Open plugins folder
        </Button>
      </div>
      {pluginSettings.length > 0 && (
        <Group title="Plugin settings">
          <div className="wz-plugin-settings">
            <PluginSlot name="settings.sections" />
          </div>
        </Group>
      )}
    </Page>
  );
}

export function ThemesSection() {
  return (
    <Page title="Themes" lead="Themes are CSS files that override the --wz-* variables.">
      <Group title="Installed">
        <ExtList kind="themes" entries={THEMES} />
      </Group>
      <div className="wz-settings-actions">
        <Button icon={<FolderOpen size={16} />} onClick={() => undefined}>
          Open themes folder
        </Button>
      </div>
    </Page>
  );
}

export function MarketplaceSection() {
  return (
    <Page title="Marketplace">
      <div className="wz-coming-soon">
        <strong>Coming soon</strong>
        Browse and install plugins and themes from here.
      </div>
    </Page>
  );
}
