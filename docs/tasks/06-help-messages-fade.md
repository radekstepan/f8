# 06 — Help messages fade after a couple of seconds, once per photo visit

## What was done
Canvas tool help messages now stay fully visible for 2.5s after their tool
opens, fade out over 0.5s, and stay hidden until the user navigates away from
the photo and back. All hint variants render through one shared wrapper so
the rule applies uniformly:

- New `ToolHint` wrapper (`packages/ui`) owns the show → fade → gone timer
  and the once-per-visit dismissal record.
- The repair canvas hint (`Click and drag to repair…` plus its Compare /
  ML-warming / ML-blocked variants) now renders inside `ToolHint`.
- Audit: the repair hint in `PhotoCanvas.tsx` is the only `.tool-hint`
  canvas help message in `apps/web` + `packages/ui`; inspector notes
  ("Cropping is non-destructive…"), toasts, and compare labels are
  persistent/event UI, not tool help, so they were left unchanged. Future
  hints get the behavior by using `ToolHint` with their own `hintId`.

Behavior details:
- Timer starts when the tool opens (hint mounts), not on photo load.
- Switching tools away and back within one photo visit does not reshow a
  faded hint; switching photos (or away and back) re-arms every hint.
- Message text can update while visible (e.g. ML warming → ready) without
  restarting the timer.
- Dismissal is recorded when the fade completes, never on mount, so
  StrictMode remounts cannot consume it.

## Files changed
- `packages/core/src/toolHints.ts` (new): `TOOL_HINT_VISIBLE_MS` (2500),
  `TOOL_HINT_FADE_MS` (500, matches the CSS transition),
  `createToolHintTracker()` (per-photo-visit dismissal record).
- `packages/core/src/toolHints.test.ts` (new): 7 Vitest unit tests.
- `packages/core/src/index.ts`: export `toolHints.js`.
- `packages/ui/src/components/ToolHint.tsx` (new): fading hint wrapper.
- `packages/ui/src/index.ts`: export `ToolHint.js`.
- `packages/ui/src/components/PhotoCanvas.tsx`: repair hint renders via
  `<ToolHint photoId hintId="repair">`; added `data-testid="tool-hint"`
  and `role="status"` on the hint element.
- `apps/web/src/index.css`: `.tool-hint` opacity transition +
  `.tool-hint.is-fading` fade-out state.

## Tests added/run
- New: `packages/core/src/toolHints.test.ts` — 7 tests (timing bounds,
  fresh-visit visible, dismiss hides, per-hint independence, new photo
  re-arms, navigate-away-and-back re-arms, cross-photo isolation). Pass.
- Full core suite: 23 files / 452 tests pass.
- Typecheck: `packages/core`, `packages/ui`, `apps/web` all pass
  (rebuilt core `dist` first since `ui` resolves core from build output).
- No component test added: `packages/ui` has no test runner configured
  (Vitest exists only in `core` and `server`); logic is covered in core.

## How to verify
1. Open a photo, select the Repair tool: the hint shows, fades after
   ~2.5s, and is gone after ~3s.
2. Switch to Adjust/Crop and back to Repair: hint stays hidden.
3. Open another photo (or leave and return): hint shows again.
4. Toggle Compare while Repair is open on a fresh visit: the compare hint
   text appears through the same fading wrapper.

## Unresolved items
- None. Note: the workspace contains unrelated uncommitted changes from
  sibling tasks; this task's edits are limited to the files listed above
  and were left uncommitted.
