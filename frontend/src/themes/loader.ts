import type { ThemeModuleInfo, ThemePackage } from './types';

export interface ThemeSelection {
  themes: Record<string, boolean>;
  themeModules: Record<string, boolean>;
}

const ATTR = 'data-wz-theme';

export const moduleKey = (themeId: string, moduleId: string) => `${themeId}/${moduleId}`;

export function isModuleEnabled(
  themeId: string,
  mod: ThemeModuleInfo,
  modules: Record<string, boolean>,
): boolean {
  if (mod.required) return true;
  return modules[moduleKey(themeId, mod.id)] ?? mod.default ?? true;
}

export function buildThemeCss(pkg: ThemePackage, modules: Record<string, boolean>): string {
  const { id } = pkg.manifest;
  return pkg.manifest.modules
    .filter((m) => isModuleEnabled(id, m, modules))
    .map((m) => {
      const css = pkg.css[m.file];
      if (css === undefined) {
        console.warn(`[wz] theme "${id}" lists ${m.file} but it wasn't found`);
        return '';
      }
      return `/* ${id}/${m.id} */\n${css}`;
    })
    .join('\n');
}

// One <style> per enabled theme, appended at the end of <head> so it wins over the app's own
// CSS at equal specificity. Themes never need !important for variables.
export function applyThemes(packages: ThemePackage[], sel: ThemeSelection, doc = document): void {
  const wanted = new Map<string, string>();
  for (const pkg of packages) {
    if (sel.themes[pkg.manifest.id])
      wanted.set(pkg.manifest.id, buildThemeCss(pkg, sel.themeModules));
  }

  for (const el of Array.from(doc.head.querySelectorAll<HTMLStyleElement>(`style[${ATTR}]`))) {
    if (!wanted.has(el.getAttribute(ATTR) ?? '')) el.remove();
  }

  for (const [id, css] of wanted) {
    let el = doc.head.querySelector<HTMLStyleElement>(`style[${ATTR}="${CSS.escape(id)}"]`);
    if (!el) {
      el = doc.createElement('style');
      el.setAttribute(ATTR, id);
      doc.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  // lets theme-aware CSS or plugins check what's active
  const active = [...wanted.keys()].join(' ');
  if (active) doc.documentElement.dataset.wzThemes = active;
  else delete doc.documentElement.dataset.wzThemes;
}
