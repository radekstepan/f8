# Task 9: Topbar menus and buttons

Three complaints about the top menu strip, all in `MenuBar`
(`packages/ui/src/components/Topbar.tsx`) plus its styles in
`apps/web/src/index.css`:

1. Dropdowns floated 5px below the strip (`top: calc(100% + 5px)`),
   detached from their triggers.
2. The `f/8` brand name was itself a dropdown trigger duplicating
   About + Keyboard Shortcuts — content that already lives under Help.
3. The triggers filled the strip's full 31px height, so the hover
   highlight was a tall rounded block touching the strip's top and
   bottom edges.

## What changed

1. **Flush dropdowns** (`apps/web/src/index.css`). `.dropdown-menu`
   goes from `top: calc(100% + 5px)` to `top: 100%`, so each menu
   opens exactly off the menu bar's bottom edge with its left edge
   aligned to the trigger (`left: 0` kept). The small-screen
   right-aligned variant for the last two menus is untouched.
2. **f/8 is no longer a trigger** (`Topbar.tsx`). The `[APP_NAME]`
   entry is deleted from the `menus` record; Help already carried the
   identical About + Keyboard Shortcuts items, so nothing is lost. The
   gradient `BrandMark` svg stays as a static logo leading the bar,
   and the now-unused `brand-name` trigger class is removed from both
   the component and the stylesheet (base + 460px rules).
3. **Slimmer, crisper triggers** (`apps/web/src/index.css`).
   `.menu-trigger` gains `margin: 3px 0` (a 25px pill floating in the
   31px strip instead of a full-height block) and the radius tones
   down from 4px to 3px.
4. **Small-screen renumber** (`apps/web/src/index.css`). The 460px
   media query hid the 6th menu anchor (Window); with the brand menu
   gone Window is 5th, so the rule becomes `:nth-child(5)`.
5. **Tests:** added `topbarMenus.test.tsx` (6 tests: trigger order is
   exactly File–Help with no brand trigger; the logo svg renders
   outside any button; Help keeps About + Shortcuts; dropdown CSS is
   flush top/left with the right-aligned variant intact; trigger CSS
   has the margin + toned-down radius and no `brand-name` remains;
   Window is still the menu hidden on very small screens).

## Decisions

- **"Toolbar buttons" read as the menu triggers.** The complaint says
  the buttons "fill vertical space of the menu toolbar" and "need
  margin at the top and bottom": the menu triggers filled 100% of the
  strip height with zero vertical margin, while the Adjust/Repair/Crop
  tool buttons already sit at 47px in a 65px toolbar with 9px margins
  each side. If the tool buttons were meant instead, they are
  untouched and the complaint still stands for them.
- **Flush with the bar, not the pill.** The dropdown anchors to the
  full-height `.menu-anchor`, so `top: 100%` lands on the bar's bottom
  edge — 3px below the open trigger pill's bottom edge. Hanging the
  menu directly off the pill would overlap the strip; the bar edge is
  the standard, calmer attachment line.
- **Tone down, not square.** Radius 4px → 3px keeps the app's radius
  scale (3–7px elsewhere) while visibly crisping the pill; the margin
  is the bigger visual change.
- **No README change.** Menu-bar styling with no architecture or
  behavior change.

## Verification

- `yarn workspace @f8/ui test`: 42 files, 330 tests, all pass (324
  pre-existing + 6 new).
- `yarn workspace @f8/ui typecheck`: clean.
- `yarn workspace @f8/web typecheck`: clean.
- Playwright not run (per brief).
