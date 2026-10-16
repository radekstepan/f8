# 44 — Photo canvas gets a plain subtle drop shadow (keyline + halo removed)

Task: have a subtle drop shadow around the photo canvas — it still
looked like a semi-transparent oval with a rigid border.

## Summary

Third report on the same visual (after `23-photo-frame-shadow.md` and
`32-photo-frame-banding.md`), so this pass changes direction instead of
softening again: the frame shadow is now a plain two-layer drop shadow
with no light ring and no spread tricks.

- `apps/web/src/index.css` (`.photo-frame` only, one line):
  `box-shadow: 0 0 0 1px #ffffff14, 0 1px 2px #0005, 0 10px 24px -8px
  #0006` → `box-shadow: 0 1px 2px #0006, 0 6px 18px #0005` — a tight
  contact shadow that grounds the frame plus a short downward falloff.
- `packages/ui/src/components/photoFrameShadow.test.tsx` (updated,
  8 tests): pins the new layers, asserts no `#ffffff` ring and no
  negative spread remain, and tightens the banding guard (max blur
  24 → 18px, max black alpha stays `#0006`).
- `.changeset/canvas-drop-shadow.md` — patch changeset for `@f8/web`
  (written manually in `yarn changeset` format; the CLI is interactive).

No `README.md` update: CSS-only visual fix, no architectural or
user-facing-behavior change beyond the shadow itself. No Playwright,
per the task rules.

## Files changed

- `apps/web/src/index.css` — `.photo-frame` `box-shadow` replaced.
- `packages/ui/src/components/photoFrameShadow.test.tsx` — tests
  re-pinned to the new treatment plus shape guards.
- `docs/tasks/45-canvas-shadow.md` — this writeup.
- `.changeset/canvas-drop-shadow.md` — patch changeset for `@f8/web`.

## Decisions

- **Remove the keyline instead of softening it again.** The "rigid
  border" can only be the `0 0 0 1px` ring: every blurred black layer
  fades, only an unblurred 1px ring draws a hard edge. Both prior
  passes kept the ring and both were followed by the same complaint,
  so keeping any ring (even fainter) risked a fourth round. Dark photo
  edges now melt into the stage slightly instead of popping — the
  accepted trade for killing the outlined look the user kept reporting.
- **Remove the negative spread instead of shrinking it.** Spread −8px
  shrinks the shadow's source rect, so the blur dominates and its
  rounded silhouette detaches into a free-floating oval halo on the
  dark stage. The new falloff keeps the full-size source rect with a
  modest 18px blur biased downward (6px offset), which reads as a
  grounded drop shadow rather than an all-around glow.
- **CSS-only fix in `@f8/web`, same as both prior passes.** No
  component or markup change; `PhotoCanvas` already renders the
  `photo-frame` hook. No `border`/`border-radius` on the frame
  (unchanged): the canvas stays square and the outside-docked Zoom in
  View lens still renders inside the frame element.
- **Guard the shape, not just the values.** Beyond pinning the exact
  layers, the banding-guard test now also rejects any `#ffffff` layer
  and any negative spread, so a future "richer shadow" cannot silently
  reintroduce either the rigid ring or the oval halo.

## Test evidence

- `yarn workspace @f8/ui test src/components/photoFrameShadow.test.tsx` —
  8/8 pass (updated file).
- `yarn workspace @f8/ui test` — full suite 75 files / 580 tests pass.
- `yarn workspace @f8/ui typecheck` — clean.
- `yarn workspace @f8/web typecheck` — clean.
- Not run: Playwright (forbidden by task instructions).
