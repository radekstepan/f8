---
'@f8/web': patch
'@f8/ui': patch
---

The Subject & Background tool now shows an avatar icon on the Subject sliders and a picture icon on the Background sliders, so the two subsections are easier to scan.

## Task writeup (docs/tasks/28-subject-background-icons.md)

## Request

For subject and background, find an icon for each subtitle (avatar
plus a picture? up to you to decide), so that each subsection is
easier to see.

## Answer

Done, following the suggested pairing: the Subject slider group now
leads with an avatar glyph and the Background group with a picture
glyph, both from lucide-react — the same icon set as every section
header icon. The labels keep their size, casing, and color; the icon
just anchors the eye at the start of each subsection.

## Change

- `packages/ui/src/components/Inspector.tsx`:
  `SelectiveParamGroup` takes an `icon` node rendered inside the
  subgroup label. Subject passes `<CircleUserRound size={11}>`,
  Background passes `<Image size={11}>`, both `aria-hidden` so screen
  readers still hear just "Subject" / "Background".
- `apps/web/src/index.css`: `.selective-group-label` moves from
  `display: block` to `inline-flex` with `align-items: center` and a
  4px gap, so the 11px glyphs sit centered on the 9.5px caps label.
- `packages/ui/src/components/selectiveMask.test.tsx`: new tests pin
  each group to its glyph (scoped by group testid, so a swap fails)
  and pin the label alignment rule.

## Decisions

- Avatar + picture, as suggested: `CircleUserRound` reads as "the
  thing/person in front" and `Image` as "the rest of the photo". Both
  already ship in the repo's lucide-react version, so no new
  dependency.
- 11px glyphs (vs 14px section-header icons) to match the smaller
  9.5px subgroup caps without overpowering them.
- Decorative (`aria-hidden`): the icons aid scanning but add no
  information beyond the text label.
- No README update: a visual polish with no behavior or architecture
  change.
