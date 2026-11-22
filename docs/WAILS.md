# Desktop app (Wails)

WhatsZori runs as a native desktop app on [Wails v3](https://v3.wails.io) (3.1.0). Go owns the
window, settings, OS integration, the asset paths, and WhatsApp itself (whatsmeow + SQLite, see
[BACKEND.md](BACKEND.md)). The React app in `frontend/` is embedded into the binary.

## Setup

You need Go (see `go.mod`), Node 24+ with npm, and the Wails CLI:

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0
wails3 doctor
```

`go install` puts `wails3.exe` in `%USERPROFILE%\go\bin`. Add that folder to `PATH` if
`wails3` isn't found.

### Windows

Nothing else to install. WebView2 ships with Windows 10/11. The Windows build doesn't use CGO,
so you don't need a C compiler.

### Linux

Wails 3.1 uses **GTK4 + WebKitGTK 6.0** and needs CGO:

| Distro | Packages |
| --- | --- |
| Debian 13+ / Ubuntu 24.04+ | `libgtk-4-dev libwebkitgtk-6.0-dev build-essential pkg-config` |
| Fedora / RHEL | `gtk4-devel webkitgtk6.0-devel gcc-c++ pkgconf-pkg-config` |
| Arch | `gtk4 webkitgtk-6.0 gcc pkgconf` |
| openSUSE | `gtk4-devel webkitgtk-6_0-devel gcc-c++ pkg-config` |

Wails v2 needed the `webkit2_41` build tag on newer distros. That doesn't apply to v3.1: it always
builds against WebKitGTK 6.0, and the GTK3 / webkit2gtk-4.1 stack was removed in 3.1. Older
distros without WebKitGTK 6.0 (Ubuntu 22.04, Debian 12) can't build 3.1.

The system theme provider talks to the XDG desktop portal over D-Bus. It needs no extra
packages, and it falls back to `gsettings` when there's no portal.

## Run and build

From the repo root:

| Command | What it does |
| --- | --- |
| `wails3 dev` | Builds the Go side, starts Vite, opens the app. Go changes rebuild and restart; frontend changes hot-reload through Vite. |
| `wails3 build` | Production build: `bin/WhatsZori.exe` on Windows, `bin/WhatsZori` on Linux. |
| `wails3 package` | Installer: NSIS on Windows (needs `makensis`), AppImage/deb/rpm/AUR on Linux. |
| `wails3 task check` | `go vet` and `go test`, then frontend typecheck, lint and tests. |
| `cd frontend; npm run dev` | The frontend alone in a browser, with the pure mock backend. |

`wails3 dev` and `npm run dev` both default to Vite port 5173. If that port is busy, use
`wails3 dev -port 5198` (or set `WAILS_VITE_PORT`).

The build runs the Taskfiles: `Taskfile.yml`, and `build/Taskfile.yml` plus a per-platform
Taskfile under `build/windows/` and `build/linux/`. The project settings (name, version,
identifiers, and what `wails3 dev` watches) live in `build/config.yml`.

### Bindings

`wails3 build` regenerates the TypeScript bindings for the Go services into `frontend/bindings/`.
They're committed, so `npm run build`, `typecheck` and `lint` work without the Go toolchain. After
changing a bound Go method, run `wails3 generate bindings -clean=true -ts -i` (or just
`wails3 build`) and commit the result.

### Icon

`build/appicon.png` is a 1024 px render of `frontend/public/logo.svg`. The build turns it into `build/windows/icon.ico`
(`wails3 task common:generate:icons`).

## Where things live

The config folder is `os.UserConfigDir()` + `whatszori`:

| OS | Path |
| --- | --- |
| Windows | `%AppData%\whatszori` (e.g. `C:\Users\you\AppData\Roaming\whatszori`) |
| Linux | `$XDG_CONFIG_HOME/whatszori`, usually `~/.config/whatszori` |
| macOS | `~/Library/Application Support/whatszori` |

Inside it:

```
settings.json    app settings ("app"), ghost mode ("privacy"), window state ("window"); written atomically
session.db       whatsmeow's own store: keys and device (never touched by our migrations)
whatszori.db     our chats, messages, edit history, reactions, receipts, media index
boot.pending     exists while a start hasn't been confirmed yet (see safe mode)
themes/          user CSS themes, served at /wz-themes/
plugins/         plugin folders, served at /wz-plugins/<id>/ (nothing loads them yet)
media/           downloaded and sent attachments, served at /wz-media/<pk>
```

Set `WHATSZORI_CONFIG_DIR` to use a different folder, for example to try a build without
touching your real settings. WebView2 keeps its own data (localStorage, cache) in
`%AppData%\WhatsZori.exe`.

### Flags and environment

| | |
| --- | --- |
| `--safe-mode` | Start in safe mode on purpose. |
| `WHATSZORI_CONFIG_DIR` | Override the config folder. |
| `WHATSZORI_NO_CONNECT` | Set to `1` to keep the WhatsApp client offline (no QR, no reconnect). For smoke tests and UI work without talking to WhatsApp. |
| `WHATSZORI_WEBVIEW_DEBUG_PORT` | Opens the WebView2 DevTools protocol on that port, so Playwright can drive the real app with `chromium.connectOverCDP('http://127.0.0.1:<port>')`. Windows only. |

## Go layout

```
main.go                 embeds frontend/dist, loads config, runs the app
internal/
  app/                  wiring, window creation, window state, single instance, title bar
  config/               config paths, folder creation, --safe-mode
  boot/                 boot sentinel (safe mode detection)
  settings/             JSON key-value store with atomic writes
  events/               event names, registration, Emitter wrapper around app.Event.Emit
  services/             what the frontend calls: System, Settings, SystemTheme, Themes, Window
  systheme/             OS accent and light/dark: windows, linux (portal/gsettings), darwin stub
  themes/               CSS theme listing, header parsing, fsnotify watcher
  assets/               middleware for /wz-themes/, /wz-plugins/, /wz-media/
  core/ wa/ ingest/ privacy/ antispam/ media/ store/ domain/ redact/
                        the WhatsApp side, see BACKEND.md
```

## How the frontend talks to Go

The frontend has one contract, the `Backend` interface in `frontend/src/api/backend.ts`.
`src/api/index.ts` picks an implementation when the app starts:

- **Desktop app** (the WebView2 / WebKit message bridge is present): `WailsBackend` from
  `src/api/wails/`. Every service is Go, and every event comes from Go through `Events.On`.
- **Plain browser** (`npm run dev`), or any URL with `?backend=mock`: the pure `MockBackend`.
  The Wails code is a separate lazy chunk and is never loaded.

Settings: in the desktop app, `AppSettings` (theme, accent, density, layout, sidebar width, theme
choices, …) is stored by Go under the `app` key of `settings.json`. On the first start, the
desktop app takes over whatever the mock had in localStorage. In a browser, the mock keeps using
localStorage.

Events: the binding generator types method parameters and return values, and it also emits typed
event names (`frontend/bindings/events`). The payload types used by the app are hand-written in
`src/api/events.ts`. Two checks keep them in sync:

- `internal/events/events_test.go` checks that every Go event name appears in `events.ts`, and
  the other way round.
- `src/api/wails/check.ts` fails `tsc` if a DTO or payload type's keys stop matching the
  generated models, or the event names stop matching what Go registered.

| Event | Payload | When |
| --- | --- | --- |
| `wz:systheme:changed` | `SystemPalette` | OS accent or light/dark changed |
| `wz:theme:changed` | `{ file, hash }` | a CSS file in `themes/` was written or removed (`hash` empty) |

The WhatsApp events (`auth:*`, `conn:state`, `msg:*`, `chat:*`, `presence`, `sync:progress`,
`toast`) are listed in [BACKEND.md](BACKEND.md#events).

### System theme

`SystemTheme.Get()` returns `{ source, scheme, accent, accentFg, raw }`.

- **Windows**: reads the accent from `HKCU\Software\Microsoft\Windows\DWM\AccentColor` (ABGR) and
  light/dark from `...\Themes\Personalize\AppsUseLightTheme`. It watches both keys with
  `RegNotifyChangeKeyValue`.
- **Linux**: reads `color-scheme` and `accent-color` from the XDG portal (`ReadOne`, falling back
  to `Read`) and listens for `SettingChanged`. Without a portal it falls back to `gsettings`
  (GNOME), which doesn't update live. Without a session bus it returns `none` and doesn't hang.
- **macOS**: light/dark only, read from `defaults` (a stub).

"System" in Appearance → Theme and "Use system accent color" use this data and update live. In a
browser, the scheme comes from `prefers-color-scheme` and the accent is a fixed stand-in.

### Window

- Native frame, minimum size 900×600, default 1200×780.
- Size, position and maximised state are saved on close. On start, a saved position is used only
  if enough of the title bar would land on a connected screen; otherwise the window is centred.
- Before any CSS loads, the index page gets `data-theme` on `<html>`, and the native window
  background is set from the last reported page background, so there's no light flash in dark
  mode.
- The Windows title bar follows the app theme (not the OS) and updates live.
- A second launch focuses the running window and exits.

### Safe mode

At startup Go writes `boot.pending`. About 4 seconds after the UI mounts, the frontend calls
`System.BootOK()`, which deletes it. If the file is still there on the next start, that start is
in safe mode:

- `IsSafeMode()` returns true.
- A banner explains what happened.
- Plugins stay off (today only the `?demo=1` demo plugins).

The next start after a confirmed one is normal again. `--safe-mode` forces safe mode. Closing the
app within the first few seconds also counts as an unconfirmed start, on purpose.

## Themes from disk

1. Settings → Themes → **Open themes folder** (or open `<config>/themes` yourself).
2. Drop a `.css` file in, for example [`examples/themes/dusk.css`](../examples/themes/dusk.css).
3. It shows up under "From your themes folder". Turn it on. One file theme is active at a time,
   on top of any built-in themes.
4. Edit the file and save. The app picks the change up within about 100 ms and swaps the
   stylesheet without reloading.

The header comment is optional but recommended:

```css
/**
 * @name Dusk
 * @id dusk
 * @author You
 * @version 0.1.0
 * @description Warm greys with a muted amber accent.
 */
```

Without it, the file name is used. The theme is loaded as a `<link>` at the end of `<head>`, so
it wins over the base tokens and built-in themes at equal specificity. Files next to it, such as
`themes/dusk/bg.png`, can be referenced with relative URLs. See [THEMING.md](THEMING.md) for the
variables.

## Asset paths

The asset middleware handles these paths before the embedded frontend (or the Vite proxy in dev).
There is no separate HTTP server:

| Path | Serves |
| --- | --- |
| `/wz-themes/<file>` | `<config>/themes/<file>`, with no-cache headers |
| `/wz-plugins/<id>/<file>` | `<config>/plugins/<id>/<file>` |
| `/wz-media/<pk>` | a message's attachment from `<config>/media` (Range requests, download on demand, thumbnail fallback; see BACKEND.md) |

Paths are checked before they reach the disk:

- Rejected: `..`, absolute paths, backslashes, drive letters and `:` streams, trailing dots,
  Windows device names.
- Files are then opened through `os.Root`, so a symlink can't escape the folder.
- Content types come from a fixed table, not the Windows registry.
