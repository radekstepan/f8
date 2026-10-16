---
'@f8/ui': patch
'@f8/web': patch
---

The editor filmstrip no longer shows the "Show photo browser" button in its header actions; the library stays reachable via the G shortcut and the Photo Browser menu entry.

## Task writeup (docs/tasks/37-filmstrip-browser-button.md)

## Request

Remove the "Show photo browser" button from the film strip at the bottom.

## Change

- `packages/ui/src/components/PhotoStrips.tsx`
  - The `Filmstrip` header no longer renders the `Show photo browser (G)`
    `IconButton` (the `Grid2X2` glyph sat next to the sort toggle in
    `.filmstrip-actions`).
  - The now-dead `onGrid` prop is removed from the `Filmstrip` signature
    (destructure + type). The `Grid2X2` import stays: `PhotoBrowser`
    still uses it for the grid-size slider glyph and the empty-library
    illustration.
- `apps/web/src/App.tsx`: the `Filmstrip` call site drops
  `onGrid={() => setView('library')}`.
- Tests: the seven `Filmstrip` call sites in `sortAlbum.test.tsx`,
  `photoContextMenu.test.tsx`, and `filmstripSingleRow.test.tsx` drop
  `onGrid={noop}`; `filmstripSingleRow.test.tsx` gains a regression test
  asserting the rendered strip contains no "Show photo browser" button.

## Decisions

- **Removed the prop, not just the button.** Leaving an `onGrid` callback
  that nothing invokes would strand a dead contract and mislead the next
  caller; the only consumer was the deleted button.
- **Kept every other route to the library.** The `G` keyboard shortcut,
  the `grid` menu action, and the Photo Browser menu entry are untouched —
  the task names only the filmstrip button. (`onGridPointerDown`, the
  `PhotoBrowser` marquee handler, is unrelated and stays.)
- No README update: a single-button removal with no behavior or
  architecture change.

## Tests

- New `filmstripSingleRow.test.tsx` test pins the button's absence in the
  rendered footer markup.
- UI suite: 71 files / 557 tests pass. `typecheck` clean for `@f8/ui`
  and `@f8/web` (after rebuilding the gitignored `@f8/ui` dist, which
  `@f8/web` typechecks against). No Playwright, per the task rules.
