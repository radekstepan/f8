# Task 05 — Remove Reset Composition from Crop view

## What I did
Removed the "Reset Composition" button from the Crop inspector body
(`packages/ui/src/components/Inspector.tsx`, crop branch). Reset remains
available via the inspector "..." options menu ("Reset All Adjustments",
`onReset`), which is visible in every tool including Crop — no menu change
needed. Also removed the now-unused `.reset-crop` CSS rule from
`apps/web/src/index.css`.

Behavior note: the removed button reset only composition state
(cropRatio/rotation/flips/straighten); the "..." menu item resets all
adjustments. That is the tradeoff the task requests.

## Files changed
- `packages/ui/src/components/Inspector.tsx` — deleted the
  `secondary-button full-width reset-crop` button from the crop inspector
  (1 line). `RotateCcw` import still used elsewhere in the file.
- `apps/web/src/index.css` — deleted `.reset-crop { margin-top: 18px; }`.
- `apps/web/tests/e2e/basic.spec.ts` — added test "crop view has no Reset
  Composition button; reset stays in options menu": opens Crop, asserts zero
  "Reset Composition" buttons, opens "Adjustment options" menu, asserts
  "Reset All Adjustments" menuitem is visible.

## Tests added/run with results
- Added: 1 Playwright e2e test in `apps/web/tests/e2e/basic.spec.ts`.
- `yarn workspace @photomator/ui typecheck` — PASS.
- `yarn workspace @photomator/web typecheck` — PASS.
- `yarn workspace @photomator/ui build` — PASS (exit 0).
- New e2e test — NOT RUN: Playwright global setup fails in this sandbox
  (`connect EPERM 127.0.0.1:5174`; sandbox blocks localhost servers, and
  unsandboxed execution needs human approval, which is disabled in this
  session). No unit-test runner exists in `@photomator/ui` (Vitest lives only
  in `@photomator/core`, untouched by this change), so no unit tests were
  added — the change is a pure UI removal with no logic.

## How to verify
1. `cd apps/web && yarn playwright test basic.spec.ts -g "Reset Composition"`
   (needs unsandboxed localhost).
2. Manual: open a photo, click Crop in the toolbar — no "Reset Composition"
   button below Straighten; click "..." (Adjustment options) — "Reset All
   Adjustments" is still there.
3. `grep -r "Reset Composition" packages apps --include='*.tsx' --include='*.ts' --include='*.css'`
   returns nothing.

## Unresolved items
- E2E test written but not executed (sandbox localhost block, see above).
  Recommend running it once outside the sandbox before merging.
- Changes left uncommitted per instructions; working tree is shared with
  sibling tasks — my hunks are the `.reset-crop` CSS deletion, the Inspector
  button deletion, and the new e2e test only.
