import { useEffect } from 'react';
import { backend } from '../api';
import { effectiveAccent, systemScheme, useSettings } from '../stores/settings';
import { applyAppearance } from '../theme/theme-manager';
import { applyThemes } from '../themes/loader';
import {
  allThemePackages,
  applyUserTheme,
  keepUserThemeLast,
  useUserThemes,
} from '../themes/user-themes';

// Applies theme, accent, built-in theme modules and the user's CSS theme to this document. The
// main window and the toast window both use it, so a theme looks the same in both.
export function useAppearance(): void {
  const settings = useSettings((s) => s.settings);
  const system = useSettings((s) => s.system);
  const userThemes = useUserThemes((s) => s.themes);
  const packages = useUserThemes((s) => s.packages);

  useEffect(() => {
    const { accent, accentFg } = effectiveAccent(settings, system);
    applyAppearance({
      theme: settings.appearance.theme,
      accent,
      accentFg,
      systemScheme: systemScheme(system),
      density: settings.appearance.density,
      layout: settings.appearance.layout ?? 'panels',
      fontScale: settings.appearance.fontScale,
    });
    applyThemes(allThemePackages(packages), settings);
    keepUserThemeLast();
  }, [settings, system, packages]);

  // the user's wallpaper sits above any theme's background
  useEffect(() => {
    const root = document.documentElement;
    const { wallpaper, wallpaperDim } = settings.appearance;
    if (wallpaper) {
      root.dataset.wzWallpaper = '';
      root.style.setProperty(
        '--wz-user-wallpaper',
        `url("${backend.userThemes.wallpaperUrl(wallpaper)}")`,
      );
      root.style.setProperty('--wz-user-wallpaper-dim', String(wallpaperDim ?? 0.2));
    } else {
      delete root.dataset.wzWallpaper;
      root.style.removeProperty('--wz-user-wallpaper');
      root.style.removeProperty('--wz-user-wallpaper-dim');
    }
  }, [settings.appearance]);

  useEffect(() => {
    const file = settings.userTheme;
    const theme = file ? userThemes.find((t) => t.file === file) : undefined;
    applyUserTheme(theme ? theme.file : null, theme?.hash ?? '');
  }, [settings.userTheme, userThemes]);
}
