# Decisions

One line each, with the reason.

- `dev` was created as an orphan branch: the remote repo was empty, so there was no `main` commit to branch from, and committing to `main` was off-limits.
- `MEMORY.md` (personal working notes) is in `.gitignore` so it never lands in the repo by accident.
- Stack versions are whatever was current at scaffold time (Vite 8, TS 6, ESLint 10, Vitest 5); React stays on 18.3 since the brief says 18+ and 18 is the safest WebView2/WebKitGTK baseline.
- `npm run test` goes through `scripts/vitest.mjs`: on Windows a lowercase drive letter in cwd makes Vitest load twice and every suite fails; the wrapper uppercases it.
- Theme accent is stored as a preset id or a custom hex. Presets have a light and a dark variant, so one choice looks right in both themes; a custom hex is used as-is in both.
- Hover, active, soft and bubble-out shades are derived from `--wz-accent` with `color-mix()`, so a theme or the OS only has to set one variable.
- Avatar tints use a fixed set of 9 hues at low saturation (set per theme via `--wz-avatar-*`), which avoids the rainbow look and keeps contrast predictable.
- Tooltip wraps its trigger in an inline-flex span instead of `cloneElement`, to avoid ref juggling that the react-hooks compiler rules flag.
- One global layer stack (`ui/layers.ts`) owns Esc: it listens in capture phase and closes only the topmost menu, popover or dialog, so Esc in the composer only cancels reply/edit when nothing is open.
- Ctrl is matched as Ctrl *or* Cmd, so the same shortcuts work in a future macOS build.
