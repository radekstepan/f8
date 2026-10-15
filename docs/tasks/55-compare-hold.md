# Task: Hold Compare to peek at the original + disable with no edits

## Request

"Compare with Original" shows a tool to compare side by side. If you
hold clicking on the button instead, it'll show the original version
while holding the button. And the button should be disabled if there
were no edits on the picture.

## Change

- `packages/core/src/compareHold.ts` (new): press-and-hold state
  machine shared by both Compare buttons. `press()` on pointer down
  arms a `COMPARE_HOLD_DELAY_MS` (400 ms) timer; when it fires the
  machine reports holding until `release()` (pointer up / leave /
  cancel). `click()` returns false once after a hold so the release
  click does not also toggle the split; a quick press-and-release
  clicks through to the normal toggle. The scheduler is injectable
  so tests drive the delay without timers.
- `packages/ui/src/hooks/useCompareHold.ts` (new): thin React wrapper
  (real timers + unmount cleanup that releases a mid-hold timer).
  Returns `holdProps` to spread on the button and `filterClick` to
  route the click through.
- `packages/ui/src/components/Topbar.tsx`: the toolbar Compare
  button takes `canCompare` (default true) and `onHoldOriginal`,
  routes its click through the hold filter, and is disabled while
  cropping (existing) or with no edits (new, labeled "Compare with
  original (no edits yet)"). The enabled tooltip advertises the
  hold: "Compare with original (B) — hold to peek at the original".
  The accessible name is unchanged, so existing order/gating tests
  still match.
- `packages/ui/src/components/EditorUI.tsx`: `IconButton` accepts a
  `data-tooltip` override (defaults to the label) so the hold hint
  does not change the accessible name.
- `packages/ui/src/components/PhotoCanvas.tsx`: the canvas-status
  Compare button gets the same `canCompare` / `onHoldOriginal`
  wiring ("Compare is unavailable until you edit the photo" when
  clean). No canvas paint changes: the existing `showOriginal`
  full-cover layer (previously only reachable via the `\` key)
  already shows the full original while hiding the split labels and
  divider, and releasing restores the previous compare state.
- `apps/web/src/App.tsx`: one `hasEdits = !isDefaultEdit(editor.edit)`
  check feeds the menu item (`compareDisabled`), both buttons
  (`canCompare`), and both hold callbacks (`onHoldOriginal` =
  `setShowOriginal`); the `compare` action (B shortcut) also ignores
  when the recipe is default. Reset now exits the split
  (`setCompare(false)`), since a reset leaves two identical halves
  behind a disabled button.
- `docs/features.md`: the History-and-compare bullet and the Hold-`\`
  shortcut row mention the button hold and the disabled-while-clean
  behavior.

## Decisions

- "No edits" is `isDefaultEdit` (the exact Reset predicate),
  not `isOriginalLook`: compare must stay meaningful for
  geometry-only edits (crop/rotate/straighten change the framing
  the Original layer is compared against) and retouches. Reset and
  Compare now agree on what "edited" means.
- Both Compare buttons (toolbar + canvas status) hold, not just
  one: they are the same action in two places, and holding one
  while the other click-toggles would be incoherent.
- 400 ms hold threshold: long enough that a normal click never
  flashes the original, short enough that an intentional hold
  feels instant.
- Keyboard activation (Enter/Space) stays click-only: hold is a
  pointer gesture, and the `\` key already covers keyboard peek.
- Reset exits the split; undo-to-default does not auto-exit (out
  of scope — only entry points are gated plus the reset case,
  where staying in compare would strand identical halves).
- `canReset` keeps its inline `!isDefaultEdit(editor.edit)` form
  instead of reusing `hasEdits`: `toolbarReset.test.tsx` pins that
  literal expression as its contract.

## Tests

- `packages/core/src/compareHold.test.ts` (new, 10 tests): delay,
  hold/release notification, release-click suppression (+ one-shot
  consumption), quick-click passthrough, timer cancel on early
  release, no-op release/click without press, double-press and
  multi-touch safety, fresh re-arm after a cycle.
- `packages/ui/src/components/compareHold.test.tsx` (new, 16
  tests): toolbar/canvas disabled markup + reasons, enabled
  defaults, hold-hint tooltips, hold-filter wiring pins (Topbar +
  PhotoCanvas source), full-original-not-split pins, App wiring
  pins (`hasEdits`, `canCompare`/`onHoldOriginal` on both
  components, menu `compareDisabled`, B-shortcut guard, reset
  exits compare).

## Verification

- `yarn workspace @f8/core test`: 64 files, 1094 tests, all pass.
- `yarn workspace @f8/ui test`: 83 files, 634 tests, all pass.
- `yarn typecheck` and `yarn build`: clean.
- No Playwright (per task rules).
