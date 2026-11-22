# Frontend status

State of `frontend/` after the first build-out. Everything runs against a typed mock backend; there
is no Go code yet.

## How to run

From `frontend/` (PowerShell or any shell):

```
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run lint
npm run test
npm run build        # outputs frontend/dist, base './' for embedding in Wails
npm run format       # prettier
```

Useful URLs:

- `http://localhost:5173/` — normal mode. Log in by clicking the QR code (or wait about 25s), or
  use "Link with phone number" (it auto-links after about 8s).
- `http://localhost:5173/?demo=1` — live demo: incoming messages, typing, edits, deletes and
  reactions every few seconds, demo plugins registered, and a flask button bottom-left with demo
  controls (simulator on/off, fake connection states).
- Login and settings persist in `localStorage` (`wz.mock`). To see the auth screen again, use
  Settings → About → Log out, or clear site data.

All four checks pass: `typecheck`, `lint` (0 errors, 2 expected warnings, see DECISIONS.md),
`test` (33 tests), `build`.

## Done

- **Visual system**: `tokens.css` with light, dark and system themes, accent-derived colors via
  `color-mix()`, compact density, text scale, reduced motion. Documented in
  [THEMING.md](THEMING.md).
- **UI primitives** (`src/ui`): Button, IconButton (aria-label and tooltip), Avatar (muted
  name-based tints), Badge, Toggle, Input, Segmented, Spinner, Tooltip, Popover, Menu
  (arrow keys, Home/End, Esc), Dialog. One shared layer stack, so Esc closes only the topmost
  overlay.
- **Mock backend** (`src/api`): `Backend` interface split into services, plus the event names from
  the brief. `MockBackend` has 50–300ms latency, 40 chats (English, Russian and Japanese names;
  pinned, archived, muted; varied unread), several hundred messages in busy chats, and a showcase
  in "Anna Petrova" and "Design team": links, long text, multi-line text, replies, reactions,
  image, video, document and voice placeholders, a message with 3 versions, deleted-by-sender
  messages (incoming and your own), and an unknown-content deleted placeholder. Outgoing messages
  go pending → sent → delivered → read.
- **Stores** (zustand): connection, chats, messages, settings, ui (view, active chat, persisted
  sidebar width, per-chat drafts with reply/edit state).
- **Auth**: QR card with a fake QR that refreshes every 20s with a countdown, phone pairing with an
  8-character code shown in two monospace groups, and a one-line unofficial-client disclaimer
  whose "Learn more" expands the full text.
- **Main layout**: resizable sidebar (drag, keyboard arrows, double-click to reset, width
  persisted), connection banner only when not connected.
- **Chat list**: virtualized; search (Ctrl+K); All / Unread / Groups filter; pinned section;
  Archived entry and view; typing replaces the preview; sender prefix in groups; ticks on your
  last message; muted icon and muted badge; context menu with pin, archive, mute and mark read;
  arrow-key navigation.
- **Conversation**:
  - Header: status line (online, last seen, typing, members), mute, a more-menu, and a plugin
    slot.
  - Message list: virtualized, starts at the bottom, loads older pages on scroll up without
    jumping. Day separators plus a floating day pill while scrolling. Messages group by sender
    within 5 minutes, with a tail on the last of each run. Sender names in groups.
    Jump-to-bottom button with a new-message count.
  - Bubbles: ticks; clickable "edited" opens the version history. Clicking a reply quote jumps to
    the original and highlights it. Reactions toggle on click; your own is highlighted.
  - Anti-delete: dashed border, dimmed content, and a "Deleted by … · time" footer.
    Unknown-content placeholder.
  - Message menu (right-click or the hover "⋯" button): quick reactions, Reply, Copy, Edit (own
    messages, within 15 minutes), Show edit history, Info dialog, Delete for everyone (with
    confirmation), and a plugin slot.
- **Composer**: auto-grows up to 8 lines. Enter sends, Shift+Enter adds a newline. Up arrow edits
  your last message, Esc cancels reply or edit. Reply/edit bar, per-chat drafts (kept while
  editing and restored after), emoji grid stub, send button that activates when there is text,
  and a plugin slot.
- **Settings**:
  - Appearance: theme, 6 accent presets plus a custom color, "Use system accent" (mocked),
    density, text size, and a live preview.
  - Privacy / ghost mode: hide online, hide typing, read receipts (Always / Never / On reply),
    with the note that delivery receipts can't be hidden.
  - Anti-delete & history: three toggles.
  - Plugins: placeholder list with toggles and an "Open folder" button.
  - Themes: real list from the theme registry. Each theme toggles on/off, and its optional
    modules toggle individually.
  - Marketplace ("Coming soon") and About (version, disclaimer, links, log out).
- **Modular themes** (`src/themes/`): a theme is a folder with `manifest.json` plus CSS modules,
  and the loader injects one `<style>` per enabled theme. The built-in **Adwaita** theme (GNOME /
  libadwaita look) has 5 modules: palette (required), GTK widgets, header bars, boxed lists, and
  accent bubbles (off by default). Screenshots: `screenshots/adwaita-*.png`. Built-in **WinUI**
  theme (Windows 11 / Fluent 2) has 6 modules: palette (required), Fluent controls, navigation
  (selection pills), Mica layout, settings cards, and accent bubbles (off by default).
  Screenshots: `screenshots/winui-*.png`.
- **Plugin core**: typed slot registry, `<PluginSlot>` with a per-entry error boundary, and all 7
  slots placed. `plugin-core/types.ts` is self-contained, ready to move into plugin-sdk. With
  `?demo=1`, a demo plugin adds a header button, a context-menu item, a sidebar footer line and a
  settings block, and a deliberately throwing composer entry that gets hidden while the app keeps
  working.
- **Keyboard**: Ctrl+K, Ctrl+, (toggles settings), Alt+Up/Down (previous/next chat), Esc
  (topmost layer first, then reply/edit, then settings).
- **Screenshots** in [screenshots/](screenshots/): the Adwaita theme (`adwaita-*`), auth, the main view, a chat with deleted and
  edited messages in light and dark, edit history, context menu, delete confirmation, a group chat,
  settings appearance (light and dark) and privacy, and the live demo.
- **Checked in a real browser** (Edge via playwright-core): 16 checks passed. These cover:
  - Alt+Down and Ctrl+K
  - starting at the bottom, loading older messages and keeping the position
  - Up-arrow edit leading to the "edited" label
  - read ticks after sending
  - deleting your own message, which keeps the content and marks it deleted
  - jumping to a quoted message and highlighting it
  - menu arrow navigation and Esc
  - pinning, which moves the chat into the Pinned section
  - accent changing live, and Esc closing settings
  - the simulator producing a live edit or delete

## Mocked or stubbed

- The whole backend (`src/api/mock`). Chats and messages reset on reload; only login, settings and
  ghost mode persist.
- The QR code isn't a real QR. "Use system accent" uses a fixed color (`MOCK_SYSTEM_ACCENT`).
- These buttons do nothing yet: attach, plugin/theme "Open folder", and play on voice/video.
- Media are placeholders sized from the real aspect ratio; no thumbnails yet.
- Emoji picker is a fixed 24-emoji grid.
- Ghost-mode settings are stored but have no effect beyond the mock.
- The plugin list is a hard-coded placeholder; nothing loads plugins yet. Themes load only from
  the bundled `src/themes/` folder, not yet from a user folder on disk.
- Full-text message search exists in the backend (`messages.search`), but there is no search
  results UI. The sidebar search filters chats by name and last message only.

## Next

1. Go/Wails side: implement `Backend` on top of the Wails bindings (`src/api/wails.ts`) and switch
   `api/index.ts` to it. Map whatsmeow events onto `BackendEvents`.
2. Real QR rendering from the whatsmeow payload (a small QR encoder, no network).
3. Send typing/presence through the backend while respecting ghost mode; read receipts on reply.
4. Media: thumbnails, download/open, attach flow, voice playback.
5. Message search results UI (in-chat search, plus global results in the sidebar).
6. Plugin loader: load plugin bundles, build `PluginContext`, settings persistence per plugin.
   Move `plugin-core/types.ts` into plugin-sdk.
7. Themes from disk: have the Go side read the user's themes folder and hand over the same
   `ThemePackage` shape that `themes/registry.ts` builds for bundled themes.
8. Component tests for the message list and composer (React Testing Library), and a Playwright
   smoke test in the repo once CI exists.
9. Push the Windows accent color from Go into the "Use system accent" option.
