# Task 7: Photo Information modal cleanup

The Photo Information modal opens from the photo already on screen, yet it
rendered its own 166px cover preview (`info-photo`) at the top — redundant
with the editor canvas behind it. Below that, the Labels "Add" button used
the full-size 33px `secondary-button` treatment next to a 28px input, so it
towered over its own field; and the location/path rows near the bottom draw
a `border-top` rule with padding below but zero margin above, leaving the
horizontal bar flush against the section above it.

## What changed

1. **Preview removed** (`packages/ui/src/components/EditorDialogs.tsx`).
   The `<img className="info-photo">` is gone from the `info` dialog; the
   modal now opens straight on the filename + Camera section. The orphaned
   `.info-photo` rule was deleted from `apps/web/src/index.css` with it.
2. **Add button shrunk** (`apps/web/src/index.css`). The button keeps its
   `secondary-button` class (same hover/disabled states, still a
   `type="submit"`), but a scoped `.photo-label-add > .secondary-button`
   override drops it to the input's 28px height with 9px text — matching
   the adjacent input height and the 9px label-chip text convention instead
   of the 33px/10px modal-footer treatment.
3. **Rule spacing** (`apps/web/src/index.css`). `.photo-info-location` gains
   `margin-top: 17px`, mirroring its existing `padding-top: 17px`, so the
   bottom rule has equal air above and below. The same rule covers stacked
   location + path rows, keeping their rhythm even.
4. **Tests:** added `photoInfoModal.test.tsx` (5 tests: no `<img>` /
   `info-photo` / photo `src` in the modal; every section still renders —
   filename, camera grid, labels, location, path, missing-file alert,
   credit; the add form stays wired to a secondary submit; the Add button
   CSS matches the 28px input with 9px text; the location rule CSS carries
   border + margin + padding).

## Decisions

- **Scoped override, not a new button variant.** The brief says the Add
  button should match surrounding conventions — the complaint is its size
  next to a 28px input, not the secondary look itself. A one-line scoped
  rule fixes the pairing without inventing a `.small` button API no other
  surface uses.
- **Symmetric 17px around the rule.** The row already padded 17px below
  the border; 17px of margin above makes the whitespace even rather than
  introducing a new spacing value.
- **No README change.** The README documents no modal layouts; this is a
  visual cleanup with no architecture or behavior change.

## Verification

- `yarn workspace @f8/ui test`: 40 files, 317 tests, all pass (312
  pre-existing + 5 new).
- `yarn workspace @f8/ui typecheck`: clean.
- Playwright not run (per brief).
