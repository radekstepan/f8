# Task 6: Color Presets gets its own swatch-book icon

The preset strip heading ("Presets", above the color preset thumbnails) used
the same `SlidersHorizontal` glyph as the toolbar's generic Show/Hide presets
toggle — and the Adjust tool for good measure. Three surfaces, one icon: the
color-presets strip read as a duplicate of the toggle that opens it. The
strip heading now uses `SwatchBook`, a color-collection motif that is unused
anywhere else in the app.

## What changed

1. **Strip heading icon swapped** (`packages/ui/src/components/PhotoStrips.tsx`).
   `PresetStrip`'s `.presets-title` icon is now `<SwatchBook size={13} />`
   instead of `<SlidersHorizontal size={13} />`. Same icon set (lucide-react),
   same size, same default stroke — only the glyph changed, and the now-unused
   import was swapped out with it.
2. **Generic icon untouched.** The toolbar Show/Hide presets toggle
   (`Topbar.tsx`), the Adjust tool button, and the Inspector adjust title icon
   all keep `SlidersHorizontal`: that glyph now unambiguously means
   "adjustments / preset panel chrome", while the swatch book means "the color
   presets themselves".
3. **Tests:** added `colorPresetsIcon.test.tsx` (4 tests: the strip heading
   renders `lucide-swatch-book` ahead of the `<h2>Presets</h2>` title, the
   whole strip renders no `lucide-sliders-horizontal`, and the toolbar toggle
   still renders sliders with no swatch book — pinning the two surfaces as
   visually distinct).

## Decisions

- **`SwatchBook`, not `Palette`.** `Palette` was the obvious color motif, but
  it already labels the "Hue & Saturation" section in the Inspector — reusing
  it would have traded one same-icon confusion for another. `SwatchBook`
  reads as a collection of color swatches (exactly what the strip shows) and
  had zero existing uses.
- **Change the strip, not the toggle.** The brief asks for a distinct
  "Color Presets" icon that stands apart from the generic Presets icon, so
  the color-related surface takes the new glyph and the generic chrome keeps
  the old one.
- **No README change.** The README documents no icons; this is a one-glyph
  visual fix, not an architecture change.

## Verification

- `yarn workspace @f8/ui test`: 39 files, 312 tests, all pass (308
  pre-existing + 4 new).
- `yarn workspace @f8/ui typecheck`: clean.
- Playwright not run (per brief).
