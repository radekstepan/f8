# Task 05 — Remove-from-library bottom-right + photo-view action

## What changed

- `apps/web/src/index.css`
  - `.browser-remove` (library grid card trash): `left/top` → `right: 6px;
    bottom: 6px`, i.e. bottom-right of the card. Hover/focus reveal,
    blurred pill background, and danger hover tint unchanged.
  - New `.photo-rating .photo-remove:hover` danger tint (`#f29c97`),
    matching the grid card's remove hover.
- `packages/ui/src/components/PhotoCanvas.tsx`
  - New optional `onRemove?: () => void` prop. When provided, the
    photo-view heading renders a trash `IconButton` after the favorite
    heart, labeled `Remove from library (Del)`; when omitted, no button
    renders (favorite untouched).
- `apps/web/src/App.tsx`
  - Photo view wires `onRemove={() => requestRemove(photo.id)}`, reusing
    the existing confirm dialog (`dialog === 'remove'`) and the
    `library.removePhoto` flow — no new delete path.
- Tests (new `vitest` setup in `@f8/ui`, no new dependencies):
  - `packages/ui/vitest.config.ts` — node env, `src/**/*.test.{ts,tsx}`.
  - `packages/ui/package.json` — `test` script mirroring `@f8/core`, so
    `turbo run test` now covers `@f8/ui`.
  - `packages/ui/src/components/removeFromLibrary.test.tsx` — 6 tests
    (server-rendered markup via `react-dom/server`, no jsdom):
    - browser renders one `browser-remove` button per photo with
      `Remove <name> from library` labels; none without `onRemove`;
    - CSS pin: the `.browser-remove` rule declares `right` + `bottom`
      (absolute) and no `left`/`top`;
    - photo view renders `Remove from library (Del)` / `.photo-remove`
      iff `onRemove` is provided, favorite stays;
    - the `remove` dialog names the photo, promises the file on disk is
      never deleted, and renders the danger `Remove` button.

## Decisions

- **Bottom-right of the card, not the thumbnail.** The grid overlay
  buttons are siblings of the open button (nesting a button inside the
  open button would be invalid HTML), so the rule anchors to the whole
  card. The caption is left-aligned with right-side whitespace, and the
  button only appears on hover/focus with a blurred pill, so it does not
  fight the filename in practice.
- **Photo-view button next to the favorite heart**, not in the bottom
  status bar: the heading is the per-photo action cluster, and the zoom
  cluster owns the bar's right side. The Del shortcut and the Image-menu
  entry already worked globally (including the photo view) and are
  already documented in the shortcuts dialog, so no shortcut/menu change
  was needed.
- **SSR markup tests instead of jsdom.** The repo has no DOM test
  infra; `react-dom/server` (already a transitive dep via `react-dom`)
  pins the wiring without new packages. Click behavior stays covered by
  the existing manual/playwright surface, not run here per instructions.
- **Album removal untouched** — that is task 06.

## How verified

- `node ../../node_modules/vitest/vitest.mjs run
  src/components/removeFromLibrary.test.tsx` (ui) — 6 pass.
- `yarn test` (turbo, all workspaces) — 5 tasks successful, incl. core
  514 pass and the new ui suite.
- `yarn typecheck` (turbo, all workspaces) — passes.
- Grep over `apps/web/tests` confirms no e2e spec references
  `browser-remove` / `photo-remove` / `onRemove`, so no spec update.
- Playwright was not run (per task instructions).
