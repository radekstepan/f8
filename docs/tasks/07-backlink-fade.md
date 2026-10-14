# Task 7: Fade in photo backlink without placeholder bar

## Problem

In photo view, while the photo's album was still being resolved (hard
reload of a photo URL — the collection starts at the `'all'` placeholder
and the real album is adopted after the first paint), the toolbar
backlink slot showed a shimmering gray pill (`.backlink-pending`, a
118px-wide bar). It read as a weird horizontal bar rather than a loading
state. The task: show nothing during that phase, then fade the backlink
in with the album name.

## Change

- `packages/ui/src/components/Topbar.tsx`: the pending branch
  (`showBacklink` with a null/empty `collectionName`) now renders `null`
  — the breadcrumb stays empty — instead of the shimmer
  `<span className="backlink-pending">`. Prop doc updated.
- `apps/web/src/index.css`:
  - Removed the `.backlink-pending` rule and the `backlink-shimmer`
    keyframes entirely (no placeholder markup remains to style).
  - `.photo-backlink` gained `animation: backlink-in 250ms ease-out`,
    with new `@keyframes backlink-in` fading opacity 0 → 1. The button
    mounts only when the album name is known, so the animation runs
    exactly on arrival — a pure fade, no slide/scale, so the link never
    drifts while appearing.
  - The `prefers-reduced-motion` block now disables the backlink fade
    (`.photo-backlink` replaces `.backlink-pending` there): reduced-motion
    users get the link instantly.
- Comments updated to the new contract ("render nothing, then fade in"):
  `apps/web/src/App.tsx` (two comments), `packages/core/src/photoBacklink.ts`
  doc, `Topbar.tsx` prop doc. No logic changed in `App.tsx` or
  `photoBacklink.ts` — the `null`-while-unknown protocol is unchanged,
  only its rendering.

## Decisions

- Render `null`, not an empty/reserved-size span. An invisible spacer
  would still shift the toolbar layout when the real link lands; nothing
  means nothing, and the fade covers the arrival.
- Opacity-only keyframes. The sibling entrance animations (`photo-in`,
  `sidebar-in`) combine opacity with a small transform, but a drifting
  backlink next to the sidebar toggle would look like layout settling —
  the test pins "no transform" deliberately.
- 250ms ease-out: matches the feel of the other toolbar-adjacent motion
  without drawing attention on every photo switch.

## Tests

- Rewrote `packages/ui/src/components/backlinkPending.test.tsx` for the
  new contract: pending renders a strictly empty breadcrumb
  (`<div class="collection-breadcrumb"></div>` — no button, no span, no
  text), empty name behaves the same, the known-name backlink and the
  library static title are unchanged, the App `backlinkName` wiring is
  still pinned, the stylesheet contains no `backlink-pending` /
  `backlink-shimmer` remnants, and the `backlink-in` fade (opacity-only,
  reduced-motion disabled) is pinned from CSS.

## Verification

- `packages/ui`: full suite — 60 files, 475 tests, all pass (includes
  the rewritten `backlinkPending` plus the untouched `photoBacklink`
  and `collapsedBacklinkFlush` suites).
- `packages/core`: `photoBacklink` + `collections` — 24 tests pass.
- `typecheck` clean in `packages/ui` and `apps/web`.
- Playwright not run (out of scope per task rules).
