# Task 1: Remove "Updating preview" text from Export modal

## Change
Removed the `Updating preview…` status line from `ExportQualityPreview`
(`packages/ui/src/components/EditorDialogs.tsx`). While a re-render was
pending (e.g. dragging the Quality slider or switching format/size), that
`<p>` mounted and unmounted, changing the modal's content height and making
the Export modal visibly resize on every settings change.

The updating feedback is now the dim alone: the stale preview keeps showing
with the `is-updating` class, which only sets `opacity: 0.45` on
`.export-quality-views` (with a 160ms transition) — a purely visual change
that cannot affect layout. Comments on the component and on the
estimate/preview effect were updated to describe the dim-only behavior.

The initial `Rendering quality preview…` placeholder is untouched: before the
first pixels land there is nothing to show, so a placeholder is required and
no resize is avoidable or reported there.

## Decisions
- Dim-only, no replacement indicator: any added/removed element (spinner row,
  status text, skeleton swap) would reintroduce the resize the user objected
  to. The 0.45 opacity fade already signals staleness.
- Kept the `estimating` prop on `ExportQualityPreview`: it still drives the
  `is-updating` class, so the component API is unchanged.

## Tests (`packages/ui/src/components/exportQualityPreview.test.tsx`)
- Updated `keeps the previous preview on screen while the next settings
  render` and `marks the preview settled once its own pixels land`: both now
  assert `Updating preview` never appears; the stale-views + `is-updating`
  behavior is still pinned.
- Added `renders identical markup while updating and settled, so the modal
  never resizes`: updating vs settled markup must be byte-identical except
  for the `is-updating` class, so no element can appear/disappear mid-update.
- Added `dims via opacity only, never via layout-affecting styles`: pins the
  `.export-quality-preview.is-updating .export-quality-views` rule to
  `opacity: 0.45` and forbids display/size/spacing declarations.

## Verification
- `yarn workspace @f8/ui test`: 58 files, 461 tests, all pass.
- `yarn workspace @f8/ui typecheck`: clean.
- No remaining `export-quality-updating` / `Updating preview` references in
  `packages/` or `apps/` (outside `tasks.md` and historical `docs/learnings.md`).
