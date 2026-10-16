# Task: Photo border shadow fix

## Request

Not sure if it's a bad antialising but I see dark black
semitransparent border around a photo. Including rounded corners. Is
it just a drop shadow gone havoc? Make it beautiful and subtle.

## Diagnosis

Yes — drop shadow gone havoc, not antialiasing and not a border
element. The editor frame (`.photo-frame` in
`apps/web/src/index.css`) carried a single-layer `box-shadow: 0 9px
35px #0005`: black at 33% alpha with a 35px blur. A blurred shadow is
always densest right against the box edge, so the photo's (usually
brighter) edge pixels abutted a near-black band hugging all four
sides — reading as a dark semi-transparent outline rather than a
soft lift. The big blur also rounds the band's outer corners, which
is the "including rounded corners" part of the report. The companion
`0 0 0 1px #ffffff05` ring was only ~2% white, far too faint to give
the edge a crisp separation from the dark stage (`#151517`).

## Change

- `apps/web/src/index.css` (`.photo-frame` only, one line): the
  shadow is now a subtle three-layer treatment in the file's existing
  idiom (single-line rule, hex-alpha colors):
  `box-shadow: 0 0 0 1px #ffffff14, 0 1px 2px #0006, 0 18px 50px
  -12px #000a` — a light hairline keyline first (topmost, ~8%
  white, so the photo edge separates cleanly from the stage), a
  tight contact shadow to ground the frame, and a soft ambient lift
  whose negative spread pulls the dense core away from the edge
  instead of hugging it.

## Decisions

- **Keyline, not just a fainter shadow.** On a near-black stage any
  black-only shadow either bands at the edge or disappears; the
  whisper of a light ring (the standard dark-UI photo treatment) is
  what makes the edge read crisp instead of dirty.
- **No border-radius / overflow on the frame.** The "rounded corners"
  were the blur rounding the old shadow band, not geometry to
  preserve — and the canvas must stay square (compare divider and
  crop grid assume square edges). `overflow: hidden` would also clip
  the outside-docked Zoom in View lens, which renders inside the
  frame element at `left: calc(100% + 12px)`.
- **CSS-only fix in `@f8/web`.** No component or markup change was
  needed; PhotoCanvas already renders the `photo-frame` hook.

## Tests

- `packages/ui/src/components/photoFrameShadow.test.tsx` (new, 5
  tests, server-render + `cssRule` pin per repo convention): the
  frame hook renders, the keyline is the topmost shadow layer, the
  contact + negative-spread layers are pinned, the old `0 9px 35px
  #0005` blur and `#ffffff05` ring are gone, and the frame carries
  no `border`/`border-radius` of its own. UI suite: 67 files / 534
  tests pass.
- `typecheck` clean for `@f8/ui` and `@f8/web`. No Playwright, per
  the task rules.
