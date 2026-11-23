# Theming

Everything visual in WhatsZori goes through CSS custom properties prefixed `--wz-`. A theme is a
CSS file that overrides some of them. Class names are stable (`wz-` + BEM-ish), so a theme can
also target specific parts, but variables should be the first tool.

Source of truth: [`frontend/src/theme/tokens.css`](../frontend/src/theme/tokens.css).

## How themes are applied

- Light values live on `:root`, dark values on `[data-theme="dark"]` (set on `<html>`).
- Theme mode Light / Dark / System is handled by `theme-manager.ts`. In System mode it listens to
  `prefers-color-scheme` and flips `data-theme` live.
- The accent color is set inline on `<html>` as `--wz-accent` when the user picks one (preset or
  custom), or when "Use system accent" is on (the Go side will push the OS accent later).
- Density sets `data-density="compact"` on `<html>`; text size sets `--wz-font-scale`.

### Writing a theme

```css
/* only the accent: everything accent-derived follows automatically */
:root { --wz-accent: #2b7a78; }

/* a full palette: override both modes */
:root {
  --wz-bg-app: #e8ebef;
  --wz-bg-primary: #f8f9fb;
  /* ... */
}
[data-theme='dark'] {
  --wz-bg-app: #1d2128;
  /* ... */
}
```

Keep text contrast at WCAG AA (4.5:1 for body text) against the surfaces it sits on.

## Single-file themes from disk

In the desktop app, any `.css` file in `<config>/themes/` shows up in Settings → Themes under
"From your themes folder". One can be on at a time, on top of the bundled themes, and it reloads
as soon as you save. Start from [`examples/themes/dusk.css`](../examples/themes/dusk.css). The
header comment (`@name`, `@id`, `@author`, `@version`, `@description`) is optional. Where the
folder is and how loading works is in [WAILS.md](WAILS.md#themes-from-disk).

## Theme packages

A theme package is a folder. Bundled ones live in `frontend/src/themes/<id>/`. Packages don't load
from disk yet; for now, user themes on disk are single CSS files (see above).

```
themes/adwaita/
  manifest.json
  palette.css          required
  widgets.css
  headerbars.css
  boxed-lists.css
  accent-bubbles.css   off by default
```

`manifest.json`:

```json
{
  "id": "adwaita",
  "name": "Adwaita",
  "version": "0.1.0",
  "author": "WhatsZori",
  "description": "GNOME / libadwaita look",
  "modules": [
    { "id": "palette", "name": "Palette", "file": "palette.css", "required": true },
    { "id": "headerbars", "name": "Header bars", "file": "headerbars.css" },
    { "id": "accent-bubbles", "name": "Accent bubbles", "file": "accent-bubbles.css", "default": false }
  ]
}
```

- `required` modules are always on and get no toggle in Settings → Themes.
- Optional modules are on unless `"default": false`. The user's choices are stored in settings as
  `themeModules["adwaita/headerbars"]`.
- Enabled modules are joined in manifest order into one `<style data-wz-theme="adwaita">` at the
  end of `<head>`. `<html data-wz-themes="adwaita">` lists the active themes.
- A theme may keep its own private variables (Adwaita uses `--adw-*`) and map them onto `--wz-*`.
- Whatever you set on `:root`, also set under `[data-theme='dark']`. Both selectors have the same
  specificity, so a light-only value would leak into dark mode.
- If the user picked an accent, it's set inline on `<html>` and beats the theme's `--wz-accent`.

## Accent and derived colors

Only `--wz-accent` needs to change to re-tint the app. The others are derived with `color-mix()`.

| Variable | Use |
| --- | --- |
| `--wz-accent` | The one accent color: selection, primary button, unread badge, toggles, focus ring |
| `--wz-accent-hover` | Hover state of accent surfaces (derived) |
| `--wz-accent-active` | Pressed state of accent surfaces (derived) |
| `--wz-accent-fg` | Text and icons on top of `--wz-accent` |
| `--wz-accent-soft` | Very light accent tint, e.g. your own reaction pill |
| `--wz-accent-text` | Accent used as text (links, "typing…", quote names); darker/lighter for contrast (derived) |

## Surfaces

| Variable | Use |
| --- | --- |
| `--wz-bg-app` | Window background behind cards (auth screen) |
| `--wz-bg-primary` | Main surfaces: sidebar, headers, composer, settings body |
| `--wz-bg-secondary` | Secondary surfaces: settings nav, notes, banners |
| `--wz-bg-elevated` | Popovers, menus, dialogs, floating buttons |
| `--wz-bg-hover` | Hover overlay for list rows and icon buttons (translucent) |
| `--wz-bg-active` | Selected row (active chat, current settings section), accent-tinted |
| `--wz-bg-input` | Search field, composer, segmented control track |
| `--wz-bg-conversation` | Background behind message bubbles |

## Text

| Variable | Use |
| --- | --- |
| `--wz-text-primary` | Body text, names |
| `--wz-text-secondary` | Less important text, sender prefixes, quote text |
| `--wz-text-muted` | Timestamps, hints, descriptions, placeholders |
| `--wz-text-on-accent` | Alias of `--wz-accent-fg` |

## Borders and elevation

| Variable | Use |
| --- | --- |
| `--wz-border` | 1px hairlines between areas and around cards |
| `--wz-border-strong` | Stronger borders: secondary buttons, kbd hints, scrollbar thumb |
| `--wz-shadow-popover` | The only shadow in the app: menus, popovers, dialogs |
| `--wz-scrim` | Dimmed background behind dialogs |
| `--wz-focus-ring` | Keyboard focus ring (box-shadow value) |

## Bubbles

| Variable | Use |
| --- | --- |
| `--wz-bubble-in` / `--wz-bubble-in-text` | Incoming bubble background and text |
| `--wz-bubble-out` / `--wz-bubble-out-text` | Outgoing bubble, accent-tinted by default |
| `--wz-bubble-in-meta` / `--wz-bubble-out-meta` | Timestamp, "edited" and tick color inside bubbles |
| `--wz-bubble-border` | Faint outline around bubbles |
| `--wz-bubble-deleted-border` | Dashed outline on deleted (anti-delete) messages |
| `--wz-bubble-highlight` | Flash when jumping to a quoted message |
| `--wz-tick-read` | Color of the "read" double tick |

## Status colors

| Variable | Use |
| --- | --- |
| `--wz-danger` / `--wz-danger-soft` | Destructive actions, errors |
| `--wz-warning` / `--wz-warning-soft` | Offline banner |
| `--wz-success` | Online dot |

## Logo

The logo is rendered inline (`<Logo />`), so its lettering follows the app theme. "Whats" uses
`--wz-text-primary`; the rest is set by these variables. Themes may change them, but the mark is
the brand, so keep it recognizable.

| Variable | Use |
| --- | --- |
| `--wz-logo-bubble` | Fill of the message-bubble mark |
| `--wz-logo-sun` | The rising sun in the mark and on the wordmark's Z |
| `--wz-logo-accent` | The "Zori" part of the wordmark (lighter in dark mode) |

## Avatars

Avatars are initials on a tinted circle. The hue comes from the name (9 fixed hues); a theme sets
how saturated and light they are.

| Variable | Use |
| --- | --- |
| `--wz-avatar-saturation` | Saturation of avatar backgrounds |
| `--wz-avatar-lightness` | Lightness of avatar backgrounds |
| `--wz-avatar-text-lightness` | Lightness of the initials |

## Shape, type and spacing

| Variable | Use |
| --- | --- |
| `--wz-radius-sm` / `-md` / `-lg` | 6 / 8 / 12px: buttons, cards, dialogs |
| `--wz-radius-bubble` | Message bubble corners (the "tail" corner is tighter) |
| `--wz-radius-full` | Pills and badges |
| `--wz-font-ui` | System font stack, no web fonts |
| `--wz-font-mono` | Monospace (pairing code, message IDs) |
| `--wz-font-scale` | Text size multiplier, set from settings |
| `--wz-font-size-xs` … `--wz-font-size-xl` | 11 / 12.5 / 14 / 16 / 20px × scale |
| `--wz-line-height` | Base line height |
| `--wz-space-1` … `--wz-space-8` | 4, 8, 12, 16, 20, 24, 32, 40px |

## Layout

| Variable | Use |
| --- | --- |
| `--wz-sidebar-width` | Sidebar width, set inline from the resizer (260–480px) |
| `--wz-header-height` | Sidebar header and conversation header |
| `--wz-chat-item-height` | Chat list row height (comfortable 68px, compact 56px) |
| `--wz-bubble-max-width` | Max bubble width |
| `--wz-message-gap` | Gap between bubbles in a run |
| `--wz-group-gap` | Gap after the last bubble of a run |

## Motion

| Variable | Use |
| --- | --- |
| `--wz-duration-fast` / `--wz-duration` | 120 / 160ms; both become 0 under `prefers-reduced-motion` |
| `--wz-ease` | Standard easing curve |

## Stable class names

Useful hooks for themes (not exhaustive):

- Layout: `.wz-app`, `.wz-sidebar`, `.wz-main`, `.wz-resizer`, `.wz-banner`
- Chat list: `.wz-chat-item`, `.wz-chat-item--active`, `--unread`, `--muted`, `.wz-chat-list__header`
- Conversation: `.wz-conv-header`, `.wz-message`, `.wz-message--in/--out`, `.wz-bubble`,
  `.wz-bubble--in/--out/--tail/--first/--deleted/--unknown`, `.wz-quote`, `.wz-reaction`,
  `.wz-reaction--mine`, `.wz-day`, `.wz-media--image/--video/--document/--voice`
- Composer: `.wz-composer`, `.wz-composer__input`, `.wz-composer__bar`
- Primitives: `.wz-button--primary/--secondary/--ghost/--danger`, `.wz-icon-button`, `.wz-toggle`,
  `.wz-segmented`, `.wz-menu`, `.wz-popover`, `.wz-dialog`, `.wz-badge`, `.wz-avatar`
- Plugin slots render inside `.wz-plugin-slot[data-slot="…"]`.

## Notifications (desktop app, Windows)

WhatsZori's own notifications are a separate small window running the same frontend, so your
theme, accent and user CSS theme apply there too. The cards use these variables, set on
`.wz-ntf-stack`; override them in a theme:

| Variable | Default | |
| --- | --- | --- |
| `--wz-ntf-width` | `360px` | card width |
| `--wz-ntf-bg` | `--wz-bg-elevated` | card background |
| `--wz-ntf-fg` | `--wz-text-primary` | text |
| `--wz-ntf-muted` | `--wz-text-muted` | app name, time |
| `--wz-ntf-border` | `--wz-border` | card and button borders |
| `--wz-ntf-radius` | `12px` | corner radius |
| `--wz-ntf-shadow` | `--wz-shadow-popover` | card shadow |
| `--wz-ntf-accent` | `--wz-accent` | reply field and send button |
| `--wz-ntf-gap` | `8px` | space between stacked cards |

Stable class names for anything else: `.wz-ntf` (card), `.wz-ntf__head`, `.wz-ntf__main`,
`.wz-ntf__title`, `.wz-ntf__body`, `.wz-ntf__actions`, `.wz-ntf__action`, `.wz-ntf__reply`,
`.wz-ntf__input`, `.wz-ntf--summary` (summaries like "12 new messages"). The page has
`html[data-window="toast"]`, if a theme wants to style the toast window differently. Its
background always stays transparent.

Plugins have two slots: `notification.card` replaces the whole card (props: `notification` and
`controls` with `open`, `markRead`, `reply(text)`, `dismiss`; a crashing plugin card falls back
to the stock one), and `notification.accessories` adds something inside the stock card.
