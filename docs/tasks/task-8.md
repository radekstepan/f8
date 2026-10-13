# Task 8: Rethink the All Photos backlink as a quiet single-line back button

Task: The backling to all photos is ugly. Rethink it and make it
beautiful. And make sure it works when sidebar is on/off.

## What changed

- `packages/ui/src/components/Topbar.tsx`
  - The editor backlink is now a single-line ghost button: a 14px
    lucide chevron (decorative, `aria-hidden`) plus the collection
    name — no circled-chevron badge, no stacked `backlink-text`
    block, no `N photos` second line.
  - Tooltip now reads `Back to {name} (G)`, advertising the
    existing G shortcut (the `grid` toggle also lands in the
    library from the editor).
  - The library-grid static title went single-line to match:
    name plus an inline `.collection-count` span, replacing the
    `<small>` second line and the magic `padding-left: 32px`
    (which only existed to align with the old two-line pill).
  - Behavior unchanged: editor-only, one button, dispatches the
    one-directional `back` action; the grid still shows static
    text with no control.
- `apps/web/src/index.css`
  - `.photo-backlink`: transparent ghost button, 32px tall,
    7px radius, quiet grey text; hover adds a subtle wash and
    brightens the label; the chevron stays dim until hover,
    when it nudges left 2px (3px on press) and tints accent.
    Focus uses the shared global `button:focus-visible` ring.
  - `.collection-breadcrumb`: `min-width: 0` + `flex: 0 1 auto`
    instead of a fixed 152px slot; `.backlink-name` /
    `.collection-name` ellipsize with a 200px cap (stepped
    down at 1180/1020/850/760px breakpoints), so long names
    truncate instead of pushing the editing tools aside.
  - Removed the now-orphaned `.backlink-text` rules and the
    fixed `min-width` breadcrumb overrides.
- `packages/ui/src/components/photoBacklink.test.tsx` (rewritten)
  - Pins the single-line button (name, aria-label, decorative
    chevron; asserts the count line and stacked block are gone),
    the single-button markup, the `(G)` tooltip, the
    `back`-not-`grid` wiring, the static grid title with inline
    count, the ghost/hover/nudge/ellipsis styling, and sidebar
    independence (no sidebar prop, no `.has-sidebar` gating,
    never `display: none`, flexes with `min-width: 0`).

## Decisions

- **Dropped the count from the button.** `N photos` on the way
  back was noise — the same count already lives in the grid
  title and the status bar. The backlink's only job is to say
  where "back" goes.
- **Dropped the circled chevron badge.** A bordered disc plus a
  two-line label read as a widget, not navigation; a bare
  chevron + label matches the macOS-back-button idiom and the
  toolbar's otherwise flat icon language.
- **Sidebar on/off needs no special case.** The old fixed
  `min-width` slot is what made the sidebar toggle (window
  toolbar 204px vs 131px, overlay mode under 1020px) a risk;
  a flexing breadcrumb with ellipsis is robust to all three
  by construction, and the test pins that no rule gates the
  breadcrumb on `.has-sidebar`.
- **Kept the editor-only / static-grid contract** from R2-12
  (`shouldShowPhotoBacklink`, one-directional `back`): this
  task rethinks the look, not the navigation semantics.

## LEARNINGS

- Fixed `min-width` slots in a flex toolbar are fragile across
  panel toggles: prefer `min-width: 0` + `text-overflow:
  ellipsis` so the block degrades gracefully when siblings
  resize (sidebar open/closed, overlay mode).
- Magic alignment padding (`32px` to match a sibling's badge)
  is a smell that the two variants diverged — unifying both
  onto one single-line shape deleted the constant instead of
  re-tuning it.
- When restyling, grep the responsive overrides too: four
  breakpoints carried `min-width`/`.backlink-text` rules for
  the old shape that would have silently re-broken the new
  one at narrow widths.
