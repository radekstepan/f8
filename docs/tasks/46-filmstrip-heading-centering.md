# 46 — Filmstrip heading aligns the album name and photo count on one baseline

Task: in the filmstrip at the bottom, the name of the album and the
count of photos is not horizontally centered — the count shows higher.

## Summary

One-line CSS fix plus a pinned test file:

- `apps/web/src/index.css` (`.filmstrip-heading > div:first-child`
  only): `align-items: center` → `align-items: baseline`. The name
  (9px) and the count (8.5px) run at different sizes, so centering
  their boxes put the smaller count's baseline slightly above the
  name's — the reported "count shows higher". Baseline alignment
  pins both texts to the same line regardless of size.
- `packages/ui/src/components/filmstripHeading.test.tsx` (new,
  4 tests): pins the baseline rule, guards against reintroducing
  box-centering on the title group, pins the heading bar's own
  vertical centering, and asserts the name + count render together
  in the heading.
- `.changeset/filmstrip-heading-baseline.md` — patch changeset for
  `@f8/web` (written manually in `yarn changeset` format; the CLI
  is interactive).

No `README.md` update: CSS-only visual fix, no architectural or
user-facing-behavior change beyond the alignment itself. No
Playwright, per the task rules.

## Files changed

- `apps/web/src/index.css` — title-group `align-items` replaced.
- `packages/ui/src/components/filmstripHeading.test.tsx` — new
  tests pinning the baseline alignment plus markup.
- `docs/tasks/46-filmstrip-heading-centering.md` — this writeup.
- `.changeset/filmstrip-heading-baseline.md` — patch changeset for
  `@f8/web`.

## Decisions

- **Baseline alignment, not equalized sizes or line-heights.**
  Forcing both texts to one size would erase the intended quieter
  count; forcing `line-height: 1` on both would only narrow the
  gap while still centering unequal boxes. `baseline` is the
  correct tool for mixed-size inline text and holds for any
  future size tweak.
- **Title group only; the bar keeps `space-between` + vertical
  centering.** The "not centered" reading as "center the group in
  the bar" was rejected: the right side holds the Presets button
  and sort control, so bar-centering the title would collide with
  the actions. The complaint's own clarification ("count shows
  higher") points at the relative vertical offset, which is what
  this fixes.
- **No markup change.** `Filmstrip` already renders the name and
  count as siblings in one flex container; no new hook was
  needed, so the fix stays in `@f8/web` CSS like the prior
  filmstrip styling passes.

## Test evidence

- `yarn workspace @f8/ui test src/components/filmstripHeading.test.tsx` —
  4/4 pass (new file).
- `yarn workspace @f8/ui test` — full suite 76 files / 584 tests pass.
- `yarn workspace @f8/ui typecheck` — clean.
- `yarn workspace @f8/web typecheck` — clean.
- Not run: Playwright (forbidden by task instructions).
