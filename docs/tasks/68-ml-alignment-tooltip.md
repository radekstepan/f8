# Task: ML Auto Enhance reports its alignment % in the tooltip

## Request

"As we keep editing photos, we should be able to calculate how much
off 'ML adjustment' is. Show it in the tooltip onhover if that's the
case. Ideally with time the % alignment will get higher."

## What changed

The ML Auto Enhance menu item now carries an alignment score in its
hover tooltip: how closely the suggestion matches the user's own final
edits, as a 0..100 % that climbs as their taste converges.

- `packages/core/src/tasteProfile.ts`: new `tasteAlignment` score plus
  an `alignment` field on `TasteSummary`, computed by `summarizeTaste`
  for whichever scope the summary drew from. Per qualifying key, the
  mean absolute deviation of the touched values from the applied
  (snapped) median, normalized by that slider's range, averaged across
  keys and flipped to a match score. Identical edits score 100;
  scattered edits score lower. Null while the summary holds no
  qualifying key (nothing suggested, nothing to score). Like the
  medians, the score is scope-aware: a subject-scoped summary scores
  only that subject's samples, so one subject's spread never drags
  another's number down.
- `packages/ui/src/components/Inspector.tsx`: new `tasteAlignment`
  prop. A ready enhance now always tooltips when scored — subject
  scope: "Learned from N photos like this (label) — NN% match with
  your edits"; global fallback: "Learned from N photos — NN% match
  with your edits" (the fallback previously stayed silent). Unscored
  stays bare exactly as before.
- `apps/web/src/App.tsx`: passes `tasteSummary.alignment` through.
- Docs: one clause each in `docs/features.md` (Adjust bullet) and
  `docs/architecture.md` (key-files row). No README change — a
  tooltip addition is not architectural. Changeset is `patch` for
  `@f8/core` + `@f8/ui` + `@f8/web`, hand-written in the CLI's exact
  format (`yarn changeset` needs an interactive TTY).

## Decisions

- **Deviation-from-median, not prediction error on held-out photos.**
  The honest alternative — suggest, then measure how the user tweaks
  *after* applying — needs per-apply tracking the stack does not keep
  and only scores photos where the user ran the enhance. Deviation of
  the learned samples from their own median answers the same question
  ("how far off is the suggestion, typically?") from data already in
  the profile, scores every ready state including the seed backfill,
  and provably trends up as edits converge — which is exactly the
  requested behavior.
- **Range-normalized, averaged across keys.** Raw slider units are
  incomparable (exposure spans 6, temperature spans 8000), so each
  key's deviation is divided by its slider range before averaging —
  no single wide-range slider can dominate the score.
- **Scored against the snapped median.** The comparison point is the
  value actually applied (post step-snap/clamp), not the raw median,
  so the number describes the real suggestion.
- **Global fallback gains a tooltip.** Previously only the subject
  scope tooltip'd; withholding the score from the fallback would hide
  the feature from every unlabeled or new-subject photo.

## Verification

- Core `tasteProfile` suite: +7 alignment tests (100 for unanimous
  edits, scatter lowers it, multi-key averaging with hand-computed
  97/94, 93 → 96 convergence trend, subject-vs-global scoping,
  null with no qualifying key, direct empty-set null). Existing
  empty-summary `toEqual` updated for the new field.
- UI `tasteEnhance` suite: ready-tooltip test now pins the alignment
  clause, +1 test for the global-fallback tooltip and the
  unscored-stays-bare rule, App wiring pin extended with
  `tasteAlignment`.
- `yarn workspace @f8/core test`: 1187 pass. `yarn workspace @f8/ui
  test`: 88 files / 705 pass. `yarn typecheck`, `yarn lint` green.
  No Playwright, per the task rules.
- Gotcha re-confirmed: UI tests and the web typecheck resolve
  `@f8/core` / `@f8/ui` from `dist`, not `src` — rebuild the
  dependency first or the new API looks missing.
