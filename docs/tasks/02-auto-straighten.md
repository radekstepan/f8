# Task 2: Auto straighten single-button + toast + revert

## What changed

Auto straighten in the crop inspector is now a **single Auto button** instead of
an Auto pill plus a suggestion panel with separate Revert/Dismiss actions:

- First click runs detection and, when a horizon is found, applies the
  rotation. The button highlights (`.is-active`, `aria-pressed`) with the
  title "Auto-straighten applied — click to revert".
- Clicking the highlighted button **reverts** to the pre-Auto slider value
  through the normal edit path, so the revert stays undoable as its own
  history step.
- When **no horizon is detected** (confidence below
  `STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD`, even after the server fallback),
  nothing is applied and a message flashes **over the photo** through the
  shared `ToolHint` overlay — the same mechanism as the Repair tool hint
  (5s readable + 0.5s fade, outside the scroll stage so the photo never
  shifts). The flash is keyed by detection `runId`, so every attempt flashes.
- A **manual rotate (90° buttons, toolbar, or `r` shortcut) or straighten
  slider move dismisses the assist**, so the button no longer shows as
  toggled after the photo was edited manually. The value stays; undo still
  offers the revert per the usual snapshot/undo conventions.
- Below-threshold results no longer auto-apply with a "low confidence"
  warning — the toast replaces that panel entirely. Inline sidebar errors
  and the ML progress view while estimating are unchanged.

## Decisions

- **Applied state derives from the assist result** (`ready` + angle present +
  `hasStraightenHorizon(confidence)`), not from the local pre-Auto snapshot.
  Any dismiss (manual edit, rotate, revert, photo switch) therefore untoggles
  the button by construction, and the markup is pinnable with the repo's
  SSR-only UI tests. The snapshot stays local and is only consumed by the
  revert click; if a remount drops it while the assist still reports ready,
  the click only clears the highlight and undo covers the value.
- **No-horizon reuses the existing threshold** (`0.25`) via a new
  `hasStraightenHorizon` core helper shared by the Inspector and the App's
  flash derivation, instead of inventing a second cutoff.
- **The flash is gated to the crop tool** so a late result never surprises
  another tool; returning to crop re-shows it until the next slider move or
  photo switch. Errors stay inline in the sidebar (only the no-horizon
  outcome flashes, per the request).
- **Kept the `auto-small straighten-auto` pill** (the e2e spec pins that
  class) and added an `.is-active` style matching the ML gold; the button
  keeps its "Auto" label, gaining `data-testid="straighten-auto"` for tests.
- **No README change**: this simplifies existing UX without changing
  architecture, and the README describes straightening only generically.

## Files

- `packages/core/src/vision/straighten.ts`: `hasStraightenHorizon` helper.
- `packages/ui/src/components/Inspector.tsx`: `StraightenControl` rewritten
  as a single toggle (panel, Revert/Dismiss removed).
- `packages/ui/src/components/PhotoCanvas.tsx`: `straightenFlash` prop
  rendered through `ToolHint` in the crop tool.
- `apps/web/src/App.tsx`: `rotateImage` dismisses the assist; derives
  `straightenFlash` for the canvas.
- `apps/web/src/index.css`: `.auto-small.is-active`; removed dead
  `.straighten-suggestion` / `.suggestion-text` rules.
- Tests: `straighten.test.ts` (+3), `straightenToggle.test.tsx` (new, 5),
  `toolHintOverlay.test.tsx` (+4 flash cases).

## Verification

- `yarn workspace @f8/core test` — 46 files / 774 tests pass.
- `yarn workspace @f8/ui test` — 23 files / 164 tests pass.
- `typecheck` clean for `@f8/core`, `@f8/ui`, `@f8/web` (rebuilt core/ui
  `dist`, which typechecks resolve against).
- Playwright not run (per task rules); the e2e straighten specs only pin the
  kept `.straighten-auto` pill class and the slider.
