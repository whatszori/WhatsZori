# Changelog

## Unreleased (0.1.0)

The first version that covers daily use.

### Messaging

- Text, replies, reactions, edits, delete for everyone and delete for me
- Photos, videos, video notes, GIFs, documents, stickers, locations, contacts
- Send several photos and files at once from a preview, with a caption each; paste them with
  Ctrl+V or drop them on the chat
- Photo editor before sending: crop, rotate, draw, arrows and shapes, text, blur and pixelate
- Voice notes: record and send, with a waveform
- Polls: results, voters, voting
- Forward to up to five chats; multi-select to copy, forward or delete
- New chat from contacts or by phone number
- Search across chats and inside a chat (Ctrl+F)
- Full emoji picker; make your own stickers and resend ones from chats

### Plugins

- Plugin API 2: plugins ask for permissions and list the sites they connect to, and you allow
  them before they run (and again when an update asks for more or is signed by someone else)
- Plugins reach the internet only through the app, and only the sites you allowed
- Sandboxed plugins that run isolated from the app's page
- Signed plugins: the signer's key is shown, and a plugin whose files changed won't run
- Command palette (Ctrl+Shift+P) with the app's and plugins' commands and shortcuts
- Plugins can add side panels, whole screens, a badge in the chat list, a banner in the chat, a
  block in contact info, buttons in the photo viewer and the attachment preview, their own
  formatting of message text and tools in the photo editor
- Plugin settings forms come from the manifest; plugins reload by themselves when their files
  change

### Privacy

- Anti-delete and edit history, and a Deleted & edited screen
- View-once photos and videos kept
- Statuses kept, deleted ones too, with saving
- Ghost mode: online, typing, read receipts (always / never / on reply), played receipts
- Ghost chats and ghost status viewing (with a prompt when it's off)

### App

- Chat info, members, shared media, favourites, chat lists, block, leave, kick
- Export to HTML, TXT and JSON
- Notifications on Windows, GNOME and KDE, plus WhatsZori's own themeable cards
- Tray icon, unread badge, close to tray
- Themes: CSS files and theme folders with modules, bundled Adwaita, WinUI and Classic Green,
  custom chat wallpaper
- Plugins from the config folder, with settings, storage and safe mode
