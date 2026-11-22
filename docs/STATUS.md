# Status

Where the whole app stands. [FRONTEND_STATUS.md](FRONTEND_STATUS.md) covers the UI in detail, and
[WAILS.md](WAILS.md) covers how to run and build the desktop app.

## Done: desktop shell

Everything in the brief is in; nothing was cut.

- **Wails v3.1 desktop app**: `wails3 dev` and `wails3 build` work on Windows. The frontend is
  embedded in the binary.
- **Window**
  - Native frame, title "WhatsZori", minimum size 900×600.
  - Size, position and maximised state are remembered. A position that's no longer on any screen
    is dropped and the window is centred.
  - No light flash on a dark start.
  - The Windows title bar follows the app theme live.
  - Single instance: a second launch focuses the running window.
- **Go layout**: `internal/{app,config,boot,settings,events,services,systheme,themes,assets}`.
  The WhatsApp packages (`wa/`, `store/`, `ingest/`) can be added next to these without moving
  anything.
- **Hybrid backend**: the frontend's `Backend` interface is still the only contract.
  - In the desktop app, Go handles system, settings, system theme, user themes and the window.
    WhatsApp itself (auth, chats, messages, profile, privacy) is still the mock.
  - In a browser, or with `?backend=mock`, it's the pure mock, and no Wails code is loaded.
- **Settings in Go**: one JSON file in the config folder, written atomically. It holds theme,
  accent, density, layout, sidebar width and so on. A browser still uses localStorage.
- **System theme**
  - Windows: accent and light/dark from the registry, updated live through
    `RegNotifyChangeKeyValue`.
  - Linux: XDG portal with a `gsettings` fallback.
  - macOS: a light/dark stub.
  - Settings use it for "Use system accent" and the "System" theme.
- **Asset paths** `/wz-themes/`, `/wz-plugins/` and `/wz-media/` (404 for now), served by the asset
  middleware with traversal and symlink protection.
- **User CSS themes**: listed from the themes folder with their header metadata, enabled in
  Settings → Themes, and hot-reloaded on save (about 100 ms, no unstyled flash). There's a sample
  in `examples/themes/dusk.css`.
- **Safe mode**: a boot sentinel plus `--safe-mode`. In safe mode a banner shows and the (demo)
  plugins stay off.
- **Links** open in the system browser (http(s) and mailto only).
- **Icon**: neutral "WZ" monogram in `build/appicon.png`, with a Windows `.ico` generated from it.
- **CI**: `.github/workflows/build.yml` builds Windows and Linux on pushes to `main`. It hasn't run
  yet; nothing has been pushed.

## How it was checked

- **Go**: `go vet` and `go test` pass. Tests cover:
  - ABGR → hex, the accent text color, and portal float colors
  - theme header parsing, theme listing, and the debounced watcher
  - path traversal and symlink rejection in the asset handler, and the index rewrite
  - settings round-trip, BOM tolerance, and keeping a broken file
  - the boot sentinel, including that a second instance doesn't write the marker
  - window placement on screens
  - Go/TS event names staying in sync
- **Frontend**: `typecheck`, `lint` (0 errors, the 2 known TanStack warnings), `test` (45) and
  `build` pass.
- **Built Windows exe**: launched and stayed up with nothing in the log beyond the WebView2 info
  line. Driven over CDP with Playwright, these passed:
  - the theme hint injected by Go
  - the disk theme served with no-store
  - traversal getting a 404 inside the webview
  - the live Windows accent applied
  - light/dark switches saved to `settings.json` through Go
  - the disk theme listed in Settings
  - the boot marker cleared
  - no console errors
- **Window behaviour on Windows**:
  - restore after a move and resize
  - an off-screen position gets centred
  - maximised restore keeps the normal bounds underneath
  - a second launch exits in about 90 ms
  - theme hot reload seen live in a screenshot
- **`wails3 dev`**: the app loads through the Vite proxy, Go calls work, no errors, and closing the
  window stops Vite.
- **`npm run dev` in Edge**: the pure mock, Wails code never loaded, no runtime warning, no console
  errors. Same with `?backend=mock`.
- **Linux**: cross-compiles from Windows. The pure-Go packages vet for `GOOS=linux`, and the app
  builds with Wails' `purego` backend. The real CGO build against GTK4/WebKitGTK 6.0 and the
  portal provider have **not** been run on a Linux machine. CI will be the first real test.

## Stubbed or not yet there

- **WhatsApp**: no whatsmeow, login, SQLite or message storage. Chats and messages are the
  frontend mock, regenerated on each start. Profile and ghost mode live in WebView2's localStorage
  through the mock.
- `/wz-media/` always answers 404.
- Plugins: the folder and `/wz-plugins/` path exist, but nothing loads plugins. Safe mode currently
  only skips the `?demo=1` demo plugins.
- macOS: the system theme is a stub, and there are no build files or CI for it.
- The Linux `gsettings` fallback doesn't update live (the portal does).
- Settings changed less than about 250 ms before closing the window can be lost (the frontend
  batches writes).
- Disk themes are single CSS files. Folder packages with a manifest, like the bundled ones, don't
  load from disk yet.

## Next

1. **whatsmeow + SQLite**:
   - `internal/wa` (client, QR/pair login, event handler) and `internal/store` (SQLite: messages
     keyed by our own `pk`, edit history, kept deletes).
   - `internal/ingest` to map whatsmeow events into the store and onto the existing `BackendEvents`
     names.
   - Go services for auth, chats, messages, profile and privacy. Switch them over in
     `WailsBackend` one at a time.
2. Real QR rendering from the whatsmeow payload.
3. Media store behind `/wz-media/<id>` (thumbnails, downloads).
4. Plugin loader reading `<config>/plugins`, gated by safe mode.
5. Theme packages from disk, and a Playwright smoke test in CI using `WHATSZORI_WEBVIEW_DEBUG_PORT`.
