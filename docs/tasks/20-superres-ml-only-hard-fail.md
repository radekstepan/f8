# Task 20: Super-resolution 2x is ML-only — no fallback, hard fail with the cause

## What changed

The export dialog's "ML weights unavailable — 2x serves the classical
upscale (no ML)" path is gone. Root causes, both fixed:

1. **The server never actually ran ML.** `runSuperres` was purely
   opportunistic (`if (nodeSessions.has(modelPath))`), and health always
   reported `ready/serving: true`, so `warmupRemoteSuperres` resolved
   instantly without waiting for weights or the ONNX session. Even with
   weights cached by `yarn setup`, exports silently served Lanczos.
2. **The fallback hid every failure.** Missing weights, failed downloads,
   and dead sessions all collapsed into the classical path with a shrug.

Now:

- **Server** (`apps/server/src/superres.ts`): `runSuperres` awaits
  `ensureSuperresReady` (downloads once when missing, warms the session)
  and every provisioning/inference failure rejects with the real cause.
  `runOnnxUpscale` throws instead of returning `null`; health
  `ready`/`serving` are true only when weights + session are live;
  `source` is always `"onnx"`.
- **Route** (`apps/server/src/app.ts`): `/api/superres/upscale` answers
  503 with the failure message (sliced to 300 chars) instead of a generic
  "Upscale failed." — the dialog shows it verbatim.
- **Core** (`packages/core/...`): `SuperresSource` narrowed to `'onnx'`
  so a classical result is unrepresentable; `upscaleClassic2x` plus its
  Lanczos helpers and tests removed; `SuperresHealthSnapshot` gains
  `ready`; new pure `superresEngineNote(snapshot)` maps health to the
  dialog note (ready / downloading % / verbatim error / missing-weights
  hint pointing at `yarn setup`).
- **Web transport** (`remoteSuperres.ts`): warmup now genuinely waits for
  ML readiness (previously a no-op); unexpected engine strings throw.
- **Dialog** (`EditorDialogs.tsx`): notes render via `superresEngineNote`;
  errors show as `form-error` alerts, the toast is always the ML one, and
  a rejected health read keeps its message.
- **Install script**: verified, not added — `yarn setup` already
  prefetches the superres pack (`fetch-models.ts`, covered by
  `fetch-models.test.ts`), and the weight URL returns HTTP 200. The
  weights were fetchable all along; the server just never used them.
- **README**: the three passages claiming a classical fallback now say
  2x fails with the reason shown and that `yarn setup` prefetches.

## Decisions

- Scope kept to super-resolution only: denoise, face-detect,
  selective-mask, and object-detect keep their documented classical
  fallbacks (separate tasks own those contracts).
- `F8_SUPERRES_OFFLINE=1` with no cached weights now fails the export
  with "Super-resolution provisioning is disabled…" instead of serving
  Lanczos — the flag still disables downloads, it just no longer
  downgrades silently.
- RangeErrors (tile/stitch shape mismatches) still map to HTTP 400;
  everything else in the upscale path is a 503 with the cause.

## Tests

- `apps/server/.../superres.test.ts` rewritten for the hard fail:
  not-ready health without weights, direct `runSuperres` rejection with
  the cause (offline flag, no network), HTTP 503 carrying the message,
  400s for oversized/malformed bodies preserved. ONNX live-weights test
  untouched (still gated on `F8_TEST_SUPERRES_WEIGHTS`).
- `packages/core/.../superres.test.ts`: classical `upscaleClassic2x`
  suite replaced with 4 `superresEngineNote` tests (ready, downloading
  %, verbatim error, `yarn setup` hint; no fallback wording).
- `packages/ui/.../superresExport.test.tsx`: binding fixture gains
  `ready: true`; markup pins unchanged.
- Full suites: core 758/758, server 172/172, UI 144/144 pass;
  typecheck clean across core, server, ui, web.
