# Task 11 — ML subject-aware auto-enhance

## What changed

Classic Auto Enhance is scene-blind: one fixed histogram patch for every
photo. Scene Enhance classifies the existing 160px analysis image
(`decodeDownsampled`, the same buffer classic enhance uses) into
portrait / landscape / night / document with a tiny on-device ML
classifier, then applies per-scene enhance parameters — portraits protect
skin tones, landscapes allow stronger contrast. Every entry point says
it's ML, and the applied result labels the detected scene + confidence.

- `packages/core/src/vision/scene-enhance.ts` (new, re-exported via
  `vision/index.ts`)
  - `sceneFeatures`: six handcrafted 0..1 features in one pixel pass —
    `dark` (night cue), `bright`, `skin` (bounded red-dominance rule via
    `isSkinPixel`), `paper` (bright + low saturation), `vivid` (mean
    saturation), `greenBlue` (landscape cue).
  - `sceneScores` / `classifySceneFeatures` / `classifyScene`: the ML
    stage — multinomial logistic regression (`scene-logreg v1`, softmax
    over four linear heads) with 28 embedded coefficients. Returns the
    argmax scene, its confidence, and all four scores.
  - `sceneEnhancePatch`: scene → params mapping (see below).
  - `computeSceneAwareEnhance`: classify + classic estimators
    (`computeAutoEnhance` for the five tonal fields, `computeLightnessAuto`
    for highlights/shadows) reshaped through the scene mapping. Carries
    only the eight patch fields, never geometry or retouch state.
  - `parseSceneWeights`: validates replacement coefficient sets for
    future fitted weights.
- `packages/core/src/types.ts`
  - `SceneLabel` (`portrait | landscape | night | document`),
    `SceneEnhanceResult` (`{scene, confidence}`), and optional
    `EditState.sceneEnhance` (set on ML application; null/absent for
    classic enhances and legacy server recipes; shown only while
    `autoEnhanced` is true). Persists through the existing recipe
    JSON untouched — the server merges recipes over `DEFAULT_EDIT`.
  - `NumericAdjustment` gains `-?`: adding the first optional field to
    `EditState` leaked `undefined` into the indexed union through the
    homomorphic mapped type's preserved optionality, breaking
    `edit[key]` indexing in the Inspector. One-line fix, identical
    result for all existing keys.
- `packages/ui/src/hooks/useEditor.ts`
  - `autoEnhanceScene(src?)`: classifies the 160px decode and applies the
    per-scene patch as `Auto Enhance (ML)` with `sceneEnhance` set.
    Decode failure falls back to the classic fixed patch and claims no
    scene — a fallback result is never presented as ML.
  - Classic and ML enhance share one toggle: each button activates its
    own mode (switching keeps the pre-enhance snapshot), and clicking the
    active mode's button restores the snapshot. Classic apply, toggle-off,
    and reset all clear `sceneEnhance`.
- `packages/ui/src/components/Inspector.tsx`: the adjust tool gains a
  Scene Enhance row under Auto Enhance (rendered only when `onAutoScene`
  is provided): apply button + `ML` badge, and once applied the detected
  scene (`Portrait · 86% · ML`). Classic Auto Enhance is untouched.
- `packages/ui/src/components/Topbar.tsx`: `enhance-scene` menu action;
  the Image menu gains `Scene Enhance · ML` (shortcut Shift+A).
- `packages/ui/src/components/PhotoStrips.tsx`: photos gain a right-click
  context menu (library grid + filmstrip, shared `PhotoContextMenu`):
  Scene Enhance with ML badge, favorite toggle, and Remove from Library
  (grid only). Opens at the cursor (viewport-clamped), dismisses on
  outside click / Escape like the album menus.
- `packages/ui/src/components/EditorDialogs.tsx`: shortcuts dialog lists
  `Scene Enhance (ML)` / Shift+A.
- `apps/web/src/App.tsx`: `enhance-scene` action, Shift+A shortcut,
  `onAutoScene` / `onSceneEnhance` wiring. Context-menu requests park in
  a ref until the newly selected photo is open and seeded, then run once
  (the editor hook is bound to the selected photo).
- `apps/web/src/index.css`: `.photo-context-menu` (viewport-fixed
  dropdown), `.scene-enhance-scene` label.
- Tests: `scene-enhance.test.ts` (core, 23), `sceneEnhance.test.tsx`
  (UI, 5), `photoContextMenu.test.tsx` (UI, 5).
- Docs: this writeup + `README.md` (feature bullet, demo-boundary note).

## Params per scene

Base = classic estimators; each scene reshapes it:

| Scene | Exposure | Contrast | Saturation / Vibrance | WB | Highlights / Shadows |
| --- | --- | --- | --- | --- | --- |
| portrait | base | halved, ≤ 18 | saturation ≤ 8, vibrance 10 | base | base |
| landscape | base | base + 12 | saturation base + 8, vibrance 8 | base | base |
| night | ≤ 0.8 | ≤ 20 | saturation ≤ 10, vibrance 0 | base | ≤ −10 / ≥ +10 |
| document | ≥ 0 | ≥ 30 | 0 / 0 | neutral 5500K, tint 0 | 0 / ≥ +10 |

Portrait skin-tone protection is structural, not a comment: saturation and
contrast are capped low while vibrance — which by design spares
already-vivid colors (see `adjustments.ts`) — carries the color instead.
Tests pin all four rows against a vivid base patch.

## Model choice

Multinomial logistic regression over six handcrafted features
(`scene-logreg v1`), not an ONNX network: four scenes separate well on
darkness, skin fraction, paper brightness, and colorfulness; 28 floats need
no runtime, no download, and no new dependency. The coefficients are set by
inspection against the synthetic fixtures in `scene-enhance.test.ts` and
ship embedded in `@f8/core` — there is no weight URL and no separate weight
license (they are source, under the repo's own terms). Fitted replacements
validate through `parseSceneWeights`; a proper training pass over labeled
photos is the follow-up.

- Default weights: embedded `SCENE_CLASSIFIER_WEIGHTS` (no download, no
  binaries committed).
- License: none separate — part of the source tree.
- Runtime: none — pure TypeScript on the 160px client-side analysis image,
  so classification works fully offline with no server round-trip.
- Fallback: unreadable/decodable-failed images get the classic fixed patch
  with no scene claim (preset stays `Auto Enhance`, no ML badge).

## Decisions

- **Embedded logreg, honestly labeled.** The "tiny scene classifier" is a
  real softmax classifier with a real contract (tested: feature-level
  classification decoupled from pixels, injected-weights override, argmax
  + confidence properties), but its v1 coefficients are inspected, not
  fitted — this writeup and the code header say so. The UI's ML badge
  means "the scene came from the classifier", and fallback results never
  carry it.
- **Client-side on the 160px image, no server leg.** Unlike removal and
  dust spots (server-side detectors), scene classification needs only
  coarse color statistics the client already decodes for classic enhance.
  No new route, no health endpoint, no env vars, no offline mode beyond
  the honest fixed-patch fallback.
- **One shared enhance toggle, two modes.** Both buttons flip the same
  `autoEnhanced` state instead of stacking: clicking Scene Enhance while
  classic is active switches modes (keeping the pre-enhance snapshot),
  and clicking the active mode's button toggles off. The previous
  behavior — Auto Enhance always toggling off when active — now switches
  to classic when ML is active; the writeup records the change.
- **Scene rides the recipe, not hook state.** `EditState.sceneEnhance`
  persists, undoes, and seeds like any other recipe field, so the badge
  survives reloads and undo/redo with no extra plumbing. Legacy recipes
  simply lack the key and show no badge.
- **Context menu plus existing surfaces.** The task suggested the context
  menu; photos had no right-click menu, so one was added (grid +
  filmstrip) with Scene Enhance as its lead entry — alongside the menubar
  item, the inspector row, and Shift+A. Favorite/remove entries ride along
  so the menu is useful beyond one action.
- **No downsample change.** `decodeDownsampled` keeps `maxDimension = 160`;
  the classifier was designed for coarse statistics and needs nothing
  finer.

## How verified

- Core: 33 files / 585 tests pass (23 new: skin rule, feature extraction
  per prototype, softmax/argmax/confidence contract, feature-level
  classification without pixels, injected-weights override, weights
  validation, all four scene→params rows incl. skin-tone protection,
  neutral-input behavior, patch-key contract, per-prototype end-to-end,
  golden-photo characterization).
- UI: 7 files / 38 tests pass (10 new: scene row absent/present, ML badge,
  scene + confidence label, hidden for classic/toggled-off, classic row
  kept; context menu closed by default, grid entries + aria label,
  favorite/remove variants, unknown target, filmstrip entries).
- Server: 11 files / 104 tests pass (unchanged — no server code touched).
- `yarn typecheck` in `packages/core`, `packages/ui`, `apps/web`,
  `apps/server` — pass (after rebuilding core + UI `dist`, which
  dependents resolve `@f8/*` through; `dist` is git-ignored, not
  committed). This caught and fixed the `NumericAdjustment` undefined leak
  above.
- Playwright was not run (per task instructions).
- Right-click open/dismiss could not be exercised in the SSR-only UI suite
  (no jsdom/click simulation); the open markup is pinned through the
  `initialContextMenu` seam and interaction needs one manual pass.
