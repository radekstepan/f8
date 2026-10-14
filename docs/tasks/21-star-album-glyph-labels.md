# Task: Star smart album labels show star glyphs

## Request

Don't name smart "star" albums based on how many stars they have.
Show that many stars instead!

## Change

- `packages/core/src/collections.ts`: `ratingCollectionLabel` now
  returns that many ★ glyphs (`"★".repeat(rating)`) instead of the
  "5 Stars" / "1 Star" wording. The sidebar rows and the grid/backlink
  titles both resolve through this helper, so one change covers the
  sidebar Library rows and the album-grid titles.
- `apps/web/src/App.tsx`: comment on `titleForCollection` updated
  ("★★★★★" instead of "5 Stars"); no logic change.
- Tests updated to the glyph labels (same coverage, plus an explicit
  3-star case in core).

## Decisions

- **★ (U+2605 BLACK STAR) text glyph, not emoji.** Renders as plain
  text in the sidebar font, no emoji presentation, and satisfies the
  no-emoji-icons constraint. No new icon component needed.
- **Singular/plural logic deleted.** Glyph repetition has no plural
  form, so the special case is gone rather than kept dead.
- **Sidebar row icon unchanged.** Each star-album row keeps its
  single Lucide `Star` icon (marks the row type); the label now
  carries the count as glyphs.
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so core and ui were rebuilt
  after the change for tests/typecheck; the rebuild stays untracked.
- **No README update.** A label-string change introduces no
  architecture change or complex feature.

## Tests

- `packages/core/src/collections.test.ts` (updated label test):
  1→"★", 3→"★★★", 5→"★★★★★". Core suite: 54 files / 952 tests
  pass. The updated test was run before the implementation change
  and failed as expected (`"1 Star"` vs `"★"`).
- `packages/ui/src/components/starSmartAlbums.test.tsx` (updated, 5
  tests): glyph rows highest-first via full-span matches (bare
  substrings would collide: "★★★" is inside "★★★★★"), per-rating
  counts, selected-row highlight, single-glyph 1-star label. UI
  suite: 66 files / 526 tests pass.
- `typecheck` clean for core, ui, and web. No Playwright, per
  the task rules.
