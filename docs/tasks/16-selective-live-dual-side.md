# Task 16: Selective enhance goes live — no Apply, subject + background at once

## Complaints addressed

1. **"Why do I have to click Apply? Sliders show nothing live."** — The pre-apply
   sliders wrote to a local draft that never touched the recipe, so the photo
   never moved until Apply. Fixed: segmentation now stores the mask in the
   recipe the moment it lands (one undo step, idempotent under StrictMode),
   and every slider patches the recipe directly — the photo updates on the
   first drag.
2. **"How do I preserve the changes? Clicking Cancel goes away."** — Cancel on
   the ready screen discarded the mask AND the draft. Fixed: there is no more
   Apply/Cancel screen. Cancel exists only while segmenting (aborts the run);
   once the mask lands it is already in the recipe, persisted by the normal
   recipe save, undoable like any edit.
3. **"Can I apply enhance to subject AND background at the same time?"** —
   Previously one target toggle picked a single side. Fixed: `SelectiveAdjustState`
   now carries independent `subject` + `background` param sets, rendered as two
   masked passes (mask / inverse mask), with a slider group per side.
4. **"Brighten Subject Only seems like a better Enhance Faces?"** — Renamed the
   action to **Enhance Subject & Background** to state its scope. Deliberately
   NOT merged with Enhance Faces: faces does skin-anchored white balance plus
   per-face lift plus red-eye discs; selective does whole-region
   exposure/contrast/saturation. They stack (face pass runs before selective
   in the pipeline).

## Changes

- `packages/core/src/types.ts`: `SelectiveAdjustState` holds `subject` and
  `background` param sets (`SelectiveAdjustParams` moved here as the canonical
  shape).
- `packages/core/src/vision/selective-mask.ts`: `applySelectiveAdjust` runs
  both sides (legacy single-target input still accepted);
  `selectiveAdjustForMask` defaults to brightened subject + neutral background;
  new `normalizeSelectiveAdjust` migrates pre-dual-side recipes (and garbage →
  null) so old persisted edits keep rendering; `isSelectiveAdjustActive` is
  true when either side is non-neutral.
- `packages/core/src/adjustments.ts`: render path normalizes before the
  selective pass.
- `apps/web/src/App.tsx`: auto-apply effect on segmentation-ready (keeps prior
  slider values on rescan, skips duplicate undo entries); `adjustSelectiveMask`
  takes `(target, patch)` with merge key; `applied` is now set whenever a mask
  is stored — even fully neutral — so zeroing the sliders keeps the UI instead
  of dropping back to the detect button.
- `packages/ui/src/components/Inspector.tsx`: `SelectiveMaskAssist` drops
  `onApply`/`SelectiveMaskDraft`; control shows Subject + Background slider
  groups, a dual-side summary badge (`Subject (+0.5 EV) · Background (S -20)`),
  Rescan (keeps values) / Clear. Ready-with-mask is a transient "applying…"
  line; the hook dismisses it within a tick.
- `apps/web/src/index.css`: `.selective-target` toggle styles replaced with
  `.selective-group` group labels.
- `README.md`: feature bullet rewritten for the new UX.

## Verification

- `yarn workspace @f8/core test`: 752 pass (selective-mask.test.ts 35,
  incl. new dual-side, legacy-migration, and legacy-pipeline tests).
- `yarn workspace @f8/ui test`: 135 pass (selectiveMask.test.tsx 8, incl. new
  no-apply-step, dual-summary, and neutral-mask-keeps-sliders pins).
- `yarn typecheck`: 6/6.
