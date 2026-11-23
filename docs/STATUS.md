# Status

Where the whole app stands. [FRONTEND_STATUS.md](FRONTEND_STATUS.md) covers the UI in detail,
[WAILS.md](WAILS.md) how to run and build the desktop app, [BACKEND.md](BACKEND.md) the WhatsApp
side, and [MANUAL_TEST.md](MANUAL_TEST.md) the checklist for a test with a real account.

## Done: WhatsApp backend

Real WhatsApp under the existing UI. **Nothing here has talked to WhatsApp yet**: no account was
available, so it's verified with unit tests, fakes and an offline start of the built app. The live
test is [MANUAL_TEST.md](MANUAL_TEST.md).

All seven priorities of the brief are in. The only cut: **voice note sending**.

- **Full Wails backend**: in the desktop app, every service (auth, chats, messages, profile,
  privacy, contacts, media) is Go. The mock remains for `npm run dev` in a browser and
  `?backend=mock`.
- **Storage**: `session.db` (whatsmeow's sqlstore) and `whatszori.db` (ours, WAL, foreign keys,
  embedded migrations versioned with `user_version`). Plain `database/sql` repos over a `DBTX`
  interface, so ingest writes several tables in one transaction. FTS5 works with
  `modernc.org/sqlite`.
- **Client lifecycle**: connects on start when a session exists, auto-reconnects, and handles
  connected, disconnected, keep-alive timeouts, stream replaced, logged out (from the phone), temp
  bans, client outdated. Connection state drives the existing banner.
- **Login**: real QR codes (rendered with `uqr`) with their countdown, "code expired" with a retry
  button, pairing by phone number with the 8-character code, logout, and logout plus "delete local
  data".
- **Ingest**: text, extended text, image, video, round video, audio, voice, document, sticker,
  location, live location, contact(s), polls (as a preview line), replies, ephemeral and view-once
  unwrapped (by whatsmeow). Unknown types are stored with their raw proto, never dropped.
- **Anti-delete**: revokes keep the content, sender vs admin revoke is recorded, a revoke before
  its message becomes a placeholder that the message fills in later, and "keep deleted messages"
  off really drops the content.
- **Edit history**: version 0 is saved on the first edit, every version after; edits from anyone
  but the sender are ignored; "keep edit history" off keeps only the latest text.
- **Reactions** (add, change, remove, even before their message arrives), **receipts** per
  participant driving pending → sent → delivered → read, **presence** and **typing** in, push
  names, contact names, group info and membership changes, pin / archive / mute / mark-read from
  the phone.
- **History sync** in batches with a progress banner; **LID vs phone number** normalized to one
  chat per person, merging a LID chat when the mapping turns up.
- **Privacy gate**: the only path for presence, typing and read receipts (a test enforces it).
  Hide online, hide typing, read receipts always / never / on-reply.
- **Anti-spam** in front of every send, with toasts explaining a block.
- **Sending**: text, replies with full context info, edit (whatsmeow's edit builder), delete for
  everyone, reactions, typing (through the gate), photos and documents via the paperclip (native
  file dialog). Failed sends turn red and show a toast.
- **Media**: auto-download of photos, voice notes and stickers up to 16 MB, everything else on
  demand. `/wz-media/<pk>` serves the file with Range support, downloads on demand, falls back to
  the thumbnail, and marks CDN 404/410 as expired. Content-hashed file names.
- **New chat** (+ in the sidebar or Ctrl+N): pick from contacts, or type a number with its country
  code; WhatsZori checks it is on WhatsApp and opens the chat.
- **Forward and multi-select**: Forward from the message menu or for several selected messages, to
  up to 5 chats or contacts; forwarded messages show "Forwarded" / "Forwarded many times". Select
  (message menu) turns the composer into a bar with Copy, Forward and Delete (for me, or for
  everyone when all selected are yours). "Delete for me" is also in the message menu.
- **Polls**: question, options with live counts and bars, who voted for what (View votes), and
  voting yourself (single or multiple choice, tap again to take it back).
- **View once**: view-once photos and videos show as a card, open in the viewer as often as you like and can be saved; opening them sends nothing to the sender. When WhatsApp gave the keys only to the phone, the card says so.
- **Voice notes**: record in the composer (mic button), sent as real WhatsApp voice notes (Ogg/Opus, waveform, duration).
- **Tray and unread badge**: closing the window keeps WhatsZori running in the tray (optional), unread chats on the taskbar button (Windows), the dock (KDE, Dash to Dock) and the tray icon.
- **WhatsZori's own notifications on Windows** (default there): themed cards in the corner that never steal focus, reply and mark-as-read inside, restylable by themes (`--wz-ntf-*`) and plugins (`notification.card`, `notification.accessories`). Windows' own toasts are one switch away.
- **Desktop notifications** on Windows and on Linux (GNOME, KDE Plasma and any freedesktop
  notification server): avatar, chat and sender, text or "📷 Photo / 🎤 Voice message", batching,
  a rate limit, one summary after being offline, reply from the notification (Windows, KDE; GNOME
  opens the chat), "Mark as read" (respects ghost mode), taskbar flash. Settings → Notifications:
  on/off, hide sender and text, sound, test.
- **Contact and group info**: photo/video previews; a "Media, links and docs" page with tabs and
  endless scrolling; click a name in a group to open that person; favorites and your own chat
  lists (chips next to All/Unread/Groups); clear chat (local), block/unblock, delete chat (all
  devices), leave group, remove members (admins), membership history, export (HTML / JSON /
  WhatsApp-style TXT with media checkboxes, size limit and dates).
- **Stickers** without a bubble, **GIFs** that loop silently.
- **Not possible with the API** (so not in the UI): reporting contacts or groups, a clear chat
  that syncs to the phone, favorites and lists that sync to the phone, membership changes from
  before the device was linked.
- **Media viewer**: photos and videos open full-window with zoom and pan, previous/next, caption,
  copy to the clipboard (the file, and pictures also as a picture), save as, show in folder, and
  go to message; the same actions are in the message menu. Our own video player (seek with
  preview time, volume, speed, fullscreen, keyboard shortcuts).
- **Video notes** play inline in a circle: silent loop while visible, sound and a progress ring on
  click.
- **Avatars**: profile pictures and group photos in the chat list, chat header, info panel, member
  list and your own profile, with the initials as fallback (no picture, hidden, offline). Cached on
  disk, refreshed daily or when WhatsApp says a picture changed.
- **Search** with FTS5 (prefix matching, any script): typing two or more characters in the sidebar
  search shows matching chats and, under them, matching messages from all chats (newest first,
  click jumps to the message). Ctrl+F or the magnifier in a chat opens search inside it: "1 of N",
  Enter/Shift+Enter or the arrows step through, matches are marked in the bubbles.
- **Frontend**: real QR, toasts (new: there was no toast UI), sync progress in the connection
  banner, real images/video/voice/documents in bubbles, typing notifications from the composer,
  attach button, and the draft comes back when a send is refused.

### How it was checked

- `go vet ./...` and `go test ./...` pass (also `. ./internal/...`). The tests are listed in
  [BACKEND.md](BACKEND.md#tests): ingest built from real `waE2E` protos for every case in the
  brief, repo and migrations on a temp SQLite file, pagination, privacy modes, anti-spam, LID
  normalization, the media handler (Range, traversal), sending, and the login state machine.
- Frontend `typecheck`, `lint` (0 errors, the 2 known TanStack warnings), `test` (50) and `build`
  pass. `check.ts` now compares every DTO and event payload with the generated Go models.
- `wails3 build` succeeds. The built exe started with `WHATSZORI_NO_CONNECT=1` and a scratch config
  folder: it reached the auth screen ("connecting to WhatsApp is turned off" plus a retry button),
  created both databases, answered `/wz-media/` probes with 404, had **no** TCP connections to
  anything outside localhost, and was closed right away. That start didn't show a QR on purpose:
  a QR needs a connection to WhatsApp, which this run wasn't allowed to make.
- The browser mock still works end to end (Edge via Playwright): a real QR renders, logging in,
  opening a chat and sending work, the attach button is disabled, no console errors.

### Known limits

- Delivery receipts (two grey ticks) can't be hidden; WhatsApp requires them.
- Ghost mode covers this computer only. Phone A still sends its own presence and read receipts
  when you use it.
- With "hide online" on you may not get typing notifications from others: WhatsApp only sends chat
  presence to clients that are online.
- History sync only happens when a device is linked. Deleting `whatszori.db` while staying logged
  in means only new messages show up.
- Media that WhatsApp's CDN no longer has (usually after a few weeks) can't be downloaded; only
  the thumbnail shows. Auto-download is what saves recent photos and voice notes.
- Statuses and channels (newsletters) are ignored. Poll votes, pinned messages, view-once
  "opened" markers and disappearing-message timers aren't shown.
- Group read status is "read" only once every member read it, based on the member count we know.
- Reactions and admin deletes in groups that use LID addressing address the sender by phone number
  when we know it; if WhatsApp insists on the LID there, they may fail. Needs the live test.
- "Delete for me" done on the phone is ignored here, on purpose.
- No call handling, no blocking, no group admin actions, no new-chat-by-number flow (the "+"
  button still focuses search).

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
- **Go layout**: `internal/{app,config,boot,settings,events,services,systheme,themes,assets}`,
  with the WhatsApp packages next to them (see [BACKEND.md](BACKEND.md)).
- **Backend selection**: the frontend's `Backend` interface is the only contract. The desktop app
  started in hybrid mode (Go for system bits, mock for WhatsApp) and is now fully Go; in a browser,
  or with `?backend=mock`, it's the pure mock and no Wails code is loaded.
- **Settings in Go**: one JSON file in the config folder, written atomically. It holds theme,
  accent, density, layout, sidebar width and so on. A browser still uses localStorage.
- **System theme**
  - Windows: accent and light/dark from the registry, updated live through
    `RegNotifyChangeKeyValue`.
  - Linux: XDG portal with a `gsettings` fallback.
  - macOS: a light/dark stub.
  - Settings use it for "Use system accent" and the "System" theme.
- **Asset paths** `/wz-themes/`, `/wz-plugins/` and `/wz-media/`, served by the asset middleware
  with traversal and symlink protection.
- **User CSS themes**: listed from the themes folder with their header metadata, enabled in
  Settings → Themes, and hot-reloaded on save (about 100 ms, no unstyled flash). There's a sample
  in `examples/themes/dusk.css`.
- **Safe mode**: a boot sentinel plus `--safe-mode`. In safe mode a banner shows and the (demo)
  plugins stay off.
- **Links** open in the system browser (http(s) and mailto only).
- **Icon**: the bubble logo from `frontend/public/logo.svg`, rendered to `build/appicon.png`, with a Windows `.ico` generated from it.
- **CI**: `.github/workflows/build.yml` builds Windows and Linux on pushes to `main`. It hasn't run
  yet; nothing has been pushed.

## How the desktop shell was checked

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

- **Not tested live**: the whole WhatsApp side. Run [MANUAL_TEST.md](MANUAL_TEST.md) before
  trusting it with your main account.
- Not there yet: calls, blocking, group admin actions,
  starting a chat by number, statuses and channels, poll results.
- The `extensions`, `plugin_settings` and `plugin_storage` tables exist but nothing uses them yet.
- `contacts.list()` exists on both backends but no screen uses it yet (it's meant for a new-chat
  picker).
- Plugins: the folder and `/wz-plugins/` path exist, but nothing loads plugins. Safe mode currently
  only skips the `?demo=1` demo plugins.
- macOS: the system theme is a stub, and there are no build files or CI for it.
- The Linux `gsettings` fallback doesn't update live (the portal does).
- Settings changed less than about 250 ms before closing the window can be lost (the frontend
  batches writes).
- Disk themes are single CSS files. Folder packages with a manifest, like the bundled ones, don't
  load from disk yet.

## Next

1. **Live test** with [MANUAL_TEST.md](MANUAL_TEST.md), then fix what it finds. The LID
   addressing of reactions and admin deletes in groups is the most likely rough spot.
2. Voice note sending (record in the webview, encode to Opus/OGG, upload as PTT).
3. New chat by number or from contacts (`contacts.list()` is ready).
4. A message search results screen (`messages.search` with FTS5 is ready).
5. Show poll results, pinned messages and disappearing-message timers.
6. Plugin loader reading `<config>/plugins`, gated by safe mode, using the plugin tables.
7. Theme packages from disk, and a Playwright smoke test in CI using `WHATSZORI_WEBVIEW_DEBUG_PORT`
   and `WHATSZORI_NO_CONNECT`.
