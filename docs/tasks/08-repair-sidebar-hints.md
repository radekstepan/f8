# Task 8: Remove Repair sidebar hints

## What changed

The Repair sidebar opened with a hint block — a large yellow Bandage
icon plus the "Less distraction. More photo." heading and the "Rebuild
small distractions from the surrounding photo." subtext. That block is
gone; the sidebar now opens straight onto the Brush section.

- `packages/ui/src/components/Inspector.tsx`: the repair branch of the
  inspector no longer renders the `tool-inspector` / `tool-intro` div
  with the Bandage icon and hint strings. All repair sections (Brush,
  Reconstruction, One-Click Removal, Dust Spots, Repairs) and their
  wiring are untouched.
- `packages/ui/src/components/repairSections.test.tsx`: added a test
  pinning the removal (`tool-intro`, "Less distraction", "Rebuild
  small" all absent from the repair markup; Brush section still first),
  and refreshed a stale "not under the intro" comment.

## Decisions

- **Crop intro kept.** The Crop tool has its own `tool-intro` block
  ("A fresh point of view."), which this task did not ask to remove —
  so the `tool-intro` CSS and markup pattern stay.
- **No dead code left behind.** The `Bandage` icon import stays: it is
  still used by the inspector title icon and the Repairs section. The
  over-photo hint/toast mechanism (reused by Task 2) was not touched.
- **No README update.** Pure sidebar cleanup; no architecture or
  feature change.

## Tests

- `repairSections.test.tsx` (6 tests): existing 5 section/grouping
  tests still pass; new test asserts no intro hint block renders in
  the repair sidebar.

## Verification

- `yarn workspace @f8/ui test` — 166 passed.
- `tsc --noEmit` (ui) — clean.
- Playwright not run (per task rules).
