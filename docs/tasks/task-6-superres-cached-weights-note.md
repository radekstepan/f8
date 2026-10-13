# Task 6 — Super-resolution export no longer blames setup when weights are cached

## Problem

After a successful `yarn setup`, arming Super-resolution 2x in the
export dialog still showed "ML weights are missing — run yarn setup, or
export once to download them (~64MB)."

Investigation ruled out the suspected path/name mismatch: `yarn setup`
(`fetch-models.ts`) and the server health check both go through the
same `ensureSuperresWeights` / `superresDir` + `SUPERRES_FILE`
(`dataDir/models/superres/realesrgan_x2.onnx`), so setup genuinely
satisfies the weights-on-disk check. The real break is one layer up:

- Server health gates `ready`/`serving` on weights **and** a warm ONNX
  session (`ready = weightsReady && sessionsWarm`). `yarn setup`
  downloads weights but warms no session, so a fresh server reports
  `ready: false, downloading: false, error: null` with `weightsReady:
  true`.
- The dialog does a single `health()` read on arming and
  `superresEngineNote` mapped every quiet not-ready snapshot to the
  "missing" note.
- The client `fetchSuperresHealth` dropped the server's `weightsReady`
  field (`SuperresHealthSnapshot` had no such field), so the UI could
  not distinguish "weights absent" from "weights cached, session cold"
  — and always blamed setup.

## What changed

- `packages/core/src/vision/superres.ts`:
  - `SuperresHealthSnapshot` gains required `weightsReady: boolean`.
  - `superresEngineNote` splits quiet not-ready on it: cached weights
    with a cold session now read "Real-ESRGAN weights are cached — the
    first export warms the engine, then upscales." (tone `ready`, no
    action needed — export warms the session itself); only truly
    absent weights keep the "missing / run yarn setup" note.
  - New pure `parseSuperresHealthSnapshot` for the web transport
    (mirrors `validateSuperresBody`'s ok/error shape): passes
    `weightsReady` through, reads `serving` as `ready`, clamps
    `downloadPct`, defaults a missing `weightsReady` to false, and
    rejects server errors / wrong engines / bad payloads with the
    message the dialog shows.
- `apps/web/src/vision/remoteSuperres.ts`: `fetchSuperresHealth` now
  delegates to `parseSuperresHealthSnapshot` (behavior-preserving
  apart from the restored `weightsReady`).
- `packages/ui/src/components/EditorDialogs.tsx`: the rejected-read
  fallback snapshot sets `weightsReady: false` (unreachable server ⇒
  weights unknown ⇒ error tone still wins via `error`).
- Tests: `packages/core/src/vision/superres.test.ts` (existing note
  cases gain `weightsReady`; new cached-but-cold note case; new
  4-case `parseSuperresHealthSnapshot` block),
  `apps/server/src/superres.test.ts` (new post-setup health case:
  sparse 67MB weights, no session ⇒ `weightsReady` true,
  `sessionsWarm`/`ready`/`serving` false, quiet, over direct call and
  HTTP), `superresExport.test.tsx` + `sharedPrimitives.test.tsx`
  bindings gain `weightsReady: true`.
- No `README.md` update: a health/note contract fix, not architecture.

## Decisions

- **Plumb the signal instead of changing `ready`.** Redefining server
  `ready`/`serving` as weights-only would have broken
  `warmupRemoteSuperres`, which polls for `serving === true` to mean
  "session serves". The server already exposed `weightsReady`; the fix
  carries it to the note that needed it.
- **Pure parser in core, not a web test.** `apps/web` has no unit-test
  runner (Playwright only, out of scope), so the payload mapping lives
  in core next to `superresTileProgress`, following that "pure so the
  web transport and its tests share it" precedent — the previously
  untested transport mapping is now covered.
- **Tone `ready` for cached-but-cold.** Nothing is wrong and no user
  action is needed (export warms, then upscales); `missing` is now
  reserved for weights actually absent from disk.
- **No warmup-on-arming.** Kicking session warm when the checkbox is
  ticked would burn server CPU on a speculative tick — a product call
  beyond this bug. The note now sets the right expectation instead.

## Tests (unit/integration only, no Playwright)

- `@f8/core`: 869/869 pass, `typecheck` clean (rebuilt dist first so
  dependents resolve the new field).
- `@f8/server`: 180/180 pass, `typecheck` clean.
- `@f8/ui`: 414/414 pass, `build` + `typecheck` clean (build caught
  one inline snapshot in `sharedPrimitives.test.tsx` that object-shape
  grep had missed; fixed).
- `@f8/web`: `typecheck` clean.
