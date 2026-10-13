# Task 5: Brush-size slider loses its stray origin tick

The vertical line ~26% of the way through the Repair brush-size slider was
the shared `RangeControl` origin tick drawn at `defaultValue` (45px on a
5–160 range). That tick is meaningful only on bipolar (signed) sliders,
where it marks the neutral zero mid-track — on unsigned sliders the
default is just a starting preset, so the tick read as an unexplained
marker. Unsigned sliders no longer render it.

## What changed

1. **Origin tick gated on `signed`** (`packages/ui/src/components/EditorUI.tsx`).
   `showOrigin` was `!color && in-range`; it is now `signed && !color &&
   in-range`, with a comment pinning the rule: the tick marks the neutral
   zero of a bipolar slider, while `defaultValue` on unsigned sliders is
   only a starting preset / double-click reset target.
2. **Four sliders fixed, zero changed API.** Brush Size (tick was at
   25.8%), Brush Strength (tick sat on the far right edge at 100%),
   Blend Feather (25%), and denoise Strength (45%) all drop the line.
   Every signed slider (adjustments, Straighten, selective
   exposure/contrast/saturation) keeps its center tick exactly as before;
   color sliders (Temperature/Tint/Hue) were already exempt via `!color`.
3. **Double-click reset untouched.** The reset tooltip and
   `onDoubleClick → defaultValue` behavior stay on all sliders — only the
   visual tick is gone, so no affordance is lost.
4. **Tests:** added `brushSizeOrigin.test.tsx` (8 tests: each of the four
   unsigned sliders renders no `range-origin`, a signed slider still does,
   the double-click tooltip survives on Brush Size, the whole repair
   panel renders zero ticks, and the adjust panel still renders ticks).

## Decisions

- **Remove the tick, not the default.** A "default marker" at 45px would
  still be meaningless — brush size has no neutral rest point worth
  returning to, and none of the sibling sliders (Quality, Temperature)
  mark their defaults either. Deletion matches surrounding conventions.
- **`signed` as the gate, no new prop.** The existing `signed` flag
  already partitions exactly the two cases (bipolar-with-neutral vs.
  preset-default), so no new `showOrigin`/`hideTick` API was needed.
- **Denoise and feather fixed in the same edit.** They share the one-line
  root cause; leaving their identical stray ticks would have re-filed
  this same bug twice.
- **No README change.** The README never documented the slider tick; this
  is a behavior fix, not an architecture change.

## Verification

- `yarn workspace @f8/ui test`: 38 files, 308 tests, all pass (300
  pre-existing + 8 new).
- `yarn workspace @f8/ui typecheck`: clean.
- Playwright not run (per brief).
