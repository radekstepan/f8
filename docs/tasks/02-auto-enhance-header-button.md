# Task 2: Auto Enhance moves to the Color Adjustments header

The standalone Auto Enhance category is gone. The whole-photo enhance now
runs from an "Auto" pill with a Sparkles icon in the Color Adjustments
panel header (right-aligned before the `...` menu), plus an "Auto Enhance"
item at the top of that same `...` menu. Same handler, same toggle
contract, same tooltips — just relocated.

## What changed

1. **Standalone section removed.** The `AdjustmentSection title="Auto
   Enhance"` block (heading, Auto pill, "Automatically enhance exposure,
   contrast, and color." note) is deleted from the adjust scroll region.
   The histogram now leads directly into Scene Enhance / slider sections,
   and the adjust panel count drops from 7 headings to 6.
2. **Header Auto pill with icon.** The `.inspector-title` row renders an
   `inspector-auto-wrap` group when `tool === 'adjust'`: the same
   `auto-small` pill (`data-testid="auto-enhance-auto"`, `aria-pressed`
   from `classicActive`) with a Sparkles icon inside, firing the unchanged
   `onAuto` toggle. Tooltips are the exact strings the retired section got
   from `AdjustmentSection` kind `'auto'` ("Apply auto enhance
   automatically" / "Re-apply auto enhance" / "Auto Enhance applied — click
   to revert/re-apply"), now computed in one `autoTitle` const.
3. **Revert icon moves with it.** While a pre-enhance snapshot lives
   (`classicRevert`), the header group shows the same `section-reset
   is-dirty` RotateCcw icon ("Reset auto enhance" → `onRevertEnhance`)
   left of the pill — the Task 1 "reset left of the action, action
   rightmost" order, and the reason a manual edit after Auto Enhance still
   offers a one-click way back. Scene mode keeps its reset in the Scene
   Enhance section; the shared-snapshot rule (last-used mode carries the
   icon) is unchanged.
4. **`...` menu item.** The header options menu gains an adjust-only "Auto
   Enhance" item, first in the menu, firing `closeAction(onAuto)` with
   shortcut `A` (the same global shortcut the Image menu shows).
5. **CSS.** `.inspector-auto-wrap` takes the auto margin (right-aligned
   group, 6px gap like `.section-actions`); `.inspector-auto-wrap +
   .inspector-menu-anchor` zeroes the anchor's own auto margin so the two
   don't split the free space (flex gap still separates group from menu);
   `.inspector-auto` lays the icon + label out inline-flex. Repair/crop
   headers render no wrap, so their layout is byte-identical.

## Decisions

- **Revert icon kept, not just the pill.** The task says "just an Auto
  button", but dropping the revert would strand the post-manual-edit state:
  highlight cleared, snapshot alive, no UI to restore it (the old section's
  persistent reset existed exactly for this). The Task 1 contract already
  blesses "at most the reset + the action" per header, so the panel header
  follows it.
- **Same testid, same tooltips, same `auto-small` look.** `auto-enhance-auto`
  still selects the button; only an `inspector-auto` class joins for the
  icon layout. The `'auto'` (not `'ml'`) label rule from Task 1 carries over
  untouched — no model runs on click.
- **`...` item is adjust-only.** The task scopes it to the Color Adjustments
  header; repair/crop menus stay untouched, and the Image menu + `A` shortcut
  already reach enhance from other tools.
- **`.auto-enhance-row` untouched.** The faces/selective applied-row style
  keeps its name — it's a row layout class, not the retired section.
- **No README change.** No Auto Enhance references there and no architecture
  change.
- **Tests:** rewrote `autoEnhance.test.tsx` as the header-button suite (8
  tests: pill + icon + placement, highlight/revert order, reload-seeded
  state, adjust-only scoping, `...` source wiring, CSS layout pins);
  updated `adjustmentMl` (header pill class), `adjustmentConsistency`
  (note gone, no-switch pin extended to the header group), `collapsePanels`
  (6 panels), `histogramFirst` (header pill precedes the scroll region),
  `mlSections` (header pill classes, panel-header-row comment + wrap pins),
  `sceneEnhance` (header Auto alongside the ML section), `singleResetIcon`
  (enhance icon in the panel header, not a section).

## Verification

- `yarn workspace @f8/ui test`: 36 files, 292 tests, all pass.
- `yarn workspace @f8/ui typecheck`: clean.
- `yarn workspace @f8/core test`: 48 files, 830 tests, all pass (untouched, sanity).
- Playwright not run (per brief); no e2e spec references the changed markup.
