// Compile-time check that the hand-written event types in api/events.ts still match what the
// binding generator produced from the Go structs. Nothing here runs.
import type * as Generated from '../../../bindings/events';
import type { SystemPalette as GoPalette } from '../../../bindings/github.com/whatszori/WhatsZori/internal/systheme/models';
import type {
  Changed as GoThemeChanged,
  Info as GoThemeInfo,
} from '../../../bindings/github.com/whatszori/WhatsZori/internal/themes/models';
import type { SystemPalette, ThemeFileChanged } from '../events';
import { WZ_EVENTS } from '../events';
import type { UserTheme } from '../types';

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Keys<T> = keyof T & string;

export type Checks = [
  Assert<Same<Keys<SystemPalette>, Keys<GoPalette>>>,
  Assert<Same<Keys<ThemeFileChanged>, Keys<GoThemeChanged>>>,
  Assert<Same<Keys<UserTheme>, Keys<GoThemeInfo>>>,
  Assert<Same<(typeof WZ_EVENTS)['systemThemeChanged'], typeof Generated.WzSysthemeChanged>>,
  Assert<Same<(typeof WZ_EVENTS)['themeChanged'], typeof Generated.WzThemeChanged>>,
];
