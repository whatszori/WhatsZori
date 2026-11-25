# Plugins

A plugin is a folder in `<config>/plugins` (Settings → Plugins → Open plugins folder) with a
`manifest.json` and an ES module. WhatsZori lists every folder there. Nothing runs until the user
turns a plugin on and allows what it asks for, and nothing runs at all in safe mode (start with
`--safe-mode`; WhatsZori also starts in safe mode by itself after a start that crashed or hung).

This page is plugin API 2 (WhatsZori 0.2.0). Plugins written for the first API keep working; see
[API 1 plugins](#api-1-plugins).

## Layout

```
plugins/
  weather/
    manifest.json
    index.js
    icon.svg            optional
    signature.json      optional, written by `wz-plugin sign`
```

## The manifest

```json
{
  "id": "weather",
  "name": "Weather",
  "version": "1.0.0",
  "description": "The weather for your city in a panel.",
  "author": "You",
  "homepage": "https://example.com/weather",
  "main": "index.js",
  "icon": "icon.svg",
  "apiVersion": 2,
  "minAppVersion": "0.2.0",
  "permissions": ["network", "composer"],
  "network": ["api.open-meteo.com", "geocoding-api.open-meteo.com"],
  "settings": [
    { "key": "city", "type": "text", "label": "City", "default": "Berlin" }
  ],
  "sandbox": true
}
```

| Field | |
|---|---|
| `id` | Required. The folder name: letters, digits, `.`, `-`, `_`, at most 128 characters. |
| `name`, `version` | Required. `version` like `1.0.0`. |
| `description`, `author` | Shown in Settings → Plugins. |
| `homepage` | `https://` only. |
| `main` | The module, a `.js` or `.mjs` file inside the folder. Default `index.js`. |
| `icon` | A `.png`, `.svg`, `.jpg` or `.webp` inside the folder, shown in the list. |
| `apiVersion` | `2` for everything below. Left out means the first API. |
| `minAppVersion` | The oldest WhatsZori it runs on; older ones show why it can't load. |
| `permissions` | What it needs, from the list below. |
| `network` | The sites `ctx.net.fetch` may reach. Needs the `network` permission. |
| `settings` | A settings form WhatsZori draws for it. |
| `sandbox` | Run in a worker without the page or the network. |

A plugin with a broken manifest (an unknown permission, a site that's too broad, a select without
options, …) still shows in the list, with every reason, and can't be turned on. `wz-plugin
validate` applies the same rules before you ship.

### Permissions

| Permission | What the user reads | Unlocks |
|---|---|---|
| `messages` | Read your messages, search them, and see edits and deletions as they happen | `data.messages`, `messagePage`, `search`, `editHistory`, `changes`; `events.onMessage`, `onEdited`, `onDeleted`; the raw `msg:*` events |
| `contacts` | See your contacts, group members and your own profile | `data.contacts`, `chatInfo`, `me` |
| `media` | Show photos, videos and profile pictures from your chats | `data.mediaUrl`, `avatarUrl` |
| `composer` | Write into the message box and add attachments (you still press Send) | `composer.*`, `actions.insertIntoComposer` |
| `notifications` | Show desktop notifications | `notify` |
| `clipboard` | Copy text and pictures to the clipboard | `clipboard.*` |
| `files` | Save files to your computer, in a place you pick | `files.saveAs` |
| `chats.manage` | Pin, mute and archive chats when you click its buttons (your phone sees this) | `chats.pin`, `mute`, `archive`, only right after a click |
| `presence` | See who is online and who is typing | `events.onTyping`, `onPresence`, `presence` and `chat:typing` |
| `network` | Connect to the internet sites listed below | `net.fetch` |

Everything else (slots, commands, panels, views, the chat list, settings, storage, toasts) needs
no permission.

When the user turns a plugin on, WhatsZori shows these sentences, the sites from `network`, and
whether the plugin is signed. What they allow is stored with the plugin. A later version that
asks for a permission or a site they haven't allowed, or that is signed with a different key,
stays off ("This version asks for more") until they look at it again.

### Network

`network` lists host names: `api.example.com`, `*.example.com` (any subdomain, not the bare
domain) or `localhost:11434`. No `https://`, no paths, no IP addresses, nothing as broad as `*.com`.

The app's page has a Content-Security-Policy (`connect-src 'self'`, `script-src 'self' blob:`), so
`window.fetch`, `XMLHttpRequest`, websockets, `sendBeacon` and `import()` from the internet don't
work for any code in the page, plugins included. Plugins use `ctx.net.fetch`, which goes to Go:

- the address must match the list the user allowed, over https (plain http only for localhost);
- no cookies go out and none come back;
- redirects are followed only within the list, at most five;
- a listed name that resolves to a private or local address is refused, unless the plugin listed
  localhost itself;
- 10 MB per request and per answer, 30 s by default (`timeout`, at most 2 min), six at a time;
- the request carries `User-Agent: WhatsZori/<version> plugin/<id>`.

Pictures and fonts may still load from https (user themes use them), so the policy is a lock on
the easy ways out, not a wall around in-page code. For that, use a sandbox.

### Settings

Each entry becomes a field in Settings → Plugins → Plugin settings:

| `type` | Field | `ctx.settings.get` returns |
|---|---|---|
| `text`, `password`, `textarea` | text box | string |
| `toggle` | switch | boolean |
| `select` | list of `options: [{ value, label }]` | string |
| `number` | number box, with optional `min`, `max` | number |

`default` is returned until the user changes the field. `ctx.settings.onChange((key, value) => …)`
fires on changes from the form and from the plugin itself. `ctx.settings.set` checks values
against the field (a toggle takes a boolean, a select one of its options). Keys that aren't in
the manifest work too, as strings, for plugins that draw their own settings block.

### Sandbox

With `"sandbox": true` the plugin runs in a Web Worker started from a `blob:` URL. Before its code
loads, the worker removes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`,
nested workers, `caches`, `indexedDB`, `BroadcastChannel` and `navigator`; the page's CSP covers
`import()`. What's left is `postMessage` to the page, which only answers the `ctx` calls the
plugin's permissions allow.

The context has the same names, but every call is async and returns a promise, and render
functions return data (`{ t: 'text', text: '…' }`, see `ui` in the SDK) that WhatsZori draws with
its own components. Pictures only come from `data:`/`blob:` URLs or the app's media (with the
`media` permission), links only go to the manifest's sites and open in the browser. Not
available: `React`, `ui.addStyles`, text formatters, editor tools, and `when` on commands. Call
`ctx.invalidate()` after your state changes to draw again. The module must be one file; relative
imports don't resolve in a sandbox.

### Signing

`wz-plugin keygen` makes an Ed25519 key; `wz-plugin build --key <file>` (or `sign`) writes
`signature.json`: the public key and a signature over a digest of every other file in the folder
(a header line, then `<sha256>  <path>` per file, sorted by path). WhatsZori checks it on every
read:

- unsigned: shown as "Unsigned", and the approval dialog says there's no telling who made it;
- signed: shown with the key's fingerprint (`ab2c c269 0383 3ffe`); the key is remembered when the
  user allows the plugin, and a version signed with another key has to be allowed again;
- invalid (a file changed, added or removed after signing, a broken signature file): the plugin
  can't be turned on.

Keys of publishers WhatsZori vouches for (`TrustedPublishers` in `internal/plugins/sign.go`) are
shown by name. The list is empty until there's a marketplace.

## The module

```js
export default {
  async start(ctx) {
    ctx.registerSlot('sidebar.footer', () => ctx.React.createElement('p', null, 'Hello'));
    return () => {}; // optional extra cleanup
  },
};
```

`export default function start(ctx)` and `export function start(ctx)` work too. `start` may be
async. When the plugin stops, everything it registered through `ctx` is removed (slots, event
handlers, commands, panels, views, formatters, editor tools, styles, dialogs), and the function
`start` returned is called.

Use `ctx.React`, the app's own React. A bundled copy of React breaks hooks inside slots. The SDK
does this for you.

## `ctx`

Calls that need a permission throw a `PermissionError` without it.

| | |
|---|---|
| `pluginId`, `apiVersion`, `permissions` | who it is, the API (2), what the user allowed |
| `React` | the app's React |
| `ui.Button`, `IconButton`, `Input`, `MenuItem`, `Toggle`, `Avatar`, `Badge`, `Spinner`, `Segmented`, `Tooltip`, `Dialog`, `Popover` | the app's components, so plugin UI follows the theme |
| `ui.addStyles(css)` | a `<style>` removed with the plugin; use the `--wz-*` variables |
| `ui.openDialog({ title, width, render, footer })` | a dialog; returns `{ close }` |
| `ui.confirm({ title, message, confirmLabel, danger })` | resolves to true or false |
| `ui.showMenu(at, items)` | a menu at an element, a rectangle or `{ x, y }` |
| `registerSlot(name, Component)` | a component in a slot (below) |
| `onEvent(name, handler)` | raw backend events (`src/api/types.ts`, `BackendEvents`) |
| `events.onMessage(fn, { history })` | new messages, sent and received; history from the phone only with `history: true` *(messages)* |
| `events.onEdited`, `onDeleted` | *(messages)* |
| `events.onTyping`, `onPresence` | *(presence)* |
| `events.onChatOpened`, `onThemeChanged` | |
| `commands.register({ id, title, shortcut, keywords, when, run })` | in the palette (Ctrl+Shift+P) |
| `commands.run(id)` | |
| `panels.register({ id, title, icon, button, render })`, `open(id)`, `close()` | a side panel next to the conversation, like Contact info; `render` gets `{ chat, close }` |
| `views.register({ id, title, icon, render })`, `open(id)`, `close()` | a whole screen with an icon in the sidebar (both layouts) |
| `messages.registerFormatter((text, message) => node)` | draw a message's text; the first formatter that returns something wins, null passes |
| `editor.registerTool({ id, label, icon, apply(ctx2d, { width, height }) })` | a one-click step in the photo editor; it's re-run whenever the picture is drawn, so keep it synchronous |
| `actions.openChat(jid)`, `jumpTo(jid, pk)`, `toast(text)`, `openSettings()` | |
| `actions.insertIntoComposer(text)` | *(composer)* |
| `composer.get()`, `set(text)`, `insert(text)`, `reply(pk)`, `addAttachment(blob, name)` | the open chat's message box; attachments go to the preview *(composer)* |
| `chats.pin(jid, on)`, `mute`, `archive` | only right after a click *(chats.manage)* |
| `data.chats()`, `activeChat()` | |
| `data.messages(jid, { before, limit })`, `messagePage(...)` | oldest first, at most 200 per call, page back with the first pk *(messages)* |
| `data.search(query, { jid })`, `editHistory(pk)`, `changes({ kind, before, limit })` | *(messages)* |
| `data.contacts()`, `chatInfo(jid)`, `me()` | *(contacts)* |
| `data.mediaUrl(pk, thumb)`, `avatarUrl(jid, full)` | *(media)* |
| `app.version`, `app.theme()`, `app.layout()` | |
| `notify(title, body)` | a desktop notification, one every 3 seconds at most, only when notifications are on *(notifications)* |
| `clipboard.writeText(text)`, `writeImage(png)` | *(clipboard)* |
| `files.saveAs(blob, name)` | the save dialog; the path, or null *(files)* |
| `net.fetch(url, { method, headers, body, timeout })` | see Network *(network)* |
| `settings.get(key)`, `set`, `all`, `delete`, `onChange` | see Settings |
| `storage.get/set/delete/keys` | the plugin's own strings, up to 1 MB per value |
| `log.info/warn/error` | the console, tagged with the plugin id |

There is no way to send messages. A plugin can fill the message box or add an attachment to the
preview, but sending is always the user's click: WhatsZori doesn't do bulk sending or
auto-replies, which get accounts banned.

### Commands and shortcuts

Commands show up in the command palette (Ctrl+Shift+P) next to WhatsZori's own. A shortcut needs
Ctrl, Alt or Mod (Cmd on a Mac), or is an F key, and can't be one of the app's (Ctrl+K, Ctrl+N,
Ctrl+,, Ctrl+F, Ctrl+Shift+P, Alt+↑/↓, the editing keys); registering one of those throws.

## Slots

| Slot | Props | Where |
|---|---|---|
| `sidebar.header` | none | icons next to the sidebar title |
| `sidebar.footer` | none | under the chat list |
| `chat.header.actions` | `{ chat }` | the open chat's header |
| `chatList.item.badge` | `{ chat }` | next to a chat's name in the list |
| `conversation.banner` | `{ chat }` | a strip above the messages |
| `chatInfo.sections` | `{ chat }` | the contact / group info panel |
| `message.accessories` | `{ message }` | under a message bubble |
| `message.contextMenu` | `{ message, close }` | the message menu (use `ctx.ui.MenuItem`) |
| `mediaViewer.actions` | `{ message }` | the photo / video viewer's top bar |
| `composer.actions` | `{ chatJid, insertText }` | next to the emoji button |
| `attach.preview.actions` | `{ file, replace(blob, name), remove() }` | on the file in the attachment preview |
| `settings.sections` | none | Settings → Plugins → Plugin settings |
| `notification.card` | `{ notification, controls }` | replaces WhatsZori's toast card (first plugin wins) |
| `notification.accessories` | `{ notification }` | inside the stock toast card |

A component that throws is hidden (and logged); the rest of the app keeps working. A plugin whose
`start` throws shows the error in Settings → Plugins.

## Development

`wz-plugin dev` (from the SDK) rebuilds into the plugins folder on every save. WhatsZori watches
that folder and restarts a running plugin when its files change, so there's no need to turn it
off and on.

## API 1 plugins

A manifest without `apiVersion` is a first-API plugin. It gets the `messages` and `composer`
permissions without asking (that's what every plugin had before), and the rest of `ctx` from
above; it can't list permissions, sites or settings. The list shows it as "API 1".

## Examples

- `examples/plugins/quick-replies`: API 1, plain JavaScript, slots, settings and storage.
- `examples/plugins/chat-insights`: API 2 in the page: a panel, a view, a banner, a chat list
  badge, commands, a text formatter, an editor tool, manifest settings and notifications.
- `examples/plugins/weather`: API 2, sandboxed, with the network permission and two sites.

Copy a folder into your plugins folder, then turn it on.
