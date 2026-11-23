import { useEffect } from 'react';
import { effectiveAccent, systemScheme, useSettings } from '../stores/settings';
import { applyAppearance } from '../theme/theme-manager';
import { applyThemes } from '../themes/loader';
import { BUILTIN_THEMES } from '../themes/registry';
import { applyUserTheme, keepUserThemeLast, useUserThemes } from '../themes/user-themes';

// Applies theme, accent, built-in theme modules and the user's CSS theme to this document. The
// main window and the toast window both use it, so a theme looks the same in both.
export function useAppearance(): void {
  const settings = useSettings((s) => s.settings);
  const system = useSettings((s) => s.system);
  const userThemes = useUserThemes((s) => s.themes);

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
    applyThemes(BUILTIN_THEMES, settings);
    keepUserThemeLast();
  }, [settings, system]);

  useEffect(() => {
    const file = settings.userTheme;
    const theme = file ? userThemes.find((t) => t.file === file) : undefined;
    applyUserTheme(theme ? theme.file : null, theme?.hash ?? '');
  }, [settings.userTheme, userThemes]);
}
