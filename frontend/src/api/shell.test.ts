import { describe, expect, it } from 'vitest';
import { effectiveAccent, systemScheme } from '../stores/settings';
import { cssColorToHex, resolveTheme } from '../theme/theme-manager';
import { DEFAULT_SETTINGS, withDefaults } from './defaults';
import type { SystemPalette } from './events';
import { chooseBackend, hasWailsRuntime } from './wails/detect';

const palette = (p: Partial<SystemPalette>): SystemPalette => ({
  source: 'windows',
  scheme: 'dark',
  accent: '#0078d7',
  accentFg: '#ffffff',
  raw: {},
  ...p,
});

describe('backend choice', () => {
  it('uses Wails when the runtime bridge is there', () => {
    expect(chooseBackend('', true)).toBe('wails');
    expect(chooseBackend('', false)).toBe('mock');
  });

  it('lets ?backend=mock override', () => {
    expect(chooseBackend('?backend=mock', true)).toBe('mock');
    expect(chooseBackend('?demo=1&backend=mock', true)).toBe('mock');
  });

  it('detects the WebView2 and WebKit bridges', () => {
    const fake = (v: object) => v as unknown as Window;
    expect(hasWailsRuntime(fake({}))).toBe(false);
    expect(hasWailsRuntime(fake({ chrome: { webview: { postMessage: () => {} } } }))).toBe(true);
    expect(
      hasWailsRuntime(
        fake({ webkit: { messageHandlers: { external: { postMessage: () => {} } } } }),
      ),
    ).toBe(true);
    // plain Chrome/Edge has window.chrome but no webview bridge
    expect(hasWailsRuntime(fake({ chrome: {} }))).toBe(false);
  });
});

describe('withDefaults', () => {
  it('fills keys an older build did not store', () => {
    const s = withDefaults({ appearance: { theme: 'dark' }, plugins: { x: true } });
    expect(s.appearance.theme).toBe('dark');
    expect(s.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    expect(s.ui.sidebarWidth).toBe(340);
    expect(s.userTheme).toBeNull();
    expect(s.plugins.x).toBe(true);
  });

  it('ignores junk', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults({ appearance: 'dark', ui: 5 })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('system theme', () => {
  it('uses the OS accent and its text color when asked to', () => {
    const s = withDefaults({ appearance: { useSystemAccent: true, accent: 'teal' } });
    expect(effectiveAccent(s, palette({}))).toEqual({ accent: '#0078d7', accentFg: '#ffffff' });
    // no OS accent: keep the user's pick
    expect(effectiveAccent(s, palette({ accent: '' }))).toEqual({ accent: 'teal', accentFg: null });
  });

  it('prefers the Go scheme over prefers-color-scheme', () => {
    expect(resolveTheme('system', systemScheme(palette({ scheme: 'dark' })))).toBe('dark');
    expect(resolveTheme('system', systemScheme(palette({ scheme: 'light' })))).toBe('light');
    expect(systemScheme(palette({ scheme: 'none' }))).toBeNull();
    expect(resolveTheme('light', 'dark')).toBe('light');
  });

  it('turns computed colors into hex', () => {
    expect(cssColorToHex('rgb(18, 18, 20)')).toBe('#121214');
    expect(cssColorToHex('rgba(233, 233, 235, 1)')).toBe('#e9e9eb');
    expect(cssColorToHex('rgb(1 2 3 / 50%)')).toBeNull();
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(cssColorToHex('#ABCDEF')).toBe('#abcdef');
    expect(cssColorToHex('transparent')).toBeNull();
  });
});
