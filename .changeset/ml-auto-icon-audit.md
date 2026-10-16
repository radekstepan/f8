---
'@f8/ui': patch
'@f8/web': patch
---

Scene Enhance and Dust Spots now carry the Auto label instead of ML: neither runs a trained model (both use hand-tuned classifiers over classical heuristics), so their header buttons, menu entries, shortcut labels, and result copy say Auto. Subject & Background, Enhance Faces, One-Click Removal, super-resolution, and ML Repair keep their ML labels — those run real neural models.

## Task writeup (docs/tasks/30-ml-auto-icon-audit.md)

## Request

"Scene Enhance and Subject & Background. Are they actually ML driven? If
not they should have an "Auto" icon and not "ML" icon. Be consistent
throughout the tools."

## Audit outcome

Rule applied: the **ML** badge/button means a trained neural model
executes on the primary path (ONNX weights with a trained origin); the
**Auto** pill means classical heuristics or hand-tuned math. A
logistic-regression form whose coefficients were typed in by hand after
eyeballing fixtures — never fitted on data — is a heuristic with extra
steps, not ML. This matches the convention already documented in
`docs/features.md` ("ML buttons are reserved for sections where a model
actually runs").

| Tool / surface | Engine that actually runs | Verdict |
|---|---|---|
| Scene Enhance | 4-class logreg, 28 weights "set by inspection … not fitted on labeled photos" (`scene-enhance.ts`); patch values from histogram heuristics (`enhance.ts`) | **Auto** (changed) |
| Subject & Background | Trained U²-Net portrait segmenter ONNX (`u2netp.onnx`), classical fallback labeled as scan | ML (kept) |
| Enhance Faces | Trained YuNet ONNX, classical fallback with honest per-result credit | ML (kept) |
| One-Click Removal | Trained YOLOv8n ONNX, classical fallback | ML (kept) |
| Dust Spots | Classical blob proposer + logreg filter with hand-set v1 weights ("set by inspection", same species as the scene classifier) | **Auto** (changed) |
| Denoise | Header button fills the heuristic ISO suggestion (Auto, already); effect runs trained DnCNN ONNX or classical fallback, credited per result (`(ML)` only when `onnx` served) | already consistent |
| White Balance / Lightness / Hue & Saturation | Gray-world / histogram heuristics | Auto (already) |
| Straighten | Hough on-device + Sobel-gradient server vote; the tilt-regressor ONNX is "not yet published" | Auto (already) |
| Super-resolution 2x | Real-ESRGAN ONNX, ML-only by design | ML (kept) |
| ML Repair | Neural fill (LaMa/Moebius) vs classical Heal, user-chosen | ML (kept) |
| Semantic search / labels | Frozen CLIP vision encoder ONNX | ML (kept) |

Two demotions, both for the same reason: no learned weights ship or run
by default.

## What changed

Scene Enhance (`kind: 'ml'` → `kind: 'auto'` on the section header):

- Inspector header button is the Auto pill now
  (`scene-enhance-auto`, tooltips "Apply scene enhance automatically" /
  "Scene Enhance applied — click to revert"); the idle note reads
  "Classify the scene automatically …".
- Image menu and library right-click menu entries lost their `MlBadge`;
  the shortcuts dialog lists "Scene Enhance (Auto)".
- The stored preset label is now `Auto Enhance (Scene)` instead of
  `Auto Enhance (ML)` (user-visible as the selected preset name).

Dust Spots (same demotion, for consistency):

- Header button is the Auto pill (`dust-spots-auto`, "Find dust spots
  automatically …"); per-spot `· ML` tags removed (neither tier is ML —
  the classical tier was already distinguished by its note);
  classical-fallback note now says "the false-positive filter" instead
  of "the ML filter".

Consistency touch-ups: stale "ML action/button" comments fixed where
the UI already said Auto (denoise control, straighten, app comments);
`docs/features.md` updated ("Auto Scene Enhance", "auto dust-spot
detection"). No estimator, wire format, or behavior changed — labels
only.

## Decisions

- Internal `ml` names kept as known misnomers: `DustSpotsSource`
  `"ml"` (server wire value — renaming would churn the API),
  `MlCategory` / `mlApplied` / `mlRevert` (task 26 already deferred
  these). They land better with the task-11 toggle conversion, which
  rewrites that surface anyway.
- Cull-assist `Blurry · ML` / `Duplicate · ML` library badges flagged
  as a follow-up, not fixed here: that engine is classical too
  (Laplacian blur, pHash duplicates, hand-set ranker), but the flags
  are persisted catalog labels with `source: "ml"` served at import —
  a migration-flavored change outside this task's tool-icon scope.
- No README change: no architecture or behavior changed, labels only.
- Changeset is `patch` and hand-written in the CLI's exact format:
  `yarn changeset` needs an interactive TTY for package selection,
  which this session has not (same as tasks 25–26).

## Verification

- New `packages/ui/src/components/mlAutoAudit.test.tsx`: Image menu
  marks only Enhance Faces with an ML badge; shortcuts list Scene
  Enhance (Auto) and keep Enhance Faces (ML).
- Updated suites: `sceneEnhance`, `mlSections`, `dustSpots`,
  `repairSections`, `adjustmentConsistency` (its "labels heuristic
  header actions Auto and model runs ML" test now pins the audited
  table), `adjustmentNoteAlign`, `photoContextMenu`.
- `yarn test`: core 1001, server 180, UI 545 — all pass. `yarn
  typecheck`, `yarn lint`, `yarn build` green. No Playwright, per the
  task rules.
