---
'@f8/core': minor
'@f8/ui': minor
---

Pressing either Compare button now shows the full original immediately — no more 400ms hold delay — while a quick click still toggles the side-by-side split. Shift+click (or Shift+B) pins the full original until toggled off, and a plain click unpins it.

## Task writeup (docs/tasks/64-compare-original.md)

## Request

"Holding compare to original should be immediate showing the original,
if it's difficult to do, let's do Shift + click as the compare whole
picture."

## Change

Did both: the hold is now truly immediate, and Shift+click pins the
whole original as a deliberate flicker-free alternative.

- `packages/core/src/compareHold.ts`: the hold machine no longer waits
  out a 400 ms timer before showing the original. `press()` fires
  `onHoldChange(true)` synchronously on pointer down; the timer now only
  classifies the gesture — a release inside `COMPARE_CLICK_WINDOW_MS`
  (400 ms, renamed from `COMPARE_HOLD_DELAY_MS`) hides the original and
  clicks through to the split toggle, while a release past it hides the
  original and suppresses the toggle. Protocol (`press`/`release`/
  `click`) and the injectable scheduler are unchanged.
- `packages/ui/src/hooks/useCompareHold.ts`: takes an optional second
  callback `onShiftClick`. `filterClick` routes Shift+click to it (never
  toggling the split); `holdProps.onPointerDown` skips the press for
  Shift (so release stays a no-op and the original never flashes) and
  for non-primary buttons (right/middle click never peeks).
- `packages/ui/src/components/Topbar.tsx`: new `'compare-whole'`
  `MenuAction`; `Toolbar` takes `onToggleWholeOriginal` and passes it
  to the hold hook; the enabled tooltip now reads "Compare with
  original (B) — hold to peek, Shift+click for full original". The
  accessible name is unchanged.
- `packages/ui/src/components/PhotoCanvas.tsx`: the canvas-status
  Compare button gets the same `onToggleWholeOriginal` wiring and
  tooltip. No canvas paint changes: the pinned whole-original reuses
  the existing `showOriginal` full-cover layer.
- `apps/web/src/App.tsx`: new `compareWhole` state, OR-ed into the
  canvas as `showOriginal={showOriginal || compareWhole}` so hold-peek
  (`\`, button hold) and the pin compose. `compare-whole` toggles the
  pin behind the same crop/no-edits guard; both plain-compare paths
  (toolbar `compare` action, canvas `onCompare`) unpin first instead of
  toggling the split; Shift+B toggles the pin (before the plain-key
  map, so it never hits `compare`); reset, crop entry, and Escape all
  exit the pin alongside the split.
- `docs/features.md`: the History-and-compare bullet and the Shortcuts
  table mention the immediate hold, Shift+click / Shift+B pin, and the
  click-to-unpin behavior.

## Decisions

- Both approaches, not either/or: immediate hold is what was asked for
  and turned out to be easy (classify on release instead of delaying on
  press); Shift+click covers the case the user anticipated (a
  deliberate whole-picture compare with zero hold ambiguity) and gives
  keyboard parity via Shift+B for free.
- The 400 ms value stays, repurposed as a click window: normal clicks
  (~100 ms) still toggle the split, so the only cost of immediacy is a
  sub-click-length flash of the original on plain clicks — inherent to
  any immediate hold, and invisible in practice.
- The pin is a persistent mode like the split (survives photo switches),
  while the transient `\`/button hold still clears on photo change.
- Plain click while pinned unpins without toggling the split: one click
  always returns to a predictable view instead of toggling something
  hidden under the pin.
- Shift+click skips the hold press entirely rather than press-then-pin:
  no flash, and release is a safe no-op.
- No README.md update: this changes interaction timing and adds a
  gesture, not architecture — `docs/features.md` is the right level.

## Tests

- `packages/core/src/compareHold.test.ts` (rewritten, 10 tests):
  synchronous show on press, hide on release, window classification
  (quick release clicks through, late release suppresses), one-shot
  suppression, window cancel on early release, no-op release/click,
  double-press and multi-touch safety, fresh re-arm after a cycle.
- `packages/ui/src/components/compareHold.test.tsx` (16 → 23 tests):
  updated tooltip + `useCompareHold(onHoldOriginal,
  onToggleWholeOriginal)` wiring pins, plus new pins for the
  Shift+click route, the press skip (Shift + non-primary buttons), the
  `compare-whole` action, Shift+B, the OR-ed `showOriginal`, unpin-first
  on both compare paths, and pin exits (reset, crop, Escape).

## Verification

- `yarn workspace @f8/core test`: 67 files, 1157 tests, all pass.
- `yarn workspace @f8/ui test`: 87 files, 688 tests, all pass.
- `yarn typecheck` and `yarn build`: clean.
- No Playwright (per task rules).
