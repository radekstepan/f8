# 43 — Heal e2e waits survive a transiently missing test hook

Task: fix failing `@f8/web:e2e` — `heal-brush-types.spec.ts:46`
("heal, smooth, and detail each reconstruct differently") failing with
`page.evaluate: TypeError: Cannot read properties of undefined (reading
'pendingRepairIds')` from `waitForHealingDone` via `getPendingIds`.

## Summary

The failure was not a 90s timeout — it was an immediate `TypeError` on a
single poll tick where `window.__f8Test` was undefined. Verified in the
installed Playwright 1.64.0 source (`invokePollMatcher` in
`node_modules/playwright/lib/matchers/expect.js`): only the *matcher*
result is retried; a throw inside the poll *callback* propagates at once.
The app never deletes the hook and never navigates by itself, so any
document replacement (dev-HMR full reload from a concurrent file save,
server restart) leaves ticks where the hook is unreachable, and one such
tick failed the spec.

Fix: every `expect.poll` over `window.__f8Test` now reads null-safely
(`window.__f8Test ? window.__f8Test.<expr> : null`) and treats a missing
hook as "not yet" — keep polling — via two new pure core classifiers.
Four poll sites covered: `waitForHealingStart`, `waitForHealingDone`,
`waitForMlReady` (all in `helpers.ts`), and the call-count poll in
`heal-queue.spec.ts:64`. One-shot assertion reads (`getHealCalls`,
`getPendingIds`, …) stay strict so a missing hook still fails loudly
instead of passing vacuously.

## Files changed

- `packages/core/src/vision/test-hooks.ts` — new `HealWaitSnapshot`
  interface plus pure `healWaitStarted(snapshot, callsBefore)` /
  `healWaitSettled(snapshot)` classifiers. Null fields (hook unreachable
  that tick) read as "not started yet" / "still working". Exported
  through the existing `vision/index.ts` barrel, so `@f8/core` root
  picks them up with no further wiring.
- `packages/core/src/vision/test-hooks.test.ts` — new: 12-case vitest
  truth table pinning both sides of each classifier (quiet/start/settle
  signals plus all-null and partial-null snapshots).
- `apps/web/tests/e2e/helpers.ts` — new private `hookOrNull` reader and
  exported `getHealCallsOrNull`; the three wait helpers poll through
  them and classify with the core helpers. The `callsBefore` snapshot in
  `waitForHealingStart` is null-safe too (a fresh document after reload
  starts with an empty call log, so 0 is exact there).
- `apps/web/tests/e2e/heal-queue.spec.ts` — the group-1 call-count poll
  uses `getHealCallsOrNull`, same hazard, same fix.
- `.changeset/heal-wait-hook-tolerance.md` — patch changeset for
  `@f8/core` + `@f8/web` (written manually in `yarn changeset` format;
  the CLI is interactive).

No `README.md` update: test infrastructure only, no user-facing or
architectural change. No Playwright run per task instructions.

## Decisions

- **Core seam for the decision logic (R8-2 rule).** `apps/web` has no
  unit harness, so the wait predicates live in `@f8/core` as pure
  functions with node tests; `helpers.ts` is thin wiring. Note: e2e
  resolves `@f8/core` from `dist`, so a core `build` (done locally, not
  committed) is required before the next e2e run sees the new exports.
- **Strict assertion reads kept strict.** Only poll callbacks go
  null-safe; point-in-time getters still throw on a missing hook. The
  alternative (null-safe everywhere) would let specs pass vacuously on
  a dead page.
- **`healWaitSettled` ignores the call count.** `waitForHealingDone`
  never observed calls, so it passes `healCallCount: null`; settled =
  pending empty + queue idle, all three observed.
- **Server-API polls left alone.** `serverOverlays`/`serverEdit` polls
  in other specs share the throw-doesn't-retry shape but are a
  different hazard class (API failures, not the test hook) — out of
  scope for this task.

## Test evidence

- `yarn workspace @f8/core test src/vision/test-hooks.test.ts` —
  12/12 pass (new file).
- `yarn workspace @f8/core test` — full suite 1036/1036 pass.
- `yarn workspace @f8/core typecheck` — clean.
- `yarn workspace @f8/web typecheck` — clean (unchanged code paths).
- Ad-hoc `tsc --noEmit` (strict + `noUncheckedIndexedAccess` +
  `noUnusedLocals/Parameters`, mirroring `tsconfig.base.json`) over
  `tests/e2e/helpers.ts`, `heal-queue.spec.ts`,
  `heal-brush-types.spec.ts` — clean. Needed because
  `apps/web/tsconfig.json` does not include `tests/`.
- `node --eval` scratch check of all four constructed evaluate strings
  against present/missing fake `window.__f8Test` — values when present,
  `null` when missing, no throw.
- Not run: Playwright (forbidden by task instructions).
