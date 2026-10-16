---
'@f8/core': patch
'@f8/web': patch
---

Undoing a Denoise apply now takes effect on the photo immediately. Previously the pixels-to-recipe sync re-stored the denoised strength right after the undo cleared it, so the photo stayed denoised (and the redo stack was lost).

## Task writeup (docs/tasks/43-undo-denoise-immediate.md)

## Request

When I undo an action like Denoise, it doesn't seem to immedaitely
apply on the photo.

## Investigation

Denoise pixels live outside the undo history: the full-res pass lands
pixels in the `useDenoise` hook first, and an effect in `App.tsx` then
stores the matching recipe strength in one undo step. The canvas shows
the denoised base only while both the pixels and an active recipe agree
(`viewPhoto`).

The old sync effect was guarded on recipe/base *equality* only. Trace
of Apply (strength 45) then Cmd+Z:

1. Apply lands `appliedBase`; the effect writes recipe `{45}` — one
   history entry: past=`[A]`, present=`B(denoise 45)`.
2. Undo restores present=`A` (recipe `denoise: null`) and pushes `B`
   onto the redo stack. The hook pixels survive (nothing clears them
   on undo).
3. The effect re-runs (recipe changed, base still set), sees
   pixels-without-matching-recipe, and immediately re-stores `{45}` —
   a *new* history entry that also wipes the redo stack.

So the photo stayed denoised (at most a one-frame flicker) and Redo
died — exactly the report. A second symptom of the same defect: the
"Denoised…" toast re-fired after the undo.

Audited the sibling async→recipe syncs for the same flaw: selective
mask and empty-face-scan effects only fire on a `ready` transition and
dismiss themselves, straighten already keys on `runId:angle` (the
pattern this fix mirrors), and removal/dust/enhance applies are
user-triggered, not effects. Denoise was the only re-apply-after-undo.

## Change

- `packages/core/src/vision/denoise.ts` (new export, via
  `vision/index.ts`)
  - `nextDenoiseRecipeSync(syncedBase, base, recipe)` steps the
    pixels→recipe sync: it returns the base to record plus whether
    this sighting must write the recipe. Each applied base (fresh
    object per apply, identity-compared) syncs exactly once; a
    restore at the stored strength still records its base while
    writing nothing (pixels-only no-op), so a later undo past it
    stays undone; a null base (clear, reset, photo switch) resets
    the record so the next apply syncs fresh.
- `apps/web/src/App.tsx`
  - The denoise sync effect now keeps the last synced base in a ref
    and steps it through `nextDenoiseRecipeSync`. Undoing an apply
    leaves the recipe cleared, so the canvas flips back to the
    original on the same render and redo keeps working.
- Tests: 6 new cases in `packages/core/src/vision/denoise.test.ts`
  scripting the sequences through the step function — write-once
  for a fresh base, no rewrite after undo (the reported bug),
  no write on redo, second apply at a new strength syncs once,
  restore-at-stored-strength records without writing (and a later
  undo stays undone), null base resets so re-apply writes, and
  auto/source participate in the match, not just strength.
- No README change: bug fix, no architecture or feature change.

## Decisions

- Chose sync-once-per-base over clearing the hook pixels on undo:
  keeping the pixels makes redo instant (no server re-run) and the
  recipe stays the single source of truth for what the canvas shows.
- Chose not to auto re-run denoise when undo lands on a recipe whose
  strength no longer matches the live pixels (e.g. undo across two
  applies, or undo of a Clear): a multi-second ML run triggered by
  Cmd+Z would be surprising, and the one-click Restore path is the
  deliberate design for recipe-without-pixels (same as after reload).
  Known limitation, documented here: in that corner the Inspector is
  correct immediately while the pixels follow on Restore.
- Put the decision in `@f8/core` as a pure step function (same family
  as `dismissDenoiseStatus`): `apps/web` has no unit runner (e2e is
  Playwright, out of scope per the brief), so the core helper is the
  testable seam and the App effect is a thin wiring of it.

## Verification

- `yarn workspace @f8/core test` — full suite passes (incl. the 6 new
  denoise sync tests).
- `yarn workspace @f8/core typecheck` passes; `@f8/web typecheck`
  passes after `yarn workspace @f8/core build` (web resolves core
  from `dist`, which is gitignored — rebuild is local-only).
- No Playwright, per the task brief.
