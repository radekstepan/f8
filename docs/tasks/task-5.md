# Task 5: Repair-mode drag no longer lags the red patch behind the cursor

Task: When I am in repair mode and drag around the UI, you see a bit
of a lag between me drawing and the red "patch" appearing in the UI.

## What changed

- `packages/ui/src/components/PhotoCanvas.tsx`
  - The main render-pipeline effect now early-returns while a repair
    stroke is actively being painted (`isLiveRepairDrag(tool,
    activeStroke)`), skipping every bit of canvas work mid-drag:
    image decode, preview-cache read, geometry, full-res repaint,
    histogram, and heal-queue scheduling. The effect still bumps the
    repair generation first, so in-flight runs cancel exactly as
    before.
  - Rationale: the base canvas excludes repair stamps, so it cannot
    change mid-drag — only the red SVG overlay needs to update, and
    it is a pure render of the edit state that paints on the same
    React render. Previously every pointermove re-ran the full-res
    repaint synchronously (`sync-painting` branch), blocking the main
    thread so the patch visibly lagged behind the cursor.
  - Removed the now-unreachable `sync-painting` branch and the local
    `paintingRepair` const. Its pending-ids clearing moved into the
    early return, preserving behavior.
  - The release flips the active stroke back to null, which re-runs
    the effect and schedules the post-release heal — no work is
    lost, it just waits for the drag to end. This also drops wasted
    mid-drag heal jobs against partial strokes (the old 300 ms
    debounce could fire while the pointer was still down).
  - The render-path `draggingRepair` flag now reuses the same
    helper, so the "show everything red while dragging" overlay and
    the pipeline skip share one definition of a live drag.
- `packages/core/src/canvasPan.ts`
  - Added `isLiveRepairDrag(tool, activeStroke)`: true only for the
    repair tool with a non-null active stroke id. Follows the file's
    existing convention of pure, DOM-free canvas-drag helpers.
- `packages/core/src/canvasPan.test.ts`
  - Truth-table tests for the helper: live for any non-null stroke
    id under repair (including the legacy id 0), released on null,
    never live under adjust/crop even with a stale id.

## Decisions

- **Skip the pipeline run instead of throttling pointermove.**
  Throttling (rAF/coalescing) would still repaint a canvas that
  provably cannot change mid-drag — the base edit excludes repairs.
  Skipping removes the blocked-main-thread window entirely, so the
  overlay keeps up with the cursor at any drag speed.
- **Early-return after the generation bump, not before.** Each
  pointermove still cancels the previous pipeline run; only the new
  run's own work is skipped. In-flight heal-queue jobs (epoch, not
  generation, scoped) are untouched.
- **No UI markup test.** The skip lives in an effect and the overlay
  needs post-loading internal state, neither of which is observable
  in this repo's SSR (node-env, no jsdom) component tests — the same
  reason the existing canvas-drag routing is tested through its core
  helper. Coverage follows that pattern.

## Verification

- `yarn workspace @f8/core test`: 845/845 pass (49 files).
- `yarn workspace @f8/ui test`: 354/354 pass.
- `tsc --noEmit` in `packages/core`, `packages/ui`, and `@f8/web`:
  clean (rebuilt `@f8/core` first so `dist` types include the new
  helper; `dist/` is gitignored, not committed).
- No Playwright, per the task brief.

## Learnings

- When a drag handler feels laggy, check what the state update
  re-triggers, not the handler itself: here `paint()` was cheap and
  the overlay render was cheap — the cost was a full-res canvas
  repaint subscribed to the same state on every pointermove.
- A pipeline effect keyed on broad state (`edit`) should bail out
  early for gestures whose pixels it cannot change; the base-excludes-
  repairs invariant made this skip provably safe instead of a gamble.
- Cross-package typechecks resolve `@f8/core` from `dist`, so a new
  core export needs a core rebuild before the ui/web typechecks see
  it (unit tests resolve source and pass without it — a confusing
  split when only typecheck fails).
