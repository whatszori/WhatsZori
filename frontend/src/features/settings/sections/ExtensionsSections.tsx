import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, FolderOpen, Puzzle, RefreshCw } from 'lucide-react';
import { backend, type PluginInfo } from '../../../api';
import {
  isRunning,
  onPluginsChanged,
  pluginError,
  startPlugin,
  stopPlugin,
} from '../../../plugin-core/loader';
import { PluginSlot, useSlotEntries } from '../../../plugin-core/slots';
import { useSettings } from '../../../stores/settings';
import { toastError } from '../../../stores/toasts';
import { Button, Toggle } from '../../../ui';
import { Group, Page } from './common';

let version = 0;
const subscribe = (fn: () => void) =>
  onPluginsChanged(() => {
    version++;
    fn();
  });

export function PluginsSection() {
  const pluginSettings = useSlotEntries('settings.sections');
  const safeMode = useSettings((s) => s.safeMode);
  const [list, setList] = useState<PluginInfo[] | null>(null);
  // re-render when a plugin starts, stops or fails
  useSyncExternalStore(subscribe, () => version);

  const load = useCallback(() => {
    backend.plugins
      .list()
      .then(setList)
      .catch((err) => toastError(err));
  }, []);
  useEffect(load, [load]);

  const toggle = async (p: PluginInfo, on: boolean) => {
    try {
      await backend.plugins.setEnabled(p.id, on);
      if (!safeMode) {
        if (on) await startPlugin(p);
        else stopPlugin(p.id);
      }
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const desktop = backend.kind === 'wails';
  return (
    <Page
      title="Plugins"
      lead="Plugins add buttons, menu items and settings in fixed places of the app. Put a plugin's folder into the plugins folder, then turn it on here."
    >
      {safeMode && (
        <p className="wz-note">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Safe mode is on, so no plugin runs. Restart normally to load them again.</span>
        </p>
      )}
      <Group title="Installed">
        {list && list.length === 0 && (
          <p className="wz-settings-hint">
            {desktop
              ? 'No plugins yet. Each plugin is a folder with a manifest.json and its script.'
              : 'Plugins load from the config folder in the desktop app.'}
          </p>
        )}
        <div className="wz-ext-list">
          {(list ?? []).map((p) => {
            const failed = p.error || pluginError(p.id);
            return (
              <div key={p.id} className="wz-ext-item">
                <span className="wz-ext-item__icon" aria-hidden="true">
                  {failed ? (
                    <AlertTriangle size={18} strokeWidth={1.75} />
                  ) : (
                    <Puzzle size={18} strokeWidth={1.75} />
                  )}
                </span>
                <Toggle
                  label={p.name}
                  description={[
                    p.description,
                    p.version && `v${p.version}`,
                    p.author && `by ${p.author}`,
                    failed && `Can't load: ${failed}`,
                    p.enabled && !failed && !safeMode && !isRunning(p.id) && 'starting…',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  checked={p.enabled}
                  disabled={!!p.error && !p.enabled}
                  onChange={(on) => void toggle(p, on)}
                />
              </div>
            );
          })}
        </div>
      </Group>
      <div className="wz-settings-actions">
        <Button
          icon={<FolderOpen size={16} />}
          disabled={!desktop}
          title={desktop ? undefined : 'Available in the desktop app'}
          onClick={() => void backend.system.openConfigFolder('plugins')}
        >
          Open plugins folder
        </Button>
        <Button icon={<RefreshCw size={16} />} onClick={load}>
          Look again
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
