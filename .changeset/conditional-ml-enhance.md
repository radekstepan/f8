---
'@f8/core': minor
'@f8/ui': minor
'@f8/web': minor
---

ML Auto Enhance is now conditional on subject instead of one global style: each learned edit is tagged with the photo's top ML label, so once three same-subject photos show a consistent habit, enhancing a similar photo generalizes their shared style onto it. Subjects with too little evidence fall back to the overall medians, and a ready subject enhance names whose style it applies.

## Task writeup (docs/tasks/66-ml-enhance-conditional.md)

## Request

"ML Enhance needs to be conditional, not global. If a photo is
'similar' (like 3 photos of grapes), it should generalize one style on
others."

## What changed

ML Auto Enhance no longer applies one global style to every photo. Each
learned edit is now tagged with the photo's subject — its top ML
(zero-shot CLIP) label — and enhancing a photo first looks for enough
same-subject evidence: three edited photos sharing the label generalize
their medians onto the photo, while a dissimilar photo gets its own
subject's treatment (or the overall medians when its subject has too
little evidence yet).

- `packages/core/src/tasteProfile.ts`: `TasteSample` gains an optional
  `label`; `topTasteLabel` derives the subject tag (highest-scoring
  `source: "ml"` label — hand-added labels are organizational free text,
  not visual similarity, and their score of 1 would always win);
  `summarizeTaste`/`tasteEnhancePatch` take an optional tag and select
  the subject scope (`scope: "label"`) once three same-subject photos
  exist, else the global fallback (`scope: "global"`). A subject scope
  with no qualifying key stays silent rather than borrowing the global
  style — the evidence says that subject has no habit, and borrowing
  would paint one subject's look onto another. The majority rule runs
  within the scope, so a 2-of-3 subject habit counts even as a global
  minority. `TASTE_PROFILE_VERSION` bumps to 2; version 1 profiles
  migrate in place (untagged samples keep working globally), and the
  seed backfill tags samples from the new `TasteSeed.labels` map.
- `packages/ui/src/hooks/useTasteProfile.ts`: `record` takes the
  subject tag; new `summaryFor`/`patchFor` accessors (the global
  `summary`/`patch`/`ready` stay for the untagged path).
- `packages/ui/src/hooks/useLibrary.ts`: the edits seed now carries
  per-photo labels (`TasteSeed`), so first-run backfill already learns
  conditionally.
- `packages/ui/src/components/Inspector.tsx`: new `tasteScope`/
  `tasteLabel` props. The disabled hint names the subject ("No
  consistent habit across your grapes photos yet"); a ready
  subject-scoped enhance carries a tooltip ("Learned from 3 photos like
  this (grapes)") on a layout-neutral `.menu-tip` wrapper (new CSS
  rule — the disabled wrapper's class name would lie on an enabled
  item). The global fallback keeps today's silent behavior.
- `apps/web/src/App.tsx`: the persist tags each settled recipe via a
  memoized photo-id → subject-tag map; the current photo's tag drives
  `summaryFor`/`patchFor` into the Inspector.
- Docs: `README.md` (one Adjust line), `docs/features.md` (Adjust
  bullet + Boundaries note), `docs/architecture.md` (key-files row +
  browser-local note). Changeset is `minor` for `@f8/core` + `@f8/ui` +
  `@f8/web`, hand-written in the CLI's exact format (`yarn changeset`
  needs an interactive TTY).

## Decisions

- **Subject = top ML label, not scene, pHash, or embeddings.** Four
  candidates were weighed (see Trade-offs). The CLIP zero-shot top tag
  matches the request's example directly (three grape photos share a
  "grapes" tag even across framings), is already computed server-side
  at import and synced to the client (zero new inference, works
  offline), and is user-visible (label chips), so the style group
  matches what the user sees. The 4-scene classifier is too coarse
  (grapes + mountains + beach all read "landscape"); pHash only
  catches near-duplicates, not "similar"; raw 512-d embeddings would
  need client-side clustering for dozens of photos — machinery the
  dataset will never justify.
- **Whole-patch scope selection, not per-key backoff.** Either the
  subject has evidence (3+ photos) and speaks entirely for itself, or
  the global medians serve. Per-key backoff (subject medians where
  present, global fill elsewhere) would mix two styles into one patch
  and be unexplainable in a tooltip.
- **Keyless subject scope stays silent (no global borrow).** Once a
  subject has evidence, borrowing the global style would reintroduce
  the exact global-style leak this task removes. The disabled hint
  says so explicitly.
- **ML labels only; user labels ignored.** Hand-added tags are
  organizational ("wedding", "to print") and score 1, so they would
  dominate the model's visual judgment. A photo with no ML label
  (offline import, demo/legacy record) learns and enhances globally —
  the pre-change behavior, still available.
- **Retags are real changes.** Labels can land after the edit (imports
  embed in the background), so a tag change on re-record moves the
  sample's scope and forces the write-through.
- **In-place v1 migration under the same storage key.** Bumping the
  key would orphan learned taste and churn the backfill; the payload
  version governs, and old readers fail safe (garbage in, empty out).

## Trade-offs

- **Label granularity is the vocabulary's, not ours.** The 50-concept
  vocabulary decides what "similar" means: two grape shots tagged
  "grapes" group together, but a grape close-up the model calls
  "fruit" will not join them. Finer grouping (embedding clustering)
  is the escape hatch if this ever feels wrong in practice.
- **Weak top tags still group.** A photo whose top ML tag sits at
  probability 0.11 groups strictly with confident same-tag photos.
  Trusting stored tags keeps grouping identical to the visible label
  chips; a confidence floor would silently split what the UI shows as
  one subject.
- **First-run libraries start global.** The seed backfill tags from
  stored labels, but photos imported offline (never embedded) stay
  untagged until labels land and the photo is re-edited — the record
  path, not a migration, is what tags them.
- **New subjects wait for three edits.** A brand-new subject falls
  back to the overall style until three same-subject photos are
  edited — the same evidence bar as the original global gate,
  deliberately unchanged.

## Verification

- Core `tasteProfile` suite: 29 → 52 tests (tagging, top-label
  selection incl. user-label ignore, record canonicalization + retag,
  8 scope-selection tests incl. majority-within-subject and no-borrow,
  3 conditional patch tests, tag round-trip, v1 migration, tag
  sanitization, tagged backfill).
- UI `useTasteProfile` suite: 9 → 12 tests (v1 load, record tagging,
  summaryFor/patchFor scope + fallback through static markup).
- UI `tasteEnhance` suite: 7 → 9 tests (subject disabled hint,
  ready tooltip + `.menu-tip` rule, updated App wiring pins).
- `yarn workspace @f8/core test`: 67 files / 1180 tests pass.
  `yarn workspace @f8/ui test`: 88 files / 704 tests pass.
  `typecheck` green for core, ui, and web. No Playwright, per the
  task rules.
- Gotcha worth recording: UI tests and the web typecheck resolve
  `@f8/core` / `@f8/ui` from `dist`, not `src` — rebuild the
  dependency (`yarn workspace @f8/core build`) before running
  downstream tests/typechecks, or failures will look like your new
  API does not exist.
