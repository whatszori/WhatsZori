import { useEffect, type ReactNode } from 'react';
import { backend, devControls, isDemo } from '../api';
import { bindBackendEvents } from '../stores/bind-events';
import { useChats } from '../stores/chats';
import { useConnection } from '../stores/connection';
import { useProfile } from '../stores/profile';
import { useSettings } from '../stores/settings';
import { clampSidebar, useUI } from '../stores/ui';
import { nativeTheme } from '../theme/theme-manager';
import { registerDemoPlugins } from '../plugin-core/demo';
import { loadPlugins } from '../plugin-core/loader';
import { useUserThemes } from '../themes/user-themes';
import { useAppearance } from './useAppearance';

// long enough that a plugin or theme that breaks the UI on load has had its chance to
const BOOT_OK_AFTER = 4000;

export function AppProviders({ children }: { children: ReactNode }) {
  const settings = useSettings((s) => s.settings);
  const system = useSettings((s) => s.system);
  const loaded = useSettings((s) => s.loaded);
  const safeMode = useSettings((s) => s.safeMode);
  const authState = useConnection((s) => s.auth.state);
  const userThemes = useUserThemes((s) => s.themes);

  useEffect(() => {
    const offs = [
      bindBackendEvents(backend),
      backend.on('wz:systheme:changed', (p) => useSettings.getState().setSystem(p)),
      backend.on('wz:theme:changed', (c) => useUserThemes.getState().fileChanged(c)),
    ];
    void useSettings
      .getState()
      .load()
      .then(() => {
        const s = useSettings.getState().settings;
        useUI.setState({ sidebarWidth: clampSidebar(s.ui.sidebarWidth) });
      });
    void useConnection.getState().init();
    void useUserThemes.getState().load();
    const bootTimer = window.setTimeout(
      () => void backend.system.bootOK().catch(() => {}),
      BOOT_OK_AFTER,
    );
    return () => {
      offs.forEach((off) => off());
      window.clearTimeout(bootTimer);
    };
  }, []);

  useAppearance();

  // the tray icon and taskbar badge count chats like the rail badge: unread, not muted or archived
  const unreadChats = useChats(
    (s) => Object.values(s.chats).filter((c) => c.unread > 0 && !c.muted && !c.archived).length,
  );
  useEffect(() => {
    if (backend.kind !== 'wails') return;
    void backend.window.setUnread(authState === 'logged-in' ? unreadChats : 0).catch(() => {});
  }, [unreadChats, authState]);

  // tell the native window once the page has its real colors, so the title bar and the
  // background behind the webview match (and the next start opens in the right colors)
  useEffect(() => {
    if (!loaded || backend.kind !== 'wails') return;
    const id = requestAnimationFrame(() => {
      const { dark, background } = nativeTheme();
      void backend.window.setTheme(dark, background).catch(() => {});
    });
    return () => cancelAnimationFrame(id);
  }, [loaded, settings, system, userThemes]);

  // links inside a webview would otherwise open in a second webview window
  useEffect(() => {
    if (backend.kind !== 'wails') return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button > 1) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement)) return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin) return;
      e.preventDefault();
      void backend.system
        .openExternal(url.href)
        .catch((err) => console.warn('[wz] open link', err));
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('auxclick', onClick, true);
    };
  }, []);

  useEffect(() => {
    if (authState !== 'logged-in') return;
    void useChats.getState().load();
    void useProfile.getState().load();
    if (isDemo) devControls?.setDemo(true);
    return () => devControls?.setDemo(false);
  }, [authState]);

  useEffect(() => {
    // safe mode is exactly for "a plugin broke startup", so plugins stay off
    if (!loaded || safeMode) return;
    if (isDemo) return registerDemoPlugins();
    let stop: (() => void) | undefined;
    let cancelled = false;
    void loadPlugins().then((s) => {
      if (cancelled) s();
      else stop = s;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [loaded, safeMode]);

  return <>{children}</>;
}
