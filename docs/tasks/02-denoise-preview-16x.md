# 02 — Denoise preview: After-only first row, 16× closeups, focus rect

## Request
"Denoise preview do a 16x and show just 'After' in the first row, don't need
the 'Before'. Then 'Before - 16x' and 'After - 16x'. And show in the After a
little rectangle/square that shows where are looking at/focusing."

## Previous state
The preview-ready block in `DenoiseControl`
(`packages/ui/src/components/Inspector.tsx`) rendered a two-up
`denoise-compare` row (Before + After thumbnails) with a 4× closeup pair
below (`Before · 4×` / `After · 4×`, `.denoise-zoom` at
`background-size: 400%`). Clicking anywhere in the two-up row moved the
loupe. There was no indicator of which patch the closeups magnified.

## Change
- `packages/ui/src/components/Inspector.tsx`
  - First (`denoise-compare`) row now renders only the After figure
    (`denoise-after` + `<figcaption>After</figcaption>`); the Before
    thumbnail and its `denoise-before` test id are gone. The click-to-move
    loupe handler is unchanged — it already measured against the row rect,
    so it works identically on the single full-width After image.
  - The After image is wrapped in `.denoise-after-wrap` (positioning
    context) with an overlaid `.denoise-focus-rect`
    (`data-testid="denoise-focus-rect"`, `aria-hidden`), centered on the
    loupe via inline `left`/`top` and clamped by the new
    `clampDenoiseFocus` helper so the rect never hangs off the image edge.
  - `DenoiseCloseup` is now 16×: captions `Before · 16×` / `After · 16×`,
    aria-labels `… at 16x magnification`, compare-row title `Click to move
    the 16× closeup`. The applied-state "proof" closeup reuses the same
    component, so it moved to 16× as well.
- `apps/web/src/index.css`
  - `.denoise-zoom`: `background-size: 400%` → `1600%` (16×, still
    `no-repeat`).
  - New single-selector rules (kept separate for the `cssRule(selector)`
    test helper): `.denoise-after-wrap { position: relative }` and
    `.denoise-focus-rect` — absolute, `width: 6.25%` (= 1/16 of the
    preview width), `aspect-ratio: 1 / 1`, centered with
    `translate(-50%, -50%)`, white border + dark outline shadow so it
    reads on any photo, `pointer-events: none` so clicks still reach the
    loupe mover.
- Idle copy (`How it works…`, preview button titles) intentionally
  untouched: "small before/after" still describes the closeup pair.

## Tests
- Updated `packages/ui/src/components/denoise.test.tsx` (repo convention:
  server-rendered, no jsdom + CSS rule pinning):
  - first-row test renamed and re-asserted: After-only (no
    `denoise-before`, no Before caption), focus rect present,
    `aria-hidden`, default `left:50%;top:50%`, inside
    `.denoise-after-wrap`;
  - closeup test moved to 16× (captions, aria-labels, move title) and
    pins the pair renders below the After row;
  - zoom CSS test moved to `1600%` + `no-repeat`;
  - new test pins the focus-rect CSS contract (absolute, 6.25%,
    square, centered, bordered + shadowed, click-through) and the
    relative wrap.
- Full `@f8/ui` suite (29 files / 231 tests) passes; `@f8/ui` and
  `@f8/web` typechecks pass. No Playwright (per task rules). No other
  test files referenced the old Before first row, 4× strings, or 400%.

## Decisions
- Captions keep the existing `·` / `×` convention (`Before · 16×`) rather
  than the task text's literal `Before - 16x`; the aria-labels keep the
  ASCII `16x` spelling, so both spellings are greppable.
- The focus square is exactly the sampled patch, not an approximation: the
  square zoom box at 16× always shows a W/16 × W/16 region of the preview
  regardless of photo aspect, so `width: 6.25%` + square aspect is the
  true viewfinder (center-exact; edge clicks clamp the rect inside).
- Rect is white, not gold: gold text/links are reserved for actions, and a
  white viewfinder with a dark outline reads on any photo.
- No README update: layout/magnification change only, no architecture or
  feature-surface change.
