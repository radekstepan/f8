# 14 — One-Click Removal and Dust Spots run from right-aligned header ML buttons

## Request
"Why is ML in One-Click Removal and Dust Spots not aligned to the right???"

## Previous state
Both repair sections rendered the shared `AdjustmentSection` with a
static gold `MlBadge` next to the title (left side, inside the disclosure
button) and no header action, while detection lived in the content as a
full-width `Remove people` / `Find dust spots` bar
(`object-removal-detect`, `dust-spots-detect`). Every other ML section
runs from the shared right-aligned header ML button (`AdjustmentSection`
`ml` prop, `*-ml` test ids, `.section-actions` row with
`margin-left: auto`) — Denoise converged in Task 4; these two were the
last badge holdouts in section headers. (Topbar menus, photo labels, and
the export super-resolution row keep the badge — those are menu/label
contexts, not section headers.)

## Change
- `packages/ui/src/components/Inspector.tsx`
  - New `RemovalSection` / `DustSpotsSection` wrappers (the
    `DenoiseSection` precedent): they render `AdjustmentSection` with
    the shared header action
    `ml={{ id: 'object-removal' / 'dust-spots', … }}` — label "ML",
    `ml-button` class, `object-removal-ml` / `dust-spots-ml` test ids,
    right side in `.section-actions` like elsewhere. The title badges
    are gone.
  - The header ML drives detection in every state: `onToggle: onDetect`
    with `applied: false`, `canRevert: false`, and no reset — the
    assist is ephemeral (apply dismisses back to idle; the strokes live
    in the Repairs section from there), so there is nothing to
    highlight or restore. `onRevert: onDismiss` keeps the contract
    honest though it is unreachable (no snapshot, no reset renders).
  - `disabled` while detecting (Denoise precedent) so a second click
    cannot re-fire detection, and per-state `title` overrides (the
    Denoise `title` prop): idle reuses the old detect bars' copy
    verbatim ("Find people with ML, then review before removing" /
    "Find dust spots with ML, then review before repairing"), working
    says "Detecting …", ready/error say "Detect … again" (the removal
    one matches its Retry title).
  - The content idle state is now the explanatory note only (Face
    Enhance pattern). The Cancel/Dismiss/Retry/Apply rows are untouched
    (Task 15 owns their alignment).
  - The `MlBadge` import is dropped (`noUnusedLocals`); the badge
    component and `.ml-badge` CSS stay for the menu/label/export uses.
    No `AdjustmentSection` change (optional `disabled`/`title` already
    exist) and no `App.tsx` change (the assists already expose
    `onDetect`/`onDismiss`).

## Tests
- `objectRemoval.test.tsx` / `dustSpots.test.tsx`: the idle tests are
  re-pinned to `*-ml` (`ml-button` + `aria-pressed="false"`,
  `>ML</button></div>` closing the shared row,
  `<h3>…</h3></button>` with the badge gone, detect testids and
  `>Label</button>` swept, the note kept, the idle tooltip pinned).
  One new test per file pins the header ML idle-styled
  (`aria-pressed="false"`, never `is-active`) across idle/ready/error,
  `disabled` with the "Detecting …" tooltip only while detecting, and
  no `Reset …` reset in any state.
- `repairSections.test.tsx`: the badge-heading test becomes a
  both-sections header-button loop (heading-bounded slices pin
  `section-actions` + `*-ml` present, `ml-badge` absent, and the
  row-close regex; `.section-actions` `margin-left: auto` pinned).
  The golden-link test's idle block now pins detect-bar absence plus
  the header buttons (ready/error pins untouched).
- Full `@f8/ui` suite (34 files / 276 tests) passes; `@f8/ui` build
  plus `@f8/ui` and `@f8/web` typechecks pass; lint is an unconfigured
  no-op echo. No Playwright (per task rules); no e2e spec references
  the removed selectors.

## Decisions
- Re-detect on every header click, including while reviewing a list —
  not dismiss, not a dead toggle-off. The shared contract is "revert
  when highlighted, otherwise apply fresh", and with no persistent
  applied state the button never highlights, so a click is always a
  fresh detect. Face Enhance behaves identically while its result is
  still unapplied, and a header button that ignores clicks would feel
  broken (Task 4). The "Detect … again" tooltip states this honestly.
- No reset on either section: nothing section-scoped persists (strokes
  undo via Repairs / global undo), so a reset would have nothing to
  restore — the absence is pinned.
- No README update: header-control convergence, no architecture or
  feature-surface change (the same call as Task 4).
