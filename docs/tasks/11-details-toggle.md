# 11 — Details drops its header toggle

## Request
"Why does 'Details' have a toggle button? Every other control just
expands/collapses without the little checkbox?"

## Previous state
The Details section was the only slider category with a header toggle
(`aria-label="Show details"`). The toggle drove the `detailsVisible`
local state — the exact same state the disclosure chevron drove via
`open`/`onOpenChange`. Two controls, one state: the toggle was a pure
duplicate of the chevron.

## Audit: what the toggle actually did
Git history (`4be871b`, `e4420af`) tells the story:

- Before `4be871b`, every category toggle was a REAL effect bypass:
  Details used `enabled={edit.detailsEnabled}` with
  `onToggle={() => onChange({ detailsEnabled: !edit.detailsEnabled })}`,
  disabling its sliders while off.
- `4be871b` ("ML button + revert per adjustment category") converted ALL
  category toggles from effect-bypass to visibility-only local state.
  The `detailsEnabled` recipe flag survived only for legacy recipes:
  `rangeEnabled` re-enables it on the first manual slider move, and core
  still gates clarity/sharpness/grain rendering on it.
- `e4420af` then removed the visibility toggles from the ML sections,
  leaving Details as the sole leftover.

So at removal time the toggle carried ZERO semantics: it never read or
wrote `edit.detailsEnabled` (no UI path sets that flag to false
anymore), and White Balance / Lightness / Hue & Saturation already
demonstrate the converged pattern — `rangeEnabled` sliders, no toggle.
Nothing needed converging; the toggle was deleted outright.

The one remaining `AdjustmentSection` toggle consumer, Black & White,
is out of scope: its toggle carries real effect state
(`onChange({ blackAndWhite })`), so the shared `onToggle`/`enabled`/
`toggleLabel` props stay.

## Change
- `packages/ui/src/components/Inspector.tsx`
  - Details drops `enabled`/`onToggle`/`open`/`onOpenChange` and the
    `detailsVisible` state; it is now `initiallyOpen={openedExtra ===
    'Details'}` — byte-for-byte the Curves/Effects shape (self-managed
    disclosure, starts collapsed). The slider children
    (`rangeEnabled('detailsEnabled', ...)` x3) are untouched, as is the
    `key` remount pattern.
  - No reset added: Task 12 owns the Details reset. The change is
    compatible — Task 12 only needs to add `onReset` + `dirty` to this
    section, exactly like Curves/Effects.

## Tests
- New `packages/ui/src/components/detailsToggle.test.tsx` (repo
  convention: server-rendered, no jsdom):
  - no `Show details` / `role="switch"` / `aria-checked` in the Details
    slice (bounded by the Details and Effects headings);
  - collapsed-shape parity with Curves (`is-collapsed`,
    `aria-expanded="false"`, chevron-right, sliders hidden);
  - dirty Details sliders stay toggle-free (no conditional toggle);
  - `detailsEnabled` semantics preserved: flag still defaults on,
    source-level pin that all three sliders still flow through
    `rangeEnabled('detailsEnabled', ...)` (static markup cannot observe
    the `onChange` closure; the source-read precedent is
    `collapsePanels.test.tsx`), and a legacy-disabled recipe still
    renders its collapsed heading;
  - the shared `onToggle` path still renders a switch for semantic
    toggles (the Black & White shape).
- Updated `adjustmentMl.test.tsx`: the header-controls tests now pin
  toggle absence + collapsed-by-disclosure for Details; file header and
  describe names drop the "visibility toggles" wording.
- Full `@f8/ui` suite (33 files / 266 tests) passes; `@f8/ui` and
  `@f8/web` typechecks pass (`ui` dist rebuilt first — web resolves
  `@f8/ui` from dist); lint is an unconfigured no-op echo. No
  Playwright (per task rules).

## Decisions
- Delete, don't converge: since `4be871b` no UI state flows through the
  toggle, there was no enable/disable semantic to preserve in the
  header. The real `detailsEnabled` semantics (recipe flag + core
  gating + slider re-enable) are untouched and covered by existing
  core tests plus the new wiring pins.
- Match Curves/Effects exactly (`initiallyOpen`) rather than keeping
  Details controlled-open without a toggle: one shape for all three
  plain sections, and Task 12 gets a uniform reset target.
- Kept `onToggle` on `AdjustmentSection`: Black & White's semantic
  toggle still needs it, and deleting a shared prop for one consumer's
  sake would churn the contract.
- No README update: header-control removal, no architecture or
  feature-surface change.
