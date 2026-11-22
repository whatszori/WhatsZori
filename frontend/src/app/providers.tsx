import { useEffect, type ReactNode } from 'react';
import { backend, devControls, isDemo } from '../api';
import { bindBackendEvents } from '../stores/bind-events';
import { useChats } from '../stores/chats';
import { useConnection } from '../stores/connection';
import { effectiveAccent, useSettings } from '../stores/settings';
import { applyAppearance } from '../theme/theme-manager';
import { registerDemoPlugins } from '../plugin-core/demo';
import { applyThemes } from '../themes/loader';
import { BUILTIN_THEMES } from '../themes/registry';

export function AppProviders({ children }: { children: ReactNode }) {
  const settings = useSettings((s) => s.settings);
  const authState = useConnection((s) => s.auth.state);

  useEffect(() => {
    const off = bindBackendEvents(backend);
    void useSettings.getState().load();
    void useConnection.getState().init();
    return off;
  }, []);

  useEffect(() => {
    applyAppearance({
      theme: settings.appearance.theme,
      accent: effectiveAccent(settings),
      density: settings.appearance.density,
      fontScale: settings.appearance.fontScale,
    });
  }, [settings]);

  useEffect(() => {
    applyThemes(BUILTIN_THEMES, settings);
  }, [settings]);

  useEffect(() => {
    if (authState !== 'logged-in') return;
    void useChats.getState().load();
    if (isDemo) devControls?.setDemo(true);
    return () => devControls?.setDemo(false);
  }, [authState]);

  useEffect(() => {
    if (!isDemo) return;
    return registerDemoPlugins();
  }, []);

  return <>{children}</>;
}
