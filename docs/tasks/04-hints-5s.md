# Task 04 — Tool hints stay readable for 5s

## Which hints

The canvas `ToolHint` help messages (`packages/ui/src/components/ToolHint.tsx`),
currently the repair-tool hint rendered by `PhotoCanvas`. Timing lives in
`packages/core/src/toolHints.ts` (`TOOL_HINT_VISIBLE_MS` /
`TOOL_HINT_FADE_MS`); the fade transition is `.tool-hint` in
`apps/web/src/index.css`.

## What changed

- `packages/core/src/toolHints.ts`
  - `TOOL_HINT_VISIBLE_MS`: 2500 → 5000. `TOOL_HINT_FADE_MS` stays 500.
  - Doc comments now spell out the breakdown: 5s fully readable + 0.5s
    fade-out = 5.5s total on screen.
- `packages/ui/src/components/ToolHint.tsx`
  - Comment updated to the new timing. No logic change: the component
    already drives both timers off the shared constants, so every hint
    surface (current and future) picks up the new duration automatically.
- `packages/core/src/toolHints.test.ts`
  - Timing test now pins the exact values (visible 5000, fade 500, total
    5500) instead of the old range assertion. Tracker tests unchanged.
- No CSS change: `.tool-hint` already transitions opacity over 0.5s,
  matching `TOOL_HINT_FADE_MS`.

## Decisions

- **5s readable + 0.5s fade (5.5s total), not 5s total.** The task asks for
  reading time, and only the fully-opaque window is comfortably readable;
  shaving the fade down or folding it into the 5s would buy nothing, so
  the readable portion grew from 2.5s to 5s and the fade stays as-is.
- **App-level notify toasts untouched.** `apps/web/src/App.tsx` has a
  separate 3.6s auto-dismiss toast for action feedback; it is user
  dismissible, has no fade phase, and is not the "2.5s + 0.5" hint timing
  the task names, so it is out of scope.

## How verified

- `node ../../node_modules/vitest/vitest.mjs run src/toolHints.test.ts`
  (core) — 7 pass, incl. the updated exact-timing test.
- `yarn typecheck` (turbo, all workspaces) — passes.
- Playwright was not run (per task instructions).
