# Task 8: Auto Enhance keeps one small button, in the sidebar

## What changed

Auto Enhance had two large entry points: an `Enhance` tab in the header
toolbar (masquerading as a tool next to Adjust/Repair/Crop) and a
full-width `Auto Enhance` bar at the top of the Adjust sidebar. One is
gone and the other shrank:

- The header toolbar renders real tools only (Adjust/Repair/Crop). The
  `Enhance` tab, its `enhanced` prop, and the `.enhance-tool` CSS went
  away. The Image menu item, the `A` shortcut, and the `enhance` action
  are untouched, so the one-shot is still reachable from anywhere.
- The sidebar bar is now an `Auto Enhance` section built on the shared
  `AdjustmentSection`, directly below the histogram where the bar was.
  The action runs from a small header `Auto` pill (the straighten/
  denoise `auto-small` style) with the shared revert icon left of it —
  the same header pattern Scene Enhance and the ML categories use.
  Content is a one-line note; the `.classic-enhance` bar CSS is gone.
- `AdjustmentSection`'s header action gained `kind: 'ml' | 'auto'`
  (default `'ml'`): kind `auto` renders the `Auto` pill with
  `${id}-auto` / `${id}-auto-revert` testids and non-ML tooltip
  phrasing. The ML path renders byte-identical markup to before.

Files: `packages/ui/src/components/Topbar.tsx` (tab + prop removed),
`apps/web/src/App.tsx` (prop removed), `packages/ui/src/components/
AdjustmentSection.tsx` (action kind), `packages/ui/src/components/
Inspector.tsx` (section replaces bar), `apps/web/src/index.css` (dead
rules removed), `packages/ui/src/components/autoEnhance.test.tsx`
(new), plus updated `mlSections`, `histogramFirst`, `adjustmentMl`,
`collapsePanels`, and `sceneEnhance` tests. No hook or editor changes:
`onAuto` already toggles (reverts a pure classic run on re-click), so
it satisfies the shared header-action contract as-is.

## Decisions

- Kept the sidebar, dropped the header tab: enhance is Adjust-context
  (its revert snapshot and pure highlight live with the sliders), and
  the toolbar tab was semantically wrong — its own tooltip apologized
  that it was "one-shot, not a tool". Menu + shortcut cover access
  from Repair/Crop and from a hidden inspector.
- The header pill says `Auto`, not `ML`: classic enhance is a
  deterministic heuristic, so the ML label (and its gold active style)
  would be dishonest. Same placement and toggle contract as the ML
  sections, honest label either way.
- Tooltips changed slightly with the shared derivation: applied keeps
  `Auto Enhance applied — click to revert` and the revert keeps
  `Revert auto enhance`; idle is now `Apply auto enhance
  automatically` and re-apply `Re-apply auto enhance`.
- No README change: no architecture or data-flow change, UI-only.

## Tests

- New `autoEnhance.test.tsx`: toolbar renders exactly 3 tool tabs with
  no Enhance/auto-enhance markup on any tool; sidebar section carries
  the header `Auto` pill, note, and no bar; applied state highlights
  the pill with the revert left of it; dead `.classic-enhance` /
  `.enhance-tool` CSS is gone.
- Rewrote the classic assertions in `mlSections` (header pill classes,
  testids, titles, revert placement, shared-row CSS), repointed the
  `histogramFirst` marker at `<h3>Auto Enhance</h3>`, pinned the
  single adjust-tool Auto pill in `adjustmentMl`, and added the new
  section to the `collapsePanels` shared-disclosure count.
- `yarn workspace @f8/ui test`: 223 passed (28 files).
- `yarn typecheck`: all packages pass.
