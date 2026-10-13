# Task 3: ML Denoise UX — Auto suggests, the slider fine-tunes, the preview says where it is

## What the thing does (the documentation part)

ML Denoise removes sensor noise from high-ISO shots with a small DnCNN
model on the photo server. The flow is three steps, in order:

1. **Pick a strength (0–100).** The slider is a *draft* — moving it changes
   nothing on the photo. `Auto` sets the EXIF-ISO suggestion (50 at
   ISO 3200, up to 65 at ISO 6400+, none below ISO 400); high-ISO photos
   (ISO 1600+) start there, clean ones at manual 45.
2. **Preview** runs the draft on a ≤512px downsample and shows a small
   before/after *below in the same Denoise panel*, plus a 4× closeup
   (click the preview to move it). Noise is unreadable at thumbnail
   scale, so the closeup is the real verdict.
3. **Apply** denoises at up to 2048px and swaps the canvas/export base to
   the clean pixels. The recipe stores only `{strength, auto, source}`;
   the pixels are a session artifact, so a reopened photo offers a
   one-click restore at the stored strength instead of silently showing
   the noisy original. Denoising always runs on the original pixels —
   re-running never denoises twice.

After apply, the canvas Compare button (B in the toolbar) toggles the
noisy original against the clean photo. Every result says whether ML
(`onnx`) or the classical bilateral fallback (`classic`) served.

## What changed

`DenoiseControl` (`packages/ui/src/components/Inspector.tsx`):

- **Auto is a button, not a locking toggle.** The old `Auto` switch
  disabled the Strength slider, so "Auto, then fine-tune" was
  impossible. Auto now sets the slider to the ISO suggestion and the
  slider stays editable; any manual move clears the auto mark (the
  White Balance pattern: manual edits clear the highlight, the value
  stays). The button reuses the shared `auto-small` style from
  straighten, with `aria-pressed` + `is-active` while the draft is
  still the untouched suggestion, and is disabled with an explanatory
  title when the ISO needs no denoise. The recipe `auto` flag now
  means "untouched Auto suggestion" (comments in `types.ts`,
  `denoise.ts`, `useDenoise.ts` updated to match).
- **The slider's job is spelled out.** The hint reads `Draft strength —
  Preview, then Apply, to change the photo` (or `Auto 50 — drag the
  slider to fine-tune`), and the idle panel carries a 3-step "How it
  works" note. Moving the slider alone shows nothing by design; two
  new notes say what moved instead: `Strength is now X — update the
  preview to see it` when the draft drifts past the on-screen preview,
  and `Draft X differs from applied Y — preview it below before
  applying` after apply.
- **The preview says where it is.** The preview block now opens with a
  `Preview — small downsample, shown here` title, the Preview button
  title names the strength and the location (`Show strength 50 as a
  small before/after below, in this panel`), and the summary keeps
  its `Preview 65 · ML` prefix with a `· small downsample` suffix.
  Apply's title names the draft strength it will use, since Apply
  follows the slider, not the previewed value.
- **Clearer applied state.** `Try another strength` (which only ever
  previewed) is now `Preview another strength`; the Compare line is
  now `On the photo, Compare (B in the toolbar) toggles the noisy
  original against this clean photo` with a `denoise-compare-hint`
  testid.
- **De-uglified.** Dropped the 11px toggle bar for a suggestion row
  (`Suggested for ISO 3200: 50` + Auto), gave denoise notes the same
  8px rhythm as the face/subject siblings (it was on the 18px
  default), and styled the preview title like the sibling
  uppercase group labels. All testids kept stable (`denoise-auto-row`
  still names the suggestion row).

Also updated the README denoise bullet (Auto button, draft → preview →
apply, Denoise section location — it still said "ML Enhance section").

## Decisions

- Kept the explicit Preview → Apply two-step instead of live-applying
  the slider: each pass is a seconds-long server round-trip, so
  live-apply would spam the server and swap the canvas base
  mid-drag. The fix is labeling (draft + stale notes), not new
  requests.
- Kept Apply following the draft slider rather than the previewed
  value, and said so in the button title — matching a preview exactly
  would silently discard the user's latest fine-tuning.
- No changes to the server, the vision hooks, or the recipe shape:
  UI + copy + comments only.

## Tests

- Rewrote the two idle-state tests (auto-pressed button + editable
  slider on high ISO, disabled Auto + manual draft on clean ISO) and
  the Compare test for the new copy.
- New tests: idle 3-step explainer, stale-preview note (shown at
  50-vs-65, hidden at 50-vs-50), applied draft-diff note (shown/hidden
  likewise), `Preview another strength` label with no `Try another`
  remnant, and CSS pins (suggest-row flex, preview-title uppercase,
  no `.denoise-auto-row` rule, 8px note rhythm).
- `yarn workspace @f8/ui test`: 210 passed (26 files).
- `yarn workspace @f8/core test`: 808 passed (47 files).
- `yarn typecheck`: all packages pass.
