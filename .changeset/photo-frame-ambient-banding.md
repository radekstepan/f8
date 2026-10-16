---
'@f8/web': patch
---

The editor photo frame shadow is subtler still: the ambient lift that banded on the dark stage (and drew a rounded silhouette in the background) is now a shorter, fainter falloff, so the photo floats without banding or a visible halo.

## Task writeup (docs/tasks/33-photo-frame-banding.md)

## Request

Not sure if it's a bad antialising but I see dark black
semitransparent border around a photo. Including rounded corners. Is
it just a drop shadow gone havoc? Make it beautiful and subtle. This
was supposedly fixed, but it isn't. I see banding and I see rounded
corner in top right background of the photo.

(Follow-up to `23-photo-frame-shadow.md`, which replaced the
edge-hugging `0 9px 35px #0005` blur with a three-layer
keyline/contact/ambient treatment.)

## Diagnosis

Still the drop shadow — but now the ambient layer, not the edge. The
first fix's lift (`0 18px 50px -12px #000a` in `.photo-frame`,
`apps/web/src/index.css`) is a 50px blur at 67% black over the
near-black stage (`#151517`):

- **Banding:** a 50px near-black gradient falls in visible 8-bit
  quantization steps — exactly the banding reported. Long, smooth,
  dark gradients are where banding always shows first.
- **Rounded corner in the background:** the blur reaches ~50px past
  the frame on every side (offset 18px down), so its silhouette —
  with corners rounded by the blur radius — draws a visible shape on
  the stage background, e.g. top-right of the photo.

The keyline (`0 0 0 1px #ffffff14`) is innocent: it is what keeps the
photo edge crisp against the stage. The contact layer (`0 1px 2px
#0006`) contributed a faint asymmetric darkening along the bottom
edge.

## Change

- `apps/web/src/index.css` (`.photo-frame` only, one line): the
  shadow is now `box-shadow: 0 0 0 1px #ffffff14, 0 1px 2px #0005, 0
  10px 24px -8px #0006` — keyline untouched, contact softened a step
  (#0006 → #0005), and the ambient lift halved in every dimension
  (offset 18 → 10, blur 50 → 24, spread −12 → −8, alpha 67% →
  40%). The falloff is now too short to band and too faint to draw a
  rounded silhouette on the stage, while the negative spread still
  holds the denser core off the photo edge.

## Decisions

- **Soften, don't remove, the ambient.** A keyline + contact-only
  frame looks pasted-on at large photo sizes; a whisper of ambient
  lift keeps the photo floating. The fix cuts the gradient length
  (the banding lever) and the alpha (the silhouette lever) instead.
- **No border-radius / overflow on the frame (unchanged).** The
  canvas stays square and the outside-docked Zoom in View lens still
  renders inside the frame element.
- **Left fractional frame sizing alone.** `frameWidth` can land on a
  subpixel, which softens the 1px keyline slightly — but a full-pixel
  rounding would ripple through the lens/minimap math that derives
  from `frameWidth`, for an imperceptible gain at 8% white.
- **CSS-only fix in `@f8/web`, same as the first pass.** No component
  or markup change.

## Tests

- `packages/ui/src/components/photoFrameShadow.test.tsx` (updated, 7
  tests): re-pinned the contact + ambient layers to the new values,
  asserts the heavy `0 18px 50px -12px #000a` ambient is gone, and
  adds a banding guard that parses the `box-shadow` layers and caps
  max blur at 24px and max black alpha at `#0006` — so a future
  "richer shadow" can't silently reintroduce the banding. UI suite:
  71 files / 555 tests pass.
- `typecheck` clean for `@f8/ui` and `@f8/web`. No Playwright, per
  the task rules.
