# Security

WhatsZori holds a linked-device session and your message history, so security bugs matter.

## Reporting

Please don't open a public issue. Report it privately through
[GitHub's security advisories](https://github.com/whatszori/WhatsZori/security/advisories/new).
Include what you found, how to reproduce it, and which version you used. You'll get an answer
within a week.

## What counts

- Reading or changing the session, database or media from outside the user's account
- A theme, plugin folder or file that escapes its folder, or code running without the user turning
  the plugin on
- Anything that sends messages, presence or receipts the user didn't ask for, or that bypasses
  ghost mode
- Secrets or message content ending up in logs

## Good to know

- Everything lives in the config folder (`%AppData%\whatszori` or `~/.config/whatszori`). Anyone
  with access to it can use your WhatsApp session, so treat it like a password.
- Plugins run with the same rights as the app's interface. Only install plugins you trust.
  Starting with `--safe-mode` loads none of them.
