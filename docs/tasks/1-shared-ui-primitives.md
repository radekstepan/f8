# Task 1: Shared UI primitives (no copied UI)

## What changed

Reviewed every component in `packages/ui` (plus the `apps/web` shell) for
pasted copies of the same UI, and extracted the repeated markup into shared
primitives. All consumers now render through them; rendered output is
byte-identical except where noted.

New primitives in `packages/ui/src/components/EditorUI.tsx`:

- `MlBadge` — the `ml-badge` span, 16 call sites across Inspector, Topbar,
  PhotoStrips, and EditorDialogs.
- `MenuSeparator` — the menu divider, 12 call sites. Standardizes
  `role="separator"`, which PhotoStrips already had but Topbar/Inspector
  lacked (the one intentional markup change; no test pinned the old output).
- `SegmentedControl` — the pill option group; both Repair groups (method,
  quality) in `RepairMethodControl`, preserving testids, titles, active
  state, and the method-dependent Fast option.
- `CheckField` — the labeled checkbox row; detection confirm lists
  (people, dust spots) and the export 2x toggle.
- `RevertButton` — the small undo icon beside applied ML/auto actions;
  4 call sites (adjustment sections, scene enhance, straighten, classic
  enhance).

New hooks in `packages/ui/src/hooks/` (exported from the package index):

- `useIsomorphicLayoutEffect` — was pasted verbatim in Sidebar and
  PhotoStrips; now one definition.
- `useMenuDismiss` — the single menu-dismiss behavior (outside
  pointer-down + Escape, optional scroll/resize for floating menus).
  Replaces 5 hand-rolled document-listener effects: MenuBar, album rows,
  Inspector (options + Add Adjustment), PhotoBrowser (album + sort), and
  the photo context menu. Ships with `isOutsideTargets`, the pure rule
  the hook applies, so the core logic is unit-testable in the SSR-only
  suite.

## Decisions

- Unify atoms with identical rendered output, not compositions that only
  look similar: the `suggestion-actions` rows and `slim-button full-width`
  detect buttons vary per assist state, so a wrapper would add indirection
  without removing logic. Same for modal footers and toggle rows.
- Inspector's menus moved from class-based `closest()` checks to refs so
  they fit the shared hook; behavior is equivalent (each menu ignores
  presses inside its own trigger + panel).
- The size-18 history undo in Topbar is a different control from the
  `ml-revert` affordance and was left alone.
- No README change: no architecture or user-facing behavior changed.

## Tests

- New `sharedPrimitives.test.tsx` (19 tests): exact SSR markup for each
  primitive, consumer integration (repair groups, confirm rows, context
  menu separator, export toggle), `isOutsideTargets` unit tests, the SSR
  `useIsomorphicLayoutEffect === useEffect` contract, and a
  "no copied UI" suite asserting component sources no longer paste the
  raw class names, icons, or document listeners.
- `yarn workspace @f8/ui test`: 205 passed (186 pre-existing, still green).
- `yarn typecheck`: all packages pass.
