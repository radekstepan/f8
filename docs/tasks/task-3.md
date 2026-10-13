# Task 3: Align Adjustments descriptions with the first slider label

Task: In Adjustments the descriptions have too much padding from the
header (Classify the scene, Finds faces) etc. Make it line up with
where Temperature, Exposure starts.

## What changed

- `apps/web/src/index.css`
  - Added one rule zeroing the top margin of a section-leading
    `.inspector-note` (`:first-child` of its wrapper) in the four
    description-led wrappers: `.scene-enhance`, `.face-enhance`,
    `.selective-mask`, and `.object-removal` (shared by the Repair
    tool's One-Click Removal and Dust Spots sections). Leading
    descriptions now start flush with the content top — exactly where
    the first slider label (Temperature, Exposure) starts, since
    `.adjustment-content` has no top padding and `.range-control`
    has no top margin.
  - `.object-removal { margin-top: 4px }` -> `0`: the wrapper itself
    was pushing its note down on top of the note's own 8px, so the
    Repair detection notes sat 12px below the header.
  - `.scene-enhance .scene-enhance-scene { margin-top: 8px }` -> `0`:
    the applied scene label is the same section's leading text once
    enhance runs; leaving it at 8px would shift the row down on
    apply. The generic `.inspector-note` 8px margin is untouched, so
    mid-content notes (draft hints, how-it-works, status lines under
    a slider) keep their separating rhythm.
- `packages/ui/src/components/adjustmentNoteAlign.test.tsx` (new)
  - Pins the alignment target (content top padding 0, no
    `.range-control` margin), the leading-note rule (all four
    selectors + `margin-top: 0`, wrapper and applied-label flush),
    the preserved 8px base rhythm — and, critically, pins each
    description as the literal first child of its wrapper in SSR
    markup, since the CSS keys on `:first-child` and would silently
    stop matching if markup order changed.

No README update: pure spacing fix, no architecture change.

## Decisions

- **`:first-child` override instead of touching the base rule.** The
  base 8px margin is the correct separator between a control and a
  note below it (pinned by `adjustmentConsistency` + `denoise`
  tests); only the leading position was wrong. The new selectors
  (`.x > .inspector-note:first-child`) deliberately differ from the
  retired `.x .inspector-note` overrides those tests assert are
  gone, so the "zero overrides" contract for mid-content notes
  still holds verbatim.
- **Included the two Repair detection sections.** The task names
  Adjustments, but One-Click Removal / Dust Spots share the exact
  pattern (and were the worst case at 12px). Same one-rule fix,
  same test file — leaving them sunken would have kept the bug
  visible one tool over.
- **Flush (0), not a small nudge.** Temperature's label row starts
  at the content edge with no offset; matching that exactly is the
  literal reading of "line up with where Temperature starts" and
  needs no magic number.

## Verification

- `vitest run src/components/adjustmentNoteAlign.test.tsx`: 5/5 pass.
- Full `@f8/ui` suite: 353/353 pass (46 files).
- `tsc --noEmit` in `packages/ui`: clean.

## Learnings

- When a test file pins "zero overrides" for a selector family, a new
  override with a more specific selector shape (`> …:first-child`)
  keeps those assertions green while still changing behavior — read
  the pinned contract and extend it in a new file rather than
  assuming green means unaffected.
- CSS keyed on `:first-child` is markup-order-sensitive: always pin
  the child order in SSR markup alongside the rule, or a future
  reorder silently disables the style with every test still passing.
