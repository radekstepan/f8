# Task 2: Match the toolbar presets toggle icon to the strip icon

Task: The show/hide presets icon in photo mode at the top needs to match
the icon in the strip at the bottom.

## What changed

- `packages/ui/src/components/Topbar.tsx`
  - The `Toolbar` show/hide presets toggle now renders the `SwatchBook`
    glyph (same size/stroke as before: 18 / 1.6) instead of
    `SlidersHorizontal`, matching the `SwatchBook` icon in the
    `PresetStrip` heading at the bottom (`PhotoStrips.tsx`).
  - Added `SwatchBook` to the lucide-react import. `SlidersHorizontal`
    stays for the Adjust tool button.
- `packages/ui/src/components/colorPresetsIcon.test.tsx`
  - Replaced the "keeps the generic sliders icon on the toolbar presets
    toggle" test (which pinned the old mismatched behavior) with:
    - toolbar toggle renders `lucide-swatch-book`, not sliders;
    - an explicit match test asserting the toolbar toggle glyph equals
      the strip heading glyph;
    - a guard that the Adjust tool keeps its sliders icon.
  - Updated the file's header comment to describe the new contract.

No README update: one-glyph swap, no architecture change.

## Decisions

- **Top matches bottom, not the reverse.** The task names the strip icon
  as the reference, and `SwatchBook` is the presets-specific motif while
  `SlidersHorizontal` is generic (and already means "Adjust" in the same
  toolbar). Reusing the Adjust glyph for the presets toggle made the two
  controls visually ambiguous.
- **Updated an existing pinning test instead of adding a new file.**
  `colorPresetsIcon.test.tsx` already owned both icons' contracts, so the
  change belongs there. The old "keeps sliders on toggle" assertion was
  the exact behavior the task asked to change.

## Verification

- `vitest run src/components/colorPresetsIcon.test.tsx`: 6/6 pass.
- Full `@f8/ui` suite: 348/348 pass.
- `tsc --noEmit` in `packages/ui`: clean.

## Learnings

- A test that pins "keep X different from Y" is a deliberate contract, not
  incidental coverage: when a task flips that contract, update the test's
  rationale comment too, not just the assertion, or the next reader will
  see a stale explanation contradicting the code.
- Before swapping an icon, grep every usage of both glyphs: here it
  confirmed `SwatchBook` existed only in the strip heading and that no
  other test pinned the toolbar toggle's glyph.
