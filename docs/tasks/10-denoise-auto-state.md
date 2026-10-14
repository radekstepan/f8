# Task 3: Denoise "Auto" turned on for DSC06322.ARW

## Investigation

The report: opening `DSC06322.ARW` shows the Denoise section's
header Auto button lit (`.is-active`, `aria-pressed="true"`) with
no user action. Ground truth from the library database
(`apps/server/data/f8.db`):

- `DSC06322.ARW` is a real imported Sony raw at **ISO 6400**
  (4024x6024 portrait).
- `DenoiseSection` (`packages/ui/src/components/Inspector.tsx`)
  initialized its draft `auto` flag with
  `shouldAutoDenoise(photo.iso)` (true for ISO >= 1600) and passed
  `applied: auto` straight to the shared header button.

So Auto lit up on first open for every high-ISO capture — with
nothing previewed, nothing applied, nothing stored, and no pixels
changed. Ruled out: state leaking between photos (the draft
resets per `photo.id` via effect), ARW-specific handling (there
is none — the trigger is EXIF ISO only), and a wrong ISO (the DB
value 6400 is genuine).

## Root cause

Denoise was the only section whose header action highlighted for
a *draft* instead of a *stored effect*. The shared
`AdjustmentMl.applied` contract reads "True while the recipe holds
exactly the auto values: the button highlights", and every other
section (White Balance, Lightness, Color, Faces, Selective,
Scene, Straighten) honors it. Denoise passed its draft-equals-
suggestion flag, so a lit toggle read as "denoise is on" when the
photo was untouched. The old header tooltip ("Auto suggestion 65
— click to go manual") even confirmed the button did nothing to
the photo. A stored *manual* denoise also wrongly lit Auto after
reload, since the fresh draft re-seeded `auto: true`.

## Change

- `packages/ui/src/components/Inspector.tsx` (`DenoiseSection`):
  the header Auto now highlights only while the stored denoise
  **is** the untouched suggestion
  (`applied: assist.applied?.auto === true`). Idle click fills
  the ISO suggestion into the draft; clicking the highlighted
  button turns the stored auto denoise off (`assist.onClear`,
  same as the section reset). Tooltips:
  no suggestion -> `ISO {n} needs no denoise` (unchanged);
  idle -> `Set strength to the ISO {n} suggestion ({s})`;
  stored auto -> `Auto denoise {s} applied — click to turn off`.
  The helpful defaults are untouched: high-ISO drafts still
  start on the suggestion slider value, and applying untouched
  still stores `auto: true` (which now lights the button).
- `packages/ui/src/components/AdjustmentSection.tsx`: updated the
  stale "applied without a snapshot is a draft state" comment to
  the new stored-effect meaning.
- `packages/core/src/vision/denoise.ts`: comment-only updates
  (`shouldAutoDenoise` "seeds the draft", no longer "engages the
  toggle"); no behavior change.

## Decisions

- Chose stored-state highlight over removing the highlight
  entirely: after a real auto apply (or reload with one stored),
  the lit toggle truthfully reports the photo state, matching
  the sibling sections.
- Chose toggle-off = clear (back to original pixels, one undo
  step, one-click re-apply) over a draft-only untoggle, which
  would leave the button visibly stuck on. This mirrors the
  generic "revert when highlighted" toggle contract; denoise
  just has no pre-apply snapshot, so revert == clear.
- Kept the in-content `Auto {s} — drag the slider to fine-tune`
  hint draft-based: it describes the slider value's provenance,
  not a toggle state.
- No README update: bug fix, no architecture or feature change.
- Doc number `10-` continues the `docs/tasks/NN-` running log.

## Tests

- `packages/ui/src/components/denoise.test.tsx`:
  - Reworked `starts high-ISO captures...` — fresh ISO-3200 idle
    now asserts Auto OFF (`aria-pressed="false"`, idle tooltip)
    while the slider still starts at the suggestion (50).
  - New `lights Auto only while the stored denoise is the
    untouched suggestion` — mirrors the report (`DSC06322.ARW`,
    ISO 6400): stored auto -> lit with the turn-off tooltip;
    same photo fresh -> off.
  - New `leaves Auto off for a stored manual denoise`.
  - Updated the header-button test's idle tooltip expectation.

## Verification

- `packages/ui`: full suite — 62 files, 487 tests, all pass
  (includes the 2 new + 2 reworked denoise tests).
- `packages/core`: full suite — 52 files, 899 tests, all pass
  (no behavior change there).
- `typecheck` clean in `@f8/core` and `@f8/ui`.
- Playwright not run (out of scope per task rules).
