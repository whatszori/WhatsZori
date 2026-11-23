import { create } from 'zustand';
import { backend, type ThemeFileChanged, type UserTheme, type UserThemePackage } from '../api';
import { BUILTIN_THEMES } from './registry';
import type { ThemePackage } from './types';

interface UserThemesState {
  themes: UserTheme[];
  // theme folders; broken ones keep their error for the settings page
  packages: UserThemePackage[];
  loaded: boolean;
  load(): Promise<void>;
  fileChanged(c: ThemeFileChanged): void;
}

export const useUserThemes = create<UserThemesState>((set, get) => ({
  themes: [],
  packages: [],
  loaded: false,
  async load() {
    try {
      const [themes, packages] = await Promise.all([
        backend.userThemes.list(),
        backend.userThemes.packages().catch(() => [] as UserThemePackage[]),
      ]);
      set({ themes, packages, loaded: true });
    } catch (err) {
      console.warn('[wz] could not list user themes', err);
      set({ loaded: true });
    }
  },
  fileChanged(c) {
    const known = get().themes.some((t) => t.file === c.file);
    if (known && c.hash) {
      // contents changed; reload the list anyway since the header (name, version) may have too
      set({ themes: get().themes.map((t) => (t.file === c.file ? { ...t, hash: c.hash } : t)) });
    }
    void get().load();
  },
}));

// Built-in themes plus the usable theme folders. A folder can't take a built-in theme's id.
export function allThemePackages(packages: UserThemePackage[]): ThemePackage[] {
  const builtin = new Set(BUILTIN_THEMES.map((t) => t.manifest.id));
  return [
    ...BUILTIN_THEMES,
    ...packages
      .filter((p) => !p.error && !builtin.has(p.manifest.id))
      .map((p) => ({ manifest: p.manifest, css: p.css })),
  ];
}

export function packageProblem(p: UserThemePackage): string | undefined {
  if (p.error) return p.error;
  if (BUILTIN_THEMES.some((t) => t.manifest.id === p.manifest.id))
    return `the id "${p.manifest.id}" belongs to a built-in theme`;
  return undefined;
}

const ATTR = 'data-wz-user-theme';

// One <link> at the very end of <head>, after the base tokens and the built-in theme styles, so a
// user theme wins at equal specificity. On edits the new file is loaded next to the old one and
// the old one is dropped once it's in, so there's no unstyled flash.
export function applyUserTheme(file: string | null, hash: string, doc = document): void {
  const links = Array.from(doc.head.querySelectorAll<HTMLLinkElement>(`link[${ATTR}]`));
  if (!file) {
    links.forEach((l) => l.remove());
    return;
  }
  const href = backend.userThemes.href(file, hash);
  const current = links.find((l) => l.getAttribute(ATTR) === file && l.dataset.href === href);
  if (current) {
    links.filter((l) => l !== current).forEach((l) => l.remove());
    if (doc.head.lastElementChild !== current) doc.head.appendChild(current);
    return;
  }

  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute(ATTR, file);
  link.dataset.href = href;
  const dropOld = () => links.forEach((l) => l.remove());
  link.addEventListener('load', dropOld, { once: true });
  link.addEventListener('error', dropOld, { once: true });
  link.href = href;
  doc.head.appendChild(link);
}

// call after the built-in themes are applied, they append their <style> tags at the end too
export function keepUserThemeLast(doc = document): void {
  const link = doc.head.querySelector<HTMLLinkElement>(`link[${ATTR}]:last-of-type`);
  if (link && doc.head.lastElementChild !== link) doc.head.appendChild(link);
}
