import type { ThemeManifest, ThemePackage } from './types';

// Built-in themes are bundled so they work offline inside the Wails binary. Themes from the
// user's themes folder will come from the Go side as the same ThemePackage shape.
const manifests = import.meta.glob<ThemeManifest>('./*/manifest.json', {
  eager: true,
  import: 'default',
});
const styles = import.meta.glob<string>('./*/*.css', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function load(): ThemePackage[] {
  return Object.entries(manifests)
    .map(([path, manifest]) => {
      const dir = path.slice(0, path.lastIndexOf('/') + 1);
      const css: Record<string, string> = {};
      for (const [cssPath, text] of Object.entries(styles)) {
        if (cssPath.startsWith(dir)) css[cssPath.slice(dir.length)] = text;
      }
      return { manifest, css };
    })
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export const BUILTIN_THEMES: ThemePackage[] = load();
