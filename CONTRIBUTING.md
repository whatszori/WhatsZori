# Contributing

Thanks for wanting to help. A few things keep WhatsZori easy to work on.

## Setup

See [Build from source](README.md#build-from-source). For interface work you rarely need the
desktop shell: `cd frontend && npm run dev` runs the UI in a browser against a mock backend with
demo chats.

To try a desktop build without touching your real account, use a separate config folder and keep
it offline:

```powershell
$env:WHATSZORI_CONFIG_DIR = "$env:TEMP\wz-test"
$env:WHATSZORI_NO_CONNECT = "1"
.\bin\WhatsZori.exe
```

Before opening a pull request, run everything once:

```sh
wails3 task check
```

## Ground rules

- **Never** add bulk sending, broadcasting, auto-replies or anything else that sends without the
  user's click. It gets accounts banned, and it's not what this app is for.
- Presence, typing, read and played receipts only go out through `internal/privacy`. A test fails
  if another package calls them directly.
- Don't log message text, full phone numbers or keys. Use `internal/redact`.
- Frontend: plain CSS on `--wz-*` variables and stable `wz-` class names (themes depend on them),
  TypeScript strict, no UI kits. Design stays minimal and calm.
- Events and DTOs are mirrored between Go and TypeScript. After changing a bound service, run
  `wails3 generate bindings -clean=true -ts -i`. The type checks in `src/api/wails/check.ts` tell
  you what's out of sync.

## Code style

- Good names over comments. Write a short `//` only for a non-obvious reason, a workaround or a
  protocol quirk, written like you're telling a teammate.
- Commit messages: short, imperative, lower case (`add poll voting`, `fix composer losing draft`).
  One logical change per commit.
- Non-obvious decisions go into [docs/DECISIONS.md](docs/DECISIONS.md), user-visible changes into
  [docs/STATUS.md](docs/STATUS.md) and [CHANGELOG.md](CHANGELOG.md).

## Themes and plugins

You don't need to touch the app to share a theme or plugin: see
[docs/THEMING.md](docs/THEMING.md) and [docs/PLUGINS.md](docs/PLUGINS.md). If a theme needs a
variable or class that doesn't exist yet, open an issue.

## Releasing

The version lives in `build/config.yml`, with copies in a few other files. Change all of them at once:

```sh
node scripts/version.mjs set 0.2.0
```

Optionally write the release text in `docs/releases/v0.2.0.md`; without it, GitHub lists the commits. Commit and push to `main`. The `release` workflow sees that `v0.2.0` isn't released yet, runs the checks, builds Windows and Linux, and publishes the release with the files and checksums. Pushes that don't change the version don't release anything.
