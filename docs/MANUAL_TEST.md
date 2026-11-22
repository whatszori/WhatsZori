# Manual test with a real account

Everything below needs a real WhatsApp account and a second phone (or a friend). None of it was run
during development, only the unit tests in [BACKEND.md](BACKEND.md#tests). Tick things off as you
go and note anything odd next to the step.

You need:

- **Phone A**: your account, the one you link WhatsZori to.
- **Phone B**: a second account that chats with you. A group with A, B and ideally a third person
  helps for the group steps.
- A fresh build: `wails3 build`, then `bin\WhatsZori.exe`.

Use a separate config folder for the test, so your real one stays clean:

```powershell
$env:WHATSZORI_CONFIG_DIR = "$env:TEMP\wz-live-test"
.\bin\WhatsZori.exe
```

Logs go to the terminal you started it from. They should show message IDs and event types, never
message text or full phone numbers. Keep an eye on that throughout.

## 1. Log in with a QR code

- [ ] The auth screen shows a real QR code with a countdown, and it changes when the countdown ends.
- [ ] On phone A: Settings → Linked devices → Link a device, scan. The app shows "Linking and syncing
      your chats…", then the main screen.
- [ ] Phone A lists the new linked device as **WhatsZori**.
- [ ] Wait out a QR without scanning (about 2–3 minutes in total): the screen says the code expired
      and offers **Get a new code**, which works.

## 2. History appears

- [ ] A "Syncing chats from your phone… N%" banner shows up and goes away when done.
- [ ] Your recent chats appear with names (not just numbers), last message previews, unread counts,
      and pinned / archived / muted state matching the phone.
- [ ] Open a busy chat and scroll up: older messages load without jumping.
- [ ] Groups show their name, and the info panel lists members with admins marked.
- [ ] One person doesn't appear twice (once as a number, once as a name). If they do, note which
      chat; that's the LID / phone-number merge.

## 3. Receive

- [ ] From B, send a text. It appears within a second or two, the chat jumps to the top with an
      unread badge (if it isn't open).
- [ ] B sends a photo, a voice note, a document, a location, a contact, a poll, a sticker. Each shows
      as something sensible (photo/sticker render, voice plays, document saves, location/contact/
      poll as a text line).
- [ ] B replies to one of your messages: the quote shows above it, and clicking it jumps to the
      original.
- [ ] B types: "typing…" shows in the chat header and the chat list.

## 4. Anti-delete

- [ ] B sends "delete me", then deletes it for everyone. In WhatsZori it stays, marked
      "Deleted by B · time", with the text still readable.
- [ ] B sends a photo, waits a few seconds, deletes it for everyone. The photo still shows (it was
      auto-downloaded).
- [ ] In a group, have an admin (not the sender) delete someone else's message for everyone. It's
      kept and marked as deleted by the admin.
- [ ] Settings → History → turn off "Keep deleted messages". B sends and deletes another message:
      now it shows only as deleted, without the text. Turn the setting back on.
- [ ] Contact info panel → "Kept by WhatsZori" counts go up.

## 5. Edit history

- [ ] B sends a message and edits it 2–3 times. The bubble updates each time and shows "edited".
- [ ] Click "edited": the popover lists the original and every version, oldest first.
- [ ] Restart WhatsZori: the history is still there.

## 6. Reactions

- [ ] B reacts to one of your messages: the reaction appears. B changes it: it changes. B removes
      it: it's gone.
- [ ] You react to B's message from WhatsZori: B's phone shows it. Click the same emoji again: it's
      removed on B's phone too.

## 7. Send, reply, edit, delete

- [ ] Send a text to B. The ticks go: clock (pending) → one tick (sent) → two ticks (delivered) →
      blue/accent (read, once B opens the chat). In a group, read once everyone has read it.
- [ ] Reply to a message of B's: B's phone shows it as a reply with the quote.
- [ ] Edit your message (right click → Edit, or Up arrow on an empty composer): B sees the edit.
- [ ] Delete your message for everyone: B sees "This message was deleted". WhatsZori keeps it,
      marked deleted by you.
- [ ] Attach a photo (paperclip): it arrives on B's phone as a photo. Attach a PDF: it arrives as a
      document with the right name.
- [ ] Messages you send from phone A show up in WhatsZori too, with ticks.
- [ ] Pin, archive and mute a chat in WhatsZori: phone A follows. Do the same on the phone:
      WhatsZori follows.
- [ ] Anti-spam sanity: paste the same 20-character text into 5 different chats quickly. The 5th
      is refused with a toast explaining why, and the text stays in the composer. Normal chatting
      never triggers it.

## 8. Ghost mode

Settings → Privacy. Check each from phone B, which is the "other person". Turn each back off after.

- [ ] **Hide online**: on. On phone B, open your chat: the header never says "online" while
      WhatsZori is open and phone A is locked and idle. (Phone A itself shows you online when you
      use it; that's out of WhatsZori's hands.)
- [ ] **Hide typing**: on. Type in WhatsZori: B never sees "typing…". Off: B sees it.
- [ ] **Read receipts: Never**. B sends a message; open the chat in WhatsZori. B's ticks stay grey
      (delivered). The unread badge in WhatsZori still clears.
- [ ] **Read receipts: On reply**. B sends two messages; open the chat: still grey on B's phone.
      Send a reply: B's earlier messages turn blue right before your reply arrives.
- [ ] **Read receipts: Always**. Opening the chat turns B's ticks blue.
- [ ] Known limits, not bugs:
  - Delivery receipts (two grey ticks) can't be hidden; WhatsApp requires them.
  - Phone A sends its own read receipts and presence when you use it; ghost mode only covers this
    computer.
  - If "read receipts" is off in phone A's WhatsApp privacy settings, nobody gets blue ticks anyway.

## 9. Media

- [ ] With "Download media automatically" on, a photo or voice note from B is saved right away:
      check `media\` in the config folder.
- [ ] A video from B: thumbnail first, plays on click, seeking works (Range requests).
- [ ] A document from B: clicking it saves the file with its original name.
- [ ] An old photo from history (weeks back) either loads or shows its thumbnail; no broken image.
- [ ] Turn auto-download off: new photos still load when you open the chat (downloaded on demand).

## 10. Connection

- [ ] Turn Wi-Fi off: the banner says "Connection lost. Reconnecting…". Back on: it clears, and
      messages sent meanwhile arrive.
- [ ] Start a second copy of the app with the same config folder: it just focuses the first one.

## 11. Log out and back in

- [ ] Settings → About → Log out. Back to the QR screen. Phone A no longer lists the device.
- [ ] Log in again (QR): your previous history in WhatsZori is still there, including kept deleted
      messages and edit history.
- [ ] Log out from **phone A** instead (Linked devices → WhatsZori → Log out): WhatsZori goes to the
      QR screen with a note that it was logged out from the phone, and keeps the local history.
- [ ] Log in with **phone number**: "Link with phone number instead", enter phone A's number,
      type the 8-character code on phone A (Linked devices → Link with phone number instead).
- [ ] Settings → About → Delete local data → confirm: logged out, no chats after logging in again
      (until history sync refills them), and `media\` is empty.

## When something's off

Note the step, the time, and the log lines around it. Message IDs in the log can be matched to
`messages.msg_id` in `whatszori.db` (any SQLite browser opens it; close the app first or open it
read-only).
