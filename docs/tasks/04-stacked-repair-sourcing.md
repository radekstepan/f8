# Task 4: Stacked ML repair sources from the repaired image

Running ML repair over (the edge of) an earlier ML repair used to heal
against the original pixels, so the old blemish leaked back into the new
fill as context. Dirty groups now heal against the full repaired image so
far — finished patches composited over the clean base — so a touch-up
stroke overlapping an already-fixed region sees repaired pixels instead of
the original blemish.

## What changed

1. **Queue accumulates within a job** (`packages/core/src/vision/heal-queue.ts`).
   `runJob` keeps a working image: the job's starting base plus every patch
   the job already finished. Each group heals against it; failed groups
   contribute nothing. Two overlapping strokes healed in one job now see
   each other's work.
2. **Preview seeds follow-up jobs with finished work**
   (`packages/ui/src/components/PhotoCanvas.tsx`). The queue `prepare` passes
   `repairedBaseForHealJob(clean, validPatches)` as the job source, so a
   touch-up painted after an earlier repair finished heals against repaired
   pixels. Display compositing still pastes over the clean base — only the
   inference input changed.
3. **Export matches the preview** (`packages/core/src/image.ts`). The
   group-overlay path heals missing groups against the saved patches plus
   each group the loop already finished, so exports pixel-match the preview
   for stacked repairs.
4. **New helper** (`packages/core/src/vision/heal-cache.ts`):
   `repairedBaseForHealJob(clean, finishedPatches)` returns the clean base
   itself when nothing is finished (no full-image copy on the first stroke),
   else a fresh composited image; inputs are never mutated. Header and
   `healSingleGroup` doc comments updated from "clean base, never over
   other patches" to repaired-so-far sourcing.

## Decisions

- **Finished work stays immutable.** An older valid group overlapped by a
  new touch-up is not re-healed; the new patch composites newest-on-top and
  its fill is fresh inference over its own mask with repaired context.
  Deleting the underlying stroke later leaves the touch-up's blended pixels
  as-is (same immutability rule as before, now over repaired context).
- **Classic `heal` gets the same fix.** It shares the queue/export path
  with `ml-heal`; splitting the behavior per method would have doubled the
  call-site logic for no user benefit.
- **Paste into the working image before `onGroupDone`, not after.** The
  patch is valid healed output for the job's geometry regardless of what
  the cache/persist hook does, so later groups see it even if the hook
  fails. The geometry-drift path in `PhotoCanvas` that drops a patch still
  only affects caching/display, never sibling groups (same job geometry).
- **Full-pass paths untouched.** Telea/NS and the no-overlay export path
  heal all strokes in one joint inference, so stacking is inherent there.
- **No README change.** The README never documented the heal-cache sourcing
  rule; this is a behavior fix, not an architecture change.
- **Tests:** `heal-queue.test.ts` gains 4 tests (within-job repaired-so-far
  sourcing with an injected mock, failed groups contribute nothing, plus 2
  real-pipeline integration tests with the true `healSingleGroup` + a stub
  transport: same-job touch-up and the exact user flow of a follow-up
  touch-up job seeded via `repairedBaseForHealJob` — both assert the
  touch-up's inference input shows repaired pixels where the first repair
  saw the blemish); `heal-cache.test.ts` gains 2 tests for the helper
  (identity on empty, newest-on-top composite without mutating the base).

## Verification

- `yarn workspace @f8/core test`: 48 files, 836 tests, all pass.
- `yarn workspace @f8/ui test`: 37 files, 300 tests, all pass.
- `yarn workspace @f8/core typecheck`, `@f8/ui typecheck`, `@f8/web
  typecheck`: clean (after `yarn workspace @f8/core build`, since the UI
  resolves `@f8/core` from `dist`).
- Playwright not run (per brief).
