# Task 1 — Persisted action-stack revert for Auto adjustments

## Problem

Applying an Auto adjustment (Auto Enhance, Scene Enhance, or a per-category
Auto for white balance / lightness / color) and reloading the UI kept the
auto values in the recipe but lost every revert: the pre-apply snapshots
lived in session-only refs, so after a hard reload there was no reset
button next to the Auto anymore — only the blunt Reset-to-original.

## What changed

Auto actions now keep a **persisted stack of actions** per photo. Each stack
entry records the action kind, its highlight state, and the snapshot its
revert restores. The stack saves with the recipe (same debounced PUT) and
seeds with it on load, so every Auto's highlight and revert survive a hard
reload — and a server restart.

- `packages/core/src/actionStack.ts` (new): stack model
  (`ActionStackEntry`, one entry per kind, oldest first), pure transitions
  (`pushAction` keeps the earliest snapshot on re-apply, `revertAction`,
  `clearEnhanceAction`/`clearCategoryActions`, `clearPureOnPatch`),
  UI derivation (`enhanceFromStack`, `mlAppliedFromStack`,
  `mlRevertFromStack`), `snapshotForEnhance`, and `sanitizeActionStack`
  for the persistence boundary (drops unknown kinds/keys, snapshot-less
  entries, and duplicates; never throws).
- Server: schema v5 adds `photo_edits.actions_json`; `store.getEdit` /
  `saveEdit` round-trip it; `PUT /api/photos/:id/edit` accepts
  `{ present, actions }` (an **omitted** stack preserves the stored one so
  legacy recipe-only writers never wipe reverts; `[]` clears); every photo
  response serves `actions` via `toApiPhoto`.
- Client: `LibraryPhoto.actions` + `saveEdit(id, present, actions)`;
  `useLibrary` seeds `{ histories, actions }`; `useEditor` is stack-backed
  — snapshots, highlights, and revert flags all derive from the persisted
  stack instead of session-only refs/state. `App.tsx` needed no changes
  (it passes seed/save through).
- No UI changes: the Inspector already rendered from these flags; the
  highlight/revert/tooltip contracts are unchanged, they just survive now.

## Decisions

- **Separate stack column, not flags inside `EditState`.** The stack is
  provenance, not look: embedding it in the recipe would have leaked into
  `edited` detection, presets, copy/paste, and export. As its own column
  it never marks a photo edited and never travels with presets.
- **Stack entries, not persisted undo history.** Undo/redo stays
  session-only by design; the stack covers exactly the four Adjust-tool
  autos with per-action revert semantics (one entry per kind, earliest
  snapshot wins) rather than a generic history log.
- **Enhance snapshot narrowed to the enhanceable look.** The old session
  snapshot was the full recipe, so reverting Auto Enhance also restored
  stale face/selective/denoise states — wiping Face Enhance work applied
  *after* the Auto. The persisted snapshot excludes geometry, retouches,
  and the ML states enhance never touches; the revert keeps the current
  ones. Strictly a fix, pinned by `snapshotForEnhance` tests.
- **Pre-stack recipes reopen idle, not stranded.** Flags alone (`autoEnhanced`,
  `sceneEnhance`) seed nothing — no highlight without a revert snapshot —
  until a fresh apply pushes an entry. Same honest rule as before, now
  with a path back to revertible.
- **Straighten Auto stays session-only (follow-up).** It lives in the Crop
  tool under a separate hook (`useStraighten`) with a single-number
  snapshot and no enabled-without-reset symptom after reload. The stack
  module is kind-extensible if we want to fold it in later.

## Tests (unit/integration only, no Playwright)

- `packages/core/src/actionStack.test.ts` (new, 10 tests): push/upsert,
  revert, clears, pure-clearing on manual patches, snapshot narrowing,
  UI derivation, sanitizer incl. garbage input.
- `apps/server/src/action-stack.test.ts` (new, 6 tests): stack round-trip
  through PUT → GET library, omit-preserves, `[]`-clears, invalid-entry
  sanitizing, stack-never-edited, fresh imports serve `[]`.
- `packages/ui/.../sceneEnhance.test.tsx`: reload suite rewritten for the
  new contract — seeded stack restores highlight + revert (enhance and
  per-category), touched entries restore revert-without-highlight, legacy
  stack-less recipes stay idle, plus a seeded-editor-drives-Inspector
  probe pinning the full reload wiring.
- Migration tests tracking the latest schema bumped to v5 (downgrade
  fixtures now also drop `actions_json`, since a real old catalog never
  had the column).
- Full gates green: `yarn test` (862 core + 179 server + 367 UI),
  `yarn typecheck`, `yarn build`.
