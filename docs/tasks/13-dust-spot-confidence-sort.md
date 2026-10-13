# Task 13: Dust spots sorted by confidence, score shown

## What changed
- `packages/ui/src/components/Inspector.tsx` (`DustSpotsControl`): the spot list
  now renders sorted by `score` descending (highest confidence first),
  regardless of the order the server returned. Row labels keep the existing
  `Spot N · NN%` format, so the score is visible on every row (plus `· ML`
  when the classifier served).
- Sorting keeps each spot's original array index alongside the row, so the
  index-based wiring still works: checkbox toggles, hover-highlight callbacks,
  and the canvas red-disc preview all address the hook's array, not the
  display position. React keys also use the original index, keeping checkbox
  state stable. `data-testid`s (`dust-spots-item-N`, `dust-spots-check-N`) now
  reflect display position (sequential in DOM order).
- `packages/ui/src/components/dustSpots.test.tsx`: +2 tests (unsorted input
  renders 92/81/68 in order; highlight stays on the hovered spot's row after
  sorting).

## Decisions
- Sort at the presentation layer (Inspector) rather than in `useDustSpots` or
  the server: the server's ML path already sorts, but the client passed
  through whatever arrived, and classical scans carry a flat 0.5 score. Sorting
  at render guarantees "sorted by score" for every source; the stable sort
  preserves the proposer's contrast order for classical ties.
- Did not touch `spotsToRepairPoints` / apply order: stroke-id order has no
  user-visible effect (each spot is still one individually deletable stroke).

## Verification
- `yarn workspace @f8/ui test`: 126/126 pass (19 files).
- `yarn typecheck`: 6/6 ok.
