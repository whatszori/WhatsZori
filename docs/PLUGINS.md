# Plugins

A plugin is a folder in `<config>/plugins` (Settings → Plugins → Open plugins folder) with a
`manifest.json` and an ES module. WhatsZori lists every folder there; nothing runs until you turn
a plugin on, and nothing runs at all in safe mode (start with `--safe-mode`; WhatsZori also starts in safe
mode by itself after a start that crashed or hung).

Plugins run inside the app's page with the same rights as WhatsZori's own interface code. Only
install plugins you trust.

## Layout

```
plugins/
  quick-replies/
    manifest.json
    index.js
```

`manifest.json`:

```json
{
  "id": "quick-replies",
  "name": "Quick replies",
  "version": "1.0.0",
  "description": "A composer button that inserts saved replies.",
  "author": "You",
  "main": "index.js"
}
```

- `id` must be the folder name: letters, digits, `.`, `-`, `_`.
- `main` is a `.js` or `.mjs` file inside the folder (default `index.js`). It's loaded with
  `import()` from `/wz-plugins/<id>/<main>`, so it can import its own other files relatively.

A plugin with a broken manifest still shows in the list, with the reason, and can't be turned on.

## The module

```js
export default {
  start(ctx) {
    const h = ctx.React.createElement;
    ctx.registerSlot('sidebar.footer', () => h('p', null, 'Hello from ' + ctx.pluginId));
    return () => {}; // optional extra cleanup
  },
};
```

`export default function start(ctx)` and `export function start(ctx)` work too. `start` may be
async. When the plugin is turned off, every slot and event handler it registered is removed for
it, and the function `start` returned is called.

Use `ctx.React`, the app's own React. A bundled copy of React breaks hooks inside slots. With a
bundler, mark `react` as external and map it to `ctx.React`, or write plain
`React.createElement` code like the example.

## `ctx`

| | |
|---|---|
| `pluginId` | the folder name |
| `React` | the app's React |
| `ui` | `Button`, `IconButton`, `Input`, `MenuItem`, `Toggle`, so plugin UI matches the theme |
| `registerSlot(name, Component)` | add a component to a slot (below); returns an unregister function |
| `onEvent(name, handler)` | backend events (`msg:batch`, `msg:deleted`, `chat:update`, … see `src/api/events.ts`) |
| `actions.openChat(jid)` | open a chat |
| `actions.insertIntoComposer(text)` | add text to the open chat's message box |
| `actions.toast(text)` | show an in-app notice |
| `data.chats()` | the chat list (`jid`, `name`, `isGroup`, `muted`) |
| `data.activeChat()` | the open chat's jid, or null |
| `data.messages(jid, limit?)` | the latest messages of a chat, oldest first (at most 200) |
| `settings.all() / set(key, value) / delete(key)` | small strings (up to 64 KB), stored in `plugin_settings` |
| `storage.get(key) / set(key, value) / delete(key) / keys()` | the plugin's own key-value store, up to 1 MB per value, in `plugin_storage` |
| `log.info / warn / error` | console, prefixed with the plugin id |

There is no way to send messages. A plugin can put text into the message box, but sending is
always the user's click. This is on purpose: WhatsZori doesn't do bulk sending or auto-replies,
which get accounts banned.

## Slots

| Slot | Props | Where |
|---|---|---|
| `sidebar.header` | none | icons next to the sidebar title |
| `sidebar.footer` | none | under the chat list |
| `chat.header.actions` | `{ chat }` | the open chat's header |
| `message.accessories` | `{ message }` | under a message bubble |
| `message.contextMenu` | `{ message, close }` | the message menu (use `ctx.ui.MenuItem`) |
| `composer.actions` | `{ chatJid, insertText }` | next to the emoji button |
| `settings.sections` | none | Settings → Plugins → Plugin settings |
| `notification.card` | `{ notification, controls }` | replaces WhatsZori's toast card (first plugin wins) |
| `notification.accessories` | `{ notification }` | inside the stock toast card |

A component that throws is hidden (and logged); the rest of the app keeps working. A plugin
whose `start` throws shows the error in Settings → Plugins.

## Example

`examples/plugins/quick-replies` uses slots, settings and storage without a build step. Copy the
folder into your plugins folder, then turn it on.
