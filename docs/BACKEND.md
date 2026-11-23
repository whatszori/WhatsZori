# WhatsApp backend

How the Go side talks to WhatsApp, stores what it gets, and feeds the UI. For the desktop shell
(window, themes, asset paths) see [WAILS.md](WAILS.md); for why things are the way they are see
[DECISIONS.md](DECISIONS.md).

## Package map

```
internal/
  core/        wires everything below together; Start/Stop, policy from settings, Wipe
  wa/          whatsmeow wrapper
    client.go    Client interface (+ PresenceTransport) and the *whatsmeow.Client adapter
    session.go   session.db (whatsmeow sqlstore), client factory, SynchronousAck
    manager.go   lifecycle: connect on start, QR and phone-code login, logout, conn events
    jid.go       canonical JIDs (LID vs phone number), learning new mappings
    send.go      text, reply, edit, revoke, react, photo/document; pending -> sent/failed
    log.go       whatsmeow logs -> slog, digits masked, debug dropped
  ingest/      whatsmeow events -> whatszori.db -> frontend events
    ingest.go    messages, revokes (anti-delete), edits, reactions, receipts, presence,
                 contacts, groups, chat flags
    history.go   history sync blobs
    content.go   what to store from a waE2E.Message
    reads.go     pending read receipts for the privacy gate
  privacy/     the only way out for presence, typing and read receipts (ghost mode)
  antispam/    rate limits in front of every send
  media/       downloads into <config>/media, /wz-media/<pk> handler
  avatar/      profile pictures and group photos in <config>/avatars, /wz-avatar/<jid> handler
  store/       opens whatszori.db, embedded migrations (store/migrations/*.sql)
    repo/        queries; every function takes a DBTX (*sql.DB or *sql.Tx); views.go builds DTOs
  domain/      DTOs the frontend sees (mirror of frontend/src/api/types.ts)
  events/      event names, Wails registration, the batching emitter
  redact/      phone-number masking for logs
  services/    Wails-bound services: Auth, Chats, Messages, Profile, Privacy, Contacts
               (plus the shell ones: System, Settings, SystemTheme, Themes, Window)
```

`wa` doesn't import `ingest`, `privacy` or `antispam`. The sender gets them as small interfaces
(`SendGate`, `Limiter`, `Local`, `MediaSaver`), which keeps the import graph acyclic.

## Data flow

Incoming:

```
WhatsApp ── whatsmeow ── wa.Manager.handle ──> ingest.Handle ──> SQLite (one transaction)
                          (conn/auth state)          │
                                                     └─ after commit ─> events.Batcher ─> Wails ─> UI stores
```

1. whatsmeow decrypts a stanza and calls our handler on its event goroutine.
2. `wa.Manager` reacts to connection events (connected, disconnected, logged out, stream
   replaced) and passes everything to `ingest.Handle`.
3. Ingest normalizes JIDs, writes to `whatszori.db` in one transaction, and only then queues the
   frontend events. `SynchronousAck` is on, so whatsmeow acks the stanza after our handler
   returned; on a db error the handler reports failure and the server redelivers.
4. The batcher flushes every 50 ms (or at 200 items), merging `msg:batch` events and coalescing
   `chat:update` per chat. History sync can produce thousands of messages; the UI gets a few
   dozen events.
5. The frontend's `bindBackendEvents` (`src/stores/bind-events.ts`) puts them into the zustand
   stores.

Outgoing (`Messages.SendText` and friends):

```
UI ─> services.Messages ─> wa.Sender: connected? ─> antispam.Allow ─> privacy.BeforeSend
                                      ─> store as pending ─> return DTO
                                      └─ background: whatsmeow.SendMessage ─> sent | failed (+ toast)
receipts later ─> ingest ─> delivered / read ─> msg:status
```

Edits, revokes and reactions are sent synchronously and then applied locally through the same
ingest code an incoming one would use (`ApplyLocal*`), because whatsmeow doesn't echo what we send.

Presence, typing and read receipts only leave through `privacy.Gate`, which applies ghost mode.
`MarkRead` from the UI ("user opened this chat") clears the local unread count, then asks the gate
whether to send receipts.

### Events

Names live in `internal/events/events.go` and `frontend/src/api/events.ts` (a Go test checks both
directions); payload types are Go structs in `internal/domain` and TS types in
`frontend/src/api/types.ts` (`src/api/wails/check.ts` fails `tsc` if their keys drift).

| Event | When |
| --- | --- |
| `auth:qr` | a new QR code (with its lifetime in ms) |
| `auth:state` | logged-out / qr / pairing / logging-in / logged-in, with `me` |
| `auth:error` | a login attempt ended (code expired, linking failed) |
| `conn:state` | connected / connecting / reconnecting / offline |
| `msg:batch` | new or changed messages (including filled-in placeholders) |
| `msg:status` | pending → sent → delivered → read, or failed |
| `msg:edited` | new text, edit time, edit count |
| `msg:deleted` | revoked; `purged` when "keep deleted messages" is off |
| `msg:reaction` | the message's full reaction list |
| `chat:update` | a chat snapshot (name, flags, unread, last message) |
| `chat:removed` | a LID chat was merged into the phone-number chat |
| `avatar:changed` | a profile picture or group photo changed; the UI reloads it |
| `presence` | online / last seen for a contact |
| `chat:typing` | someone is typing in a chat |
| `sync:progress` | history sync percentage |
| `toast` | something the user should know (send failed, logged out from the phone, …) |

## The two databases

Both are SQLite files in the config folder, opened with `modernc.org/sqlite` (pure Go).

**`session.db`** is whatsmeow's `sqlstore`: device identity, Signal keys and sessions, app state
keys, LID ↔ phone-number mappings, contact names from the phone. whatsmeow creates and upgrades it;
our migrations never touch it. Deleting it logs this computer out (the phone still lists the old
device until you remove it there).

**`whatszori.db`** is ours: WAL, `foreign_keys=ON`, `busy_timeout=5000`, immediate transactions.
The schema is `internal/store/migrations/*.sql`, applied in order, each in a transaction with
`PRAGMA user_version`.

| Table | What |
| --- | --- |
| `chats` | one row per canonical JID: name, flags (pinned, archived, `muted_until`), unread, last activity, group description and creator |
| `contacts` | names from the address book, push names, business names, about; `lid` links a LID to the phone-number row |
| `group_participants` | members and admin flags |
| `messages` | `pk` is ours; `(chat_jid, msg_id)` is unique. Body, kind, quoted id, status, `read_sent`, anti-delete columns (`is_deleted`, `deleted_at`, `deleted_by`, `delete_kind`, `is_placeholder`), edits (`edit_count`, `edited_at`), and `raw` (the unwrapped `waE2E.Message` protobuf) |
| `message_edits` | every version of an edited message; version 0 is the original |
| `media` | everything needed to download later (`media_key`, `direct_path`, hashes), thumbnail, `local_path`, state (`remote`, `local`, `expired`, `failed`) |
| `reactions` | one per (message, sender); keyed by WA ids so early reactions aren't lost |
| `receipts` | delivered / read / played per participant |
| `avatars` | per JID and size (preview / full): WhatsApp's picture id, the cached file, `set` / `none` / `hidden`, when we last asked |
| `messages_fts` | FTS5 index over `messages.body`, kept in sync by triggers |
| `extensions`, `plugin_settings`, `plugin_storage` | reserved for the plugin system, unused so far |

Settings are not in SQLite. They stay in `settings.json`: `app` is the frontend's `AppSettings`
(Go reads `history.keepDeleted`, `keepEditHistory` and `autoDownloadMedia` from it), `privacy` is
ghost mode, `window` is the window state.

## Where files live

The config folder is `%AppData%\whatszori` on Windows, `~/.config/whatszori` on Linux
(`WHATSZORI_CONFIG_DIR` overrides it).

```
settings.json     app settings, ghost mode, window state
session.db*       whatsmeow: keys and device (plus -wal / -shm)
whatszori.db*     our chats, messages, edits, reactions, receipts, media index (plus -wal / -shm)
media/ab/abcd….jpg  downloaded and sent attachments, named by the SHA-256 of their content
avatars/abcd….jpg   profile pictures and group photos, named by content hash
themes/, plugins/ see WAILS.md
```

`/wz-avatar/<jid>` serves a profile picture or group photo (`?full=1` for the big one). WhatsApp is
asked at most once a day per JID and size (sending the known picture id, so an unchanged picture
isn't downloaded again), at most three at a time, and again right away when a `Picture` event says
it changed. "No picture" and "hidden from you" are cached too. 404 means "show initials".

`/wz-media/<pk>` serves a message's attachment: the local file with Range support (video, voice),
a download on demand if it isn't local yet, and the stored thumbnail while the full file can't be
had (`?thumb=1` asks for the thumbnail directly).

## Wiping local data

- **From the app**: Settings → About → Delete local data. It logs out, then empties every table in
  `whatszori.db` and deletes `media/` and `avatars/`. Plain "Log out" keeps everything.
- **By hand** (app closed):
  - Only messages and media: delete `whatszori.db*` and `media/`. You stay logged in; history sync
    won't run again for an existing session, so only new messages show up.
  - Log this computer out: delete `session.db*`, and remove the device under Linked devices on the
    phone.
  - Everything: delete the whole config folder.

## Running without WhatsApp

`WHATSZORI_NO_CONNECT=1` keeps the client offline: no QR, no reconnect, nothing leaves the machine.
The auth screen says why. Useful for UI work against an existing `whatszori.db`, and for smoke
tests of a build.

## Tests

`go test ./internal/...` runs without a network or an account:

- `store/repo`: migrations from scratch and on reopen, refusing a newer db, idempotent inserts,
  keyset pagination across equal timestamps, FTS5 search (prefixes, Cyrillic, injection), LID merge.
- `ingest`: built from `events.Message` values with real `waE2E` protos — a normal message,
  replies, media, unknown types, revoke after and before the original, admin revoke, purge, an edit
  chain of 3 versions, an edit from the wrong sender, reactions added/changed/removed (and before
  their message), receipts, read-self, a history sync batch, LID chats folding into phone numbers.
- `wa`: canonical JIDs and mapping learning; sending (reply context, failure, on-reply receipts,
  anti-spam before storage, edit/revoke/react stanzas, the edit window); the manager's QR flow,
  `NO_CONNECT`, and a remote logout.
- `privacy`: every ghost mode with a fake transport, plus the AST check that nothing else calls the
  presence methods.
- `antispam`, `media` (Range, traversal, on-demand download, expiry, dangerous types), `events`
  (batcher, name sync), `redact`.
