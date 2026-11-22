import { afterEach, describe, expect, it } from 'vitest';
import { applyThemes, buildThemeCss, isModuleEnabled } from './loader';
import { BUILTIN_THEMES } from './registry';
import type { ThemePackage } from './types';

const pkg: ThemePackage = {
  manifest: {
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    modules: [
      { id: 'base', name: 'Base', file: 'base.css', required: true },
      { id: 'extra', name: 'Extra', file: 'extra.css' },
      { id: 'off', name: 'Off by default', file: 'off.css', default: false },
    ],
  },
  css: { 'base.css': ':root{--a:1}', 'extra.css': ':root{--b:2}', 'off.css': ':root{--c:3}' },
};

describe('theme modules', () => {
  it('resolves required, default-on and default-off modules', () => {
    const [base, extra, off] = pkg.manifest.modules;
    expect(isModuleEnabled('test', base, { 'test/base': false })).toBe(true);
    expect(isModuleEnabled('test', extra, {})).toBe(true);
    expect(isModuleEnabled('test', off, {})).toBe(false);
    expect(isModuleEnabled('test', off, { 'test/off': true })).toBe(true);
  });

  it('concatenates enabled modules in manifest order', () => {
    const css = buildThemeCss(pkg, { 'test/extra': false, 'test/off': true });
    expect(css).toContain('--a:1');
    expect(css).not.toContain('--b:2');
    expect(css.indexOf('--a:1')).toBeLessThan(css.indexOf('--c:3'));
  });
});

describe('applyThemes', () => {
  afterEach(() => applyThemes([pkg], { themes: {}, themeModules: {} }));

  it('adds, updates and removes style tags', () => {
    applyThemes([pkg], { themes: { test: true }, themeModules: {} });
    const el = document.head.querySelector('style[data-wz-theme="test"]');
    expect(el?.textContent).toContain('--b:2');
    expect(document.documentElement.dataset.wzThemes).toBe('test');

    applyThemes([pkg], { themes: { test: true }, themeModules: { 'test/extra': false } });
    expect(document.head.querySelectorAll('style[data-wz-theme]').length).toBe(1);
    expect(document.head.querySelector('style[data-wz-theme="test"]')?.textContent).not.toContain(
      '--b:2',
    );

    applyThemes([pkg], { themes: { test: false }, themeModules: {} });
    expect(document.head.querySelector('style[data-wz-theme]')).toBeNull();
    expect(document.documentElement.dataset.wzThemes).toBeUndefined();
  });
});

describe('built-in themes', () => {
  it('ship every css file their manifest lists', () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThan(0);
    for (const t of BUILTIN_THEMES) {
      // vitest stubs CSS contents to '', so only check the files exist
      for (const m of t.manifest.modules)
        expect(Object.keys(t.css), `${t.manifest.id}/${m.file}`).toContain(m.file);
    }
  });
});
