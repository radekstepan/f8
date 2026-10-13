# Task 3: Repair warmup runs silent

Switching to the Repair tool no longer flashes a progress bar or a "Cancel
repair" button for the background server check. The "Checking photo server…"
warmup still prefetches the ML tier on entry — it just earns no UI until the
user actually starts a repair.

## What changed

1. **Warmup progress hidden in the Repair panel.** `RepairMethodControl`
   (`packages/ui/src/components/Inspector.tsx`) now renders `MlProgressView`
   only when the progress belongs to a user-started heal (`job !== 'warmup'`)
   or is an error stage (`Model unavailable…`). The in-progress warmup
   stages ("Checking photo server…", "Downloading models…", "Preparing
   models…") and the "Server ready." success note never render, so no
   spinner and no Cancel button appear on tool switch.
2. **Failures still surface.** A dead server still collapses the tier UI to
   the single "Photo server offline." line with Retry (`serverDown` path,
   untouched); a non-fatal warmup error (e.g. models still preparing) still
   renders its persistent `Model unavailable…` alert — without a Cancel
   button, since error stages never had one.
3. **Actual repairs unchanged.** Heal jobs (`job: 'heal'`) keep the progress
   bar, elapsed-time suffix, area note, and Cancel repair exactly as before.
4. **Prefetch kept.** `App.tsx` still fire-and-forget warms the tier when
   Repair opens with ML Heal selected, so the first stroke heals immediately;
   only the display went silent. The `useInpaintRepair` hook is untouched —
   warmup progress is still recorded (drives `mlReady` + e2e observability),
   the Inspector just filters what it shows.

## Decisions

- **Silent background, not deferred warmup.** The brief allowed either;
   keeping the entry prefetch preserves the instant-first-stroke behavior
   and avoids reworking the paint gate + heal path to warm lazily.
- **Warmup errors stay visible, warmup success goes silent.** Hiding "Server
   ready." removes the last distraction; hiding failures would strand users
   behind the paint gate with no explanation.
- **Missing `job` tag stays visible.** The filter hides only an explicit
   `job: 'warmup'`, so any caller that doesn't tag its progress keeps the
   old behavior instead of silently vanishing.
- **Canvas hint kept.** `PhotoCanvas` still shows "Loading the ML engine…
   painting unlocks when ready." while the gate is closed — the brush is
   hidden in that state, so removing its one-line explanation would be
   worse. It names no server check and carries no spinner or button.
- **No README change.** No architecture change, and the README never
   documented the warmup UI.
- **Tests:** added `repairWarmupSilent.test.tsx` (8 tests: each warmup stage
   silent, success silent, heal still shows progress + cancel, warmup error
   shows without cancel, offline line intact, non-ML methods clean);
   rewrote the `ml-heal-tiers` e2e spec's "server-ready note" case as
   "warmup runs silent" (ready tier, no `ml-progress`, no `ml-cancel`).

## Verification

- `yarn workspace @f8/ui test`: 37 files, 300 tests, all pass.
- `yarn workspace @f8/ui typecheck`: clean.
- `yarn workspace @f8/web typecheck`: clean (covers the edited e2e spec).
- Playwright not run (per brief).
