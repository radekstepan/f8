# Task 6: "No faces found" status text — plain, not gold

## Symptom

After an ML face scan found nothing, the Enhance Faces section showed
`No faces found · ML` in gold text. Gold is reserved for links/actions
only — a status line must not wear it. The Scene Enhance section had the
same problem: its persisted label read `Night · 90% · ML` in gold.

## Root cause

Both status lines share one span style,
`.scene-enhance-scene` in `apps/web/src/index.css`, which set the action
gold (`#f0d397`):

- Scene label: `SceneEnhanceControl` (`Inspector.tsx`) hardcoded the
  `· ML` suffix onto `{Scene} · {confidence}%`.
- Faces outcome: `appliedSummary` (`Inspector.tsx`) appended the `· ML`
  engine tag to the `No faces found` outcome, and `FaceEnhanceControl`
  renders it in the same gold span class.

## Fix

- `packages/ui/src/components/Inspector.tsx`
  - Scene label is now `{Scene} · {confidence}%` — suffix dropped.
  - `appliedSummary` returns plain `No faces found` for a recorded
    empty scan (the `mlTag` now only applies to the hit path).
- `apps/web/src/index.css`
  - `.scene-enhance-scene` color is now `#bdbdc7`, the plain 10px label
    grey shared with `.range-label`, with a comment noting gold is
    reserved for links/actions. One rule covers both spans (the faces
    applied summary reuses the class); the `.is-off` dim rule is
    untouched.

Scope notes (deliberately unchanged):

- A face *hit* keeps its engine tag (`2 faces · lift … · ML`): the task
  names only the no-faces outcome, and the tag there still distinguishes
  onnx from classical provenance. It does inherit the non-gold span
  color — one span cannot be gold-or-not by content, and status text is
  never an action.
- Other `· ML` tags (denoise Preview/Denoised, selective mask, dust
  spots, object removal, cull badges, semantic search) are separate
  controls the task does not name; exhaustive grep confirmed they are
  untouched.
- The `No faces found (ML) — saved.` toast in `apps/web/src/App.tsx` is
  a transient notification, not gold panel text, and names the engine
  that ran (like the `Face enhance (ML): …` toast) — left as is.

## Tests

- `packages/ui/src/components/sceneEnhance.test.tsx`
  - Scene label expectations updated (`>Portrait · 86%<`, `>Night · 90%<`,
    exact span-content matches) plus `not.toContain('· ML')`.
  - New: CSS regression pinning `.scene-enhance-scene` to `#bdbdc7` and
    asserting it never contains `#f0d397` (standard `cssRule` helper).
- `packages/ui/src/components/faceEnhance.test.tsx`
  - Recorded no-face scan now expects `>No faces found<` plus
    `not.toContain('· ML')` (mirrors the classical-scan test).
- `packages/ui/src/components/mlSections.test.tsx`
  - Two `Night · 90% · ML` expectations updated to `Night · 90%`, plus a
    `not.toContain('· ML')` on the applied-scene render.

## Verification

- `yarn workspace @f8/ui test` (full suite) — all pass.
- `yarn workspace @f8/ui typecheck` — clean.
- `yarn workspace @f8/web typecheck` — clean.
- `yarn workspace @f8/ui lint` — no-op (`(no lint configured)`), same as before.
- Playwright not run (per task rules).
