# Task 12: Photo backlink rethink

The toolbar breadcrumb fired the `grid` view toggle in both views, so
clicking "All Photos" while already in the library grid carried the user
into a single photo. The breadcrumb is now a real backlink: on an open
photo it shows a backlink pill (chevron ring + collection name + count)
that goes back to the collection; in the library grid the same block is
static text with no control at all, so the misnavigation is impossible
by construction.

## What changed

1. **Pure predicate** (`packages/core/src/photoBacklink.ts`). New
   exported `shouldShowPhotoBacklink(view)`: true only in `editor`.
2. **One-directional action** (`packages/ui`, `apps/web`). New
   `MenuAction` `'back'`; App handles it with an unconditional
   `setView('library')` — never the `grid` toggle. The `grid` toggle
   itself is untouched (G shortcut + menus keep their explicit
   toggle semantics).
3. **Toolbar** (`packages/ui/src/components/Topbar.tsx`). The
   `libraryView: boolean` prop becomes `showBacklink: boolean` (App
   derives it from the predicate). Editor view renders one
   `.photo-backlink` button (`aria-label="Back to {collection}"`,
   chevron-left in a ring, name + count); library view renders a
   static `.collection-title` div — zero buttons.
4. **Styling** (`apps/web/src/index.css`). The pill gets a hover wash,
   a chevron that eases left and warms to the accent color on hover
   (deeper on `:active`), ellipsis for long album names, and the
   global accent focus ring. The static grid title is padded 32px so
   its text aligns exactly with the pill text (chevron 24 + gap 8):
   no horizontal jump when navigating photo ↔ grid. The old
   small-screen rule that hid the arrow is gone — the pill stays
   whole and clickable on mobile.
5. **Tests:** 2 new cases in `photoBacklink.test.ts` (editor shows,
   library hides); 6 new cases in `photoBacklink.test.tsx` (pill
   markup + naming, single-button control, `back`-not-`grid` wiring
   pinned from Topbar/App sources, grid renders no control, pill
   hover/nudge styling, sidebar-independence). Two existing Toolbar
   renders updated for the prop rename.

## Decisions

- **Gone in the grid, not disabled.** A disabled backlink in the
  library would still invite the question "back to what?"; static
  text removes the wrong affordance entirely (the grid heading
  already titles the collection).
- **View-gating per Task 11's lesson.** The correct behavior depends
  on the view, so it ships as a tested pure predicate in `@f8/core`
  consumed by App — the same seam as `shouldEscapeToLibrary` and
  `resolveCollectionClick`.
- **Sidebar-proof by placement.** The link lives in the toolbar,
  which renders regardless of sidebar state, and `ToolbarProps`
  takes no sidebar prop; a test pins that no breadcrumb/backlink
  selector is gated on `.has-sidebar`.
- **No README change.** Small interaction fix with no architecture or
  API-surface change.

## Verification

- `yarn workspace @f8/core test`: 49 files, 844 tests, all pass (842
  pre-existing + 2 new).
- `yarn workspace @f8/ui test`: 44 files, 341 tests, all pass (335
  pre-existing + 6 new; 2 renders updated for the prop rename).
- `yarn workspace @f8/core typecheck`, `@f8/ui typecheck`,
  `@f8/web typecheck`: clean (after rebuilding `@f8/core` and
  `@f8/ui` dist, which the web workspace resolves and which are
  gitignored).
- Playwright not run (per brief).
