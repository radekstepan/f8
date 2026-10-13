# Task 15 — Face enhance: instant progress, on/off toggle, visible result

Task: "I click ML face enhance and maybe it does something but I don't see it.
No progress bar. No way to toggle it on/off etc. Does it even work?"

## What was wrong

1. **Progress gap on click.** `useFaceEnhance.detect()` cleared progress and the
   local photo decode reports nothing, so until the first server report landed
   the control showed only a Cancel button — no bar. On a warm server the whole
   run could pass with barely a flicker of feedback.
2. **No toggle.** Once applied, the only option was Clear (delete). Every other
   adjustment has an enable switch; face enhance had none, so there was no way
   to compare before/after.
3. **"Does it even work?"** The applied badge said only "N faces · ML" — not
   what it did (lift EV, red-eye count). A 0-lift result (well-exposed faces,
   WB-only change) looked identical to a no-op.

## Changes

- `apps/web/src/vision/useFaceEnhance.ts` — `detect()` now seeds
  `{ fraction: 0, stage: 'Preparing photo…' }` synchronously, so the bar
  renders on the same click that starts detection.
- `packages/ui/src/components/Inspector.tsx`
  - `FaceEnhanceControl` renders `MlProgressView` for the whole `detecting`
    phase with a `Preparing photo…` fallback when `progress` is still null
    (belt-and-braces alongside the hook seed).
  - `FaceEnhanceAssist.applied` grew to
    `{ faces, source, enabled, liftAmount, redEyeCount }` plus an `onToggle`
    callback. The applied row now has a Toggle switch and a badge that states
    the corrections (`2 faces · lift +0.4 EV · 1 red-eye · ML`); the badge dims
    (`is-off`) while bypassed.
- `packages/core/src/types.ts` — `FaceAdjustState.enabled?: boolean`
  (absent = enabled, so legacy server recipes stay active).
- `packages/core/src/vision/face-exposure.ts`
  - `isFaceAdjustActive` returns false when `enabled === false`, so the render
    pipeline (`renderAdjustedPixels`) and `isNeutralEdit` bypass a toggled-off
    adjust with no other changes.
  - New `isFaceAdjustStored` predicate (pixel-changing ignoring the toggle);
    the app uses it for the applied badge so a toggled-off adjust stays visible
    with Rescan/Clear instead of vanishing.
  - `faceAdjustForFaces` stamps new applies with `enabled: true`.
- `apps/web/src/App.tsx` — `toggleFaceEnhance` flips `enabled` as one undo
  step with a toast (`Face enhance off — lift and red-eye fixes bypassed.`);
  the applied badge is fed from `isFaceAdjustStored`.
- `apps/web/src/index.css` — dimmed `.is-off` badge, toggle flex fix.

## Decisions

- The toggle bypasses only the masked lift + red-eye discs. The applied white
  balance rides the plain temperature/tint sliders (unchanged from before), so
  it stays put — same semantics Clear already had.
- Left `isOriginalLook` counting any stored `faceAdjust` as non-Original even
  when toggled off. A bypassed adjust renders default pixels but the recipe
  still carries it; changing the preset label felt out of scope for this UX fix.

## Tests

- `packages/core/src/vision/face-exposure.test.ts` — `enabled: false` is
  inactive but stored; `faceAdjustForFaces` stamps `enabled: true`; a
  toggled-off adjust renders byte-identical to the source and stays neutral.
- `packages/ui/src/components/faceEnhance.test.tsx` — detecting with
  `progress: null` still shows the bar + Cancel; applied badge shows the
  lift/red-eye summary; toggle renders `role="switch"` with correct
  `aria-checked`, dims when off, and keeps Rescan/Clear.
- `packages/ui/src/components/mlEnhanceSection.test.tsx` — helper updated for
  the new `onToggle` field.
- Full suites: core 746 pass, ui 134 pass; `yarn typecheck` 6/6.
