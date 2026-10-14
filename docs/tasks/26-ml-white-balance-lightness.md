# Task: Would White Balance and Lightness benefit from ML?

## Request

"The algo for White balance and Lightness (possibly others), would they
benefit from ML functions? Do a writeup."

## Answer

Short version: White Balance would benefit the most, Lightness less so,
and the biggest near-term win is neither — it is driving the existing
heuristics through the masks the app already computes. No code changed;
this writeup is the deliverable.

## What the algorithms do today

Both autos are classical heuristics in
`packages/core/src/vision/enhance.ts`, pure functions over a downsampled
`PixelImage`. The UI labels them honestly: both sections render
`kind: 'auto'` ("Auto" pill), not "ML"
(`packages/ui/src/components/Inspector.tsx`, `AdjustmentSection.tsx`).

White Balance (`computeWhiteBalanceAuto` → `whiteBalancePatchFromMeans`):

- Gray-world: channel means → a warm cast `(r-b)/gray` maps to
  temperature (5500K neutral, 2000–10000K range, 50K steps) and a green
  cast maps to tint (±100). Casts under 0.03 stay neutral.
- Known failure mode is the classic gray-world one: a legitimately
  dominant color (sunset, forest, ocean, stage lighting) is read as an
  illuminant cast and "corrected" away. Mixed lighting has no answer —
  one global cast fits all.

Lightness (`computeLightnessAuto`):

- Exposure aims mean Rec.709 luminance at mid-gray (128) through the
  pipeline's `2^(EV*0.6)` response model, with a ±1.5 EV cap, a 0.06
  dead zone, and a highlight guard (lift capped at 0.5 when the 99th
  percentile exceeds 240).
- Contrast grows as the robust tonal spread (1st–99th percentile) falls
  short of 190; highlights/shadows fire only when over 2% of pixels
  are clipped at the extremes.
- Known failure mode is the mid-gray pull: night shots, high-key
  portraits, and silhouettes get dragged toward average brightness.
  Everything is global — a backlit subject cannot be lifted without
  lifting the sky too.

Two ML(-adjacent) pieces already soften the worst cases, which matters
for the cost/benefit below:

- Skin-anchored WB (`face-exposure.ts`): YuNet faces locate skin pixels
  and the same temperature/tint mapping runs on skin means instead of
  whole-image means, so a blue-hour backdrop cannot drag faces orange.
- Scene Enhance (`scene-enhance.ts`): a tiny 4-class logistic regression
  (portrait/landscape/night/document, 28 hand-set weights, no download)
  reshapes the enhance patch per scene — notably capping night exposure
  at 0.8 EV, which is exactly the anti-mid-gray guard Lightness lacks.

Sibling autos for context: Hue & Saturation pushes muted colors toward
vivid (`computeColorAuto`, same dominant-color caveat as gray-world);
Enhance Faces / Subject & Background / Denoise / object removal already
run real ONNX models with classical fallbacks.

## Assessment: where ML would help, in order

1. White Balance — yes, most. Learned illuminant estimation (the
   CCC / FC4 family: small CNNs predicting a 2-D illuminant from a
   thumbnail) directly fixes gray-world's dominant-color failure and is
   the textbook case where statistics lose to learning. Cost is real
   but bounded: a thumbnail-sized model, ONNX, same lazy-download +
   classical-fallback pattern the repo already uses for YuNet/U²-Net.
   A cheaper non-ML half-step exists too: Shades-of-Gray or
   gray-edge weighting beats plain gray-world with no model at all.
2. Masked application of the current heuristics — yes, cheapest real
   win. Subject & Background already segments (U²-Net); running the
   existing exposure/WB estimators per mask (subject vs background)
   turns two global autos into local ones with no new model and no new
   estimator math. Backlit portraits are the demo case.
3. Lightness — modest. Exposure targeting is taste, not physics: no
   model discovers the "right" brightness of a night photo. ML's
   realistic contribution is per-scene exposure/contrast targets
   learned from rated pairs — but the scene classifier plus its
   hand-set per-scene caps already covers the failure mode (night
   stays night). Local tone mapping would help more than smarter
   global targets, which points back to (2).
4. Hue & Saturation — barely. The current muted→vivid push is already
   conservative (cap 30, dead zone); a learned "colorfulness target"
   adds taste-modeling risk for little visible gain. Memory-color
   protection (skin/sky) via existing masks would matter more.

Deliberate non-recommendations: running WB/exposure as server-side
neural enhancement (latency + offline story for a slider preset),
and any model that outputs temperature/exposure directly without the
current clamps — the caps and dead zones are load-bearing UX.

## Decisions

- Docs-only: no estimator changed. The analysis concludes the current
  heuristics are correctly scoped for global one-click autos, and the
  two highest-value upgrades (learned illuminant, masked autos) are
  each a standalone project with model-license and offline questions,
  not a drive-by edit.
- No rename of the internal `MlCategory` / `mlApplied` / `mlRevert`
  plumbing, although the name is now a misnomer (those paths compute
  heuristics labeled "Auto" in the UI). Later tasks in this same list
  (Auto-vs-ML icon consistency, toggle conversion) touch exactly that
  surface; renaming lands better with them than ahead of them.
- No README change: no architecture or user-facing behavior changed.
- Changeset is `patch` and hand-written in the CLI's exact format:
  `yarn changeset` needs an interactive TTY for package selection,
  which this session has not (same as task 25).

## Verification

- Docs-only change, so no new tests. Closest existing suite:
  `yarn workspace @f8/core test` — 56 files / 1001 tests pass,
  confirming the analyzed code is untouched and green. No Playwright,
  per the task rules.
