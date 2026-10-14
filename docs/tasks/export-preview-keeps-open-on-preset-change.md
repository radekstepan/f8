# Export Quality preview stays open across preset changes

Task: `When I change Quality preset on export we should NOT close the preview. Transition to the new setting for preview.`

## What changed

- `packages/ui/src/components/EditorDialogs.tsx`
  (`ExportDialog` effect): the pending block no longer calls
  `setPreviewUrl(null)` when format/size/quality (or any other preview
  input) changes. The previous preview URL stays mounted while the next
  render + encode runs, and only the new pixels swap it — so switching
  presets transitions instead of collapsing the preview to the
  "Rendering quality preview…" placeholder on every change.
- `packages/ui/src/components/EditorDialogs.tsx`
  (`ExportQualityPreview`): a stale URL plus `estimating` now renders
  the full view + 16× zoom dimmed (`is-updating` on the section) with a
  `role="status"` "Updating preview…" line (`data-testid=
  "export-quality-updating"`), instead of only handling settled vs
  first-load states. First load (no URL yet) still shows the loading
  placeholder; settled renders exactly as before.
- `apps/web/src/index.css`: `.export-quality-views` gains
  `transition: opacity 160ms ease` (the filmstrip-image convention) and
  `.export-quality-preview.is-updating .export-quality-views` dims to
  `opacity: 0.45`, so the old → new pixel swap reads as a fade rather
  than a flash. The `prefers-reduced-motion` block disables the
  transition; the selector sits mid-list so the unanchored `cssRule`
  test helper still resolves the main rule first.
- `packages/ui/src/components/exportQualityPreview.test.tsx` (+4 tests):
  stale-URL-while-estimating keeps views/zoom/focus with the updating
  status and `is-updating` class (no loading placeholder); settled
  state carries neither; a source-level pin that the effect's pending
  block issues no `setPreviewUrl` call while the failure and 2x paths
  still clear; and CSS pins for the fade, the dim, and the
  reduced-motion override.

## Important decisions

- **Keep-stale only while pending, not on failure**: a failed re-render
  still clears the preview (and the estimate), preserving the existing
  rule that stale pixels must never pose as new output. The "don't
  close" applies to the transition window only.
- **2x and PNG behavior untouched**: arming super-resolution still hides
  the preview immediately (its pixels cannot exist before the ML run),
  and PNG still renders nothing (lossless, nothing to judge). Only
  lossy → lossy setting changes transition.
- **Separate status line over rewriting the note**: the
  "Actual JPEG output at 90%" note keeps naming the target settings and
  the drag hint; the dim + "Updating preview…" status communicates that
  the on-screen pixels are mid-transition.
- **No README update**: interaction bug fix, no architecture or feature
  change.

## Tests (unit/integration only, no Playwright)

- `exportQualityPreview.test.tsx`: 24/24 pass (20 existing + 4 new),
  via `renderToStaticMarkup` + source/CSS pins (node env, no jsdom).
- Full suite: `@f8/ui` 456/456 pass (57 files). `@f8/ui` typecheck clean.
