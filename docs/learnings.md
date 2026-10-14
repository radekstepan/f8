# Learnings

Distilled from per-task writeups and subagent learnings across ten
`tasks.md` runs. Read this before touching the inspector, repair,
toolbar, export, menus, zoom, or library UI so we don't repeat the
same mistakes.

- **R1** = first run (16 tasks). Its `docs/tasks/` writeups were removed
  during the task reset; the index below is preserved for archaeology.
- **R2** = second run, 2026-10-13 (12 tasks). Its `docs/tasks/`
  writeups were removed during the task reset; the index below is
  preserved for archaeology.
- **R3** = third run, 2026-10-13 (8 tasks). Its `docs/tasks/`
  writeups were removed during the task reset; the index below is
  preserved for archaeology.
- **R4** = fourth run, 2026-10-13 (8 tasks). Its `docs/tasks/`
  writeups were removed during the task reset; the index below is
  preserved for archaeology.
- **R5** = fifth run, 2026-10-13 (7 tasks). Its `docs/tasks/`
  writeups were removed during the task reset; the index below is
  preserved for archaeology.
- **R6** = sixth run, 2026-10-13 (7 tasks). Writeups live in
  `docs/tasks/<slug>.md`.
- **R7** = seventh run, 2026-10-13 (5 tasks). Writeups continue the
  R6 numbering sequence in `docs/tasks/08-*.md`–`12-*.md` (one
  running log).
- **R8** = eighth run, 2026-10-13 (3 tasks). Writeups continue the
  running log in `docs/tasks/13-*.md`–`15-*.md`.
- **R9** = ninth run, 2026-10-14 (3 tasks). Writeups continue the
  running log in `docs/tasks/16-*.md`–`18-*.md`.
- **R10** = tenth run, 2026-10-14 (3 tasks). Writeups continue the
  running log in `docs/tasks/19-*.md`–`21-*.md`.

## 1. Honest labels and naming

- **Gold is for links/actions ONLY.** Status text, badges, and focus
  indicators must use label grey (`#bdbdc7`), white, or another neutral —
  never action gold. (R1-1, R1-2, R1-6, R1-9, R1-13)
- **Labels must name what actually runs.** Heuristic actions say "Auto",
  model runs say "ML" — White Balance / Lightness / Hue & Saturation /
  Denoise carried "ML" buttons for pure histogram math. Check the engine
  behind the button, not the existing label. (R2-1)
- **Docs can describe warts, not just intent.** The README outright
  documented the dishonest "ML" label; user feedback contradicting a
  documented decision means re-examining the doc, not obeying it. (R2-1)
- **Internal names can stay when rename risk exceeds gain.** The `ml*`
  machinery (`MlCategory`, `mlApplied`, `AdjustmentMl`) still says "ml"
  for Auto sections — renaming through `useEditor`, `App`, core, and a
  dozen test files buys nothing user-visible. (R2-1)
- **Task labels may not exist verbatim in code.** "Color Presets" was the
  `PresetStrip` titled "Presets" showing color thumbnails — matching
  user-facing names to components required reading render output, not
  just grepping the label. (R2-6)
- **Reuse removed copy verbatim as tooltips** when relocating or
  converging controls — preserves honest framing at zero copy cost.
  (R1-14, R2-2)
- **Keep both spellings greppable** when display convention differs from
  plain text: `Before · 16×` captions with ASCII `16x` retained in
  aria-labels. (R1-2)
- **Reserve "missing" for actually absent.** A cached-weights/cold-session
  state is not a setup failure — it reads as ready-with-expectation
  ("first export warms the engine"), and the "run yarn setup" note fires
  only when weights are truly off disk. (R4-6)
- **Every estimate exception needs an honest UI state, not a guess.**
  No accurate pre-export number for 2x upscales → an explicit
  "unavailable" line; a failed run hides the line rather than showing a
  stale number; documented sub-1% caveats (repair blur fallback) go in
  the writeup. (R4-7)
- **Rename tooltip-feeding identifiers for coherence** when migrating
  off native `title` (`SegmentedOption.title` → `hint`) so `title=` in
  the codebase means headings only and the no-native-title sweep stays
  exact. (R4-4)
- **Copy-only changes keep internal identifiers.** The "library server"
  → "application server" reword touched 3 user-facing strings (plus 2
  comments) and left `LibraryError`, `LibraryStatus`,
  `createLibraryClient`, and the `library-gate` CSS class untouched —
  renaming the API for no user-visible benefit is churn, per the R2-1
  rule. Prefer a real term ("application server") over a slash
  ("application/server") in headings. (R7-2)
- **Reshaped features keep module names when only the presentation
  changed.** The 16x cursor loupe became a fixed 8x corner pane, but
  only the factor, shape, and placement changed — renaming
  `zoomLens`/`ZOOM_LENS_*` would churn every call site for no
  behavioral gain. (R8-3)
- **Counts render as repeated text glyphs, not words or emoji.**
  Star smart albums show ★ per rating point (U+2605 BLACK STAR
  renders as plain sidebar text — no emoji presentation, no new
  icon component), and one shared label helper covers the sidebar
  rows and the grid titles, so both surfaces changed together.
  (R10-3)

## 2. Header and component contracts

- **Collapsing hides content, never header controls.** The header row is
  byte-identical open vs collapsed (modulo chevron + aria); pin that.
  (R2-1; supersedes the R1-8 `ml && open` pin, which encoded the old
  hide-when-collapsed behavior.)
- **One header holds at most the reset + the action**, reset left of the
  action, action rightmost — panel headers follow the same contract as
  section headers. (R2-1, R2-2)
- **The reset never hides.** Visibility complaints need a CSS media-query
  grep, not just component logic: one reset vanished only in the
  761–850px band via `display: none`. (R2-1)
- **Retiring a state means deleting both halves.** The 760px re-show rule
  was provably dead once the 850px hide went (flex items blockify);
  likewise a retired CSS state needs both its hidden base and its reveal
  rule deleted, or it invites resurrection. (R1-10, R2-1)
- **`dirty` must mirror exactly the keys its own reset restores**,
  otherwise the reset gets stuck on. Pin this invariant at source
  level since markup can't observe closures. (R1-3, R1-4, R1-12)
- **Gate reset visibility on semantic state, not the handler.**
  `onReset` presence can't mean "show" when reset-to-defaults
  sections (always valid) and snapshot sections (omit-when-clean)
  share one component. (R1-3, R1-10)
- **Revert/reset keys off snapshot presence, not mode presence.**
  Seeding a highlight without its snapshot creates a dishonest
  revert affordance. (R1-7)
- **The header ML control is toggle-shaped** ("revert when
  highlighted, otherwise apply fresh"). Converging a momentary action
  onto it forces a real UX decision: make it a true toggle with an
  honest tooltip, or set `applied: false` so every click is honestly
  a fresh run (the Face Enhance pattern for ephemeral assists).
  (R1-4, R1-14)
- **A toggle that can't un-apply must degrade to re-apply**, never to
  clearing labels while keeping values. (R1-7)
- **Gate visuals on intent, not on value-in-range.** The brush-size tick
  bug came from `defaultValue` meaning "preset" on unsigned sliders but
  "neutral" on bipolar ones; the `signed` flag already partitioned the
  cases, so no new prop was needed. (R2-5)
- **Generic-optional beats section-specific in shared components.**
  Optional `disabled`/`title` fields on `AdjustmentMl` kept every
  existing consumer's markup byte-identical and paid off immediately
  for later convergences. (R1-4, R1-14)
- **Converge to the existing sibling shape exactly** (e.g. Curves/
  Effects `initiallyOpen`) rather than inventing a third variant.
  (R1-11)
- **New toolbar affordances reuse the existing glyph family and dispatch
  path.** The reset button renders the Inspector's reset motif and
  dispatches the shared Edit-menu `reset` action — no parallel logic.
  Its enabled predicate mirrors the action's own (`!isDefaultEdit`) so
  it is enabled exactly when clicking does something, and the optional
  prop defaults to enabled so existing renders keep working. (R3-1)
- **Back-navigation says only where "back" goes.** The count (`N photos`)
  and the circled-chevron badge were noise — the count already lives in
  the grid title and status bar — so the backlink is a single-line ghost
  button whose tooltip advertises the existing G shortcut. Keep the
  editor-only / one-directional `back` navigation semantics when
  rethinking looks. (R3-8)
- **When the reference icon is named, match top to it, not the reverse.**
  The strip's `SwatchBook` is the presets-specific motif while
  `SlidersHorizontal` is generic (and already means "Adjust" in the same
  toolbar) — reusing it made two controls visually ambiguous. (R3-2)
- **Omit photo-only controls in the library, don't disable them.**
  A disabled Adjust button asks "how do I enable it?"; an absent one
  reads as "not applicable here" — same rule as the static grid title.
  R4-5 gated hide-presets, compare, info, Adjust/Repair/Crop and kept
  reset/undo/redo (they "operate on the selection"); R5-2 overturned
  that carve-out — undo/redo/reset are now omitted in the grid too,
  reusing the same `showPhotoTools` gate with no new props; R6-5
  extends the same gate to Export with no `App.tsx` change (it
  already passes the prop). Menus and
  shortcuts stay reachable — the task is about visible buttons, not
  actions. When a task flips a recorded contract, update the rationale
  comment in the pinning test too, not just the assertion. (R4-5,
  R5-2, R6-5)
- **Removing `title` can remove accessible names.** Buttons whose only
  name was the tooltip need explicit `aria-label`s when migrating to
  custom tooltips. (R4-4, R6-3)
- **A quality preview shows the encoded output, not the source.**
  A zoom of uncompressed pixels cannot show the compression artifacts
  under judgment — and it renders `pixelated`, unlike the smooth
  denoise closeup it mirrors, so blocks read as blocks. (R4-8)
- **A highlight must mirror its action's enabled gate exactly.**
  `active={canReset}` on the same predicate as `disabled={!canReset}`
  keeps the Reset button highlighted iff clicking it does something —
  no second derivation to drift. Reuse the shared `is-active` accent
  (compare, presets-toggle) for free visual consistency plus
  `aria-pressed` semantics. (R5-3)
- **Scope a shared-component change with an opt-out prop mirroring
  the existing opt-in pattern.** The export Quality slider's reset
  hint came from the shared `RangeControl`, whose affordance is
  intentional elsewhere — so `disableReset` follows the `valueHint`
  shape and is passed only there. (R5-4)
- **Copy affordances confirm inline and fail silent.** The filename
  button copies via a Clipboard-API → `execCommand` helper that
  resolves `boolean` and never throws; the "Copied!" tooltip flip +
  same-size Copy→Check icon swap show only on success, so failure
  is a silent no-op with no error UI. No toast system was built for
  a one-word action — the `data-tooltip` host plus an inline glyph
  is enough confirmation. (R6-3)
- **A lit toggle reports stored state, never draft provenance.**
  Denoise was the only section whose header Auto highlighted for a
  *draft* (the ISO≥1600 seed) instead of a stored effect — every
  high-ISO photo opened with Auto lit while nothing was previewed,
  applied, or stored, violating the shared `AdjustmentMl.applied`
  "recipe holds exactly the auto values" contract. The highlight now
  keys off the stored denoise being the untouched suggestion; an
  idle click fills the suggestion into the draft, and clicking the
  highlighted button clears (revert == clear when there is no
  pre-apply snapshot), mirroring the generic revert-when-highlighted
  toggle contract. Draft-provenance hints (slider origin) stay
  draft-based — they describe the value, not a toggle state.
  (R7-3; cf. R1-7 snapshot-keying, R4-1 no-snapshot-no-highlight.)
- **New menu items ride optional props.** The View-menu zoom-lens
  item added `'zoom-lens'` to `MenuAction` plus an optional `MenuBar`
  prop (optional like the other later-added props), so every
  existing render keeps working with no call-site churn. (R7-4)
- **Persistent view modes gate on the view instead of resetting.**
  Like Compare, the zoom lens survives photo switches;
  `selectPhoto` does not reset it, and the editor-view gate means it
  simply has no effect in the grid. (R7-4)
- **Every in-content tool action is a golden `.text-button` inside a
  shared `.suggestion-actions` row.** Block rows stretch full-width
  with centered labels; compact inline rows (actions sharing a status
  line) stay right-pushed with `flex: none` buttons, mirroring the
  face/subject applied rows. The row was already the near-universal
  pattern with pinned spacing/weight semantics, so converging the two
  bare-button outliers (idle "Preview denoise", offline "Retry")
  deleted one-off rules instead of inventing a third style. Header
  `.section-actions` chrome, the straighten status row, the B&W grey
  toggle, and modal footers are deliberate boundaries, not
  inconsistencies. (R8-2)
- **Dismiss returns transient phases to the state the pixels are
  in.** Denoise's applied base drives the canvas/export, so dismiss
  keeps applied pixels and returns to `applied` (not a full reset
  like the other vision hooks) — resetting the base while the recipe
  stays stored would show the noisy original as if denoised. The
  pure `dismissDenoiseStatus(state, hasBase)` helper encodes
  "transient → surrounding state" for every phase. (R8-2)
- **A fixed magnifier pane tracks content, not position.** The 8x
  square never moves (bottom-right corner, Photoshop-style), but its
  content follows the cursor — frame center before first entry —
  reusing the existing cursor tracking and edited-canvas mirror with
  no new plumbing. The markup gate drops the cursor-center
  requirement so the pane shows immediately on toggle, and the pane
  carries `role="img"` with an "8x magnification" label: it is a
  stable panel now, not cursor-following decoration. (R8-3)
- **A submenu parent is a checked toggle with keyboard in/out.**
  The Zoom-in-View parent carries the check, hover opens, click
  toggles for touch, and ArrowRight/ArrowLeft move in and out; only
  the default (8x) option carries the shortcut. (R9-1)
- **Derived views mirror their source's visibility conditions.**
  The zoom pane's repair circle uses the same gates as the frame
  cursor (hidden under Compare / Show Original, unwarmed tier) plus
  its own fit rule — a magnified view never shows what the frame
  hides. (R9-1)
- **Computed collections live in Library, user collections in
  Albums.** Star-rating smart albums are computed rows (no
  create/delete menu, cover, drops, or server storage) like
  Favorites and Recently Edited — group membership follows
  mutability, not content. (R9-2)
- **Smart-album matching is exact, not "at least".** `rating-3`
  lists 3-star photos only — one photo, one smart album — so the
  sidebar counts add up. (R9-2)
- **Menu-bar identity labels render the app version, not an edition
  name.** Both render sites (menu-bar indicator, About brand line)
  show `v<APP_VERSION>`; descriptive "local-first" wording elsewhere
  stays — it describes the architecture, not the label. (R9-3)
- **A submenu parent with its own concern gets its own menu
  section.** Zoom in View sits between separators (Show toggles /
  Zoom in View / Photo Browser + Zoom to Fit) — but the flyout
  holding only 4x/8x/16x takes no inner separators: separators
  divide groups, they never frame a container's edges. (R10-1)
- **Row icons mark the type; labels carry the count.** Star-album
  rows keep the single Lucide `Star` while the label shows ★×N —
  the icon says what the row is, the text says how many. (R10-3)

## 3. Spacing, layout, and motion

- **Check token reuse before deleting a style.** Confirm the old tokens
  have zero other consumers and that the replacement palette is already
  shared (e.g. `.slim-button.is-active`, `.ml-badge`) — that confirms
  the unification direction. (R1-1, R1-5, R1-13)
- **Equal-specificity source order matters.** A later `.is-active` rule
  already beats `:hover`; deleting an active-hover override can be a
  no-op rather than a regression — but verify, don't assume. (R1-1)
- **A `flex: none` / override guard is useless if a broader selector
  beats it on specificity.** Verify overrides win instead of just
  adding them. (R1-5)
- **First-child/nth-child CSS selectors are markup-order landmines.**
  Adding or removing a sibling silently changes which element matches.
  Avoid them for styling; prefer explicit classes. The `nth-child`
  responsive rule silently encodes menu order — any menu add/remove
  must re-check it, and a test should pin the index + selector
  together so reorders fail loudly. (R1-5, R2-9)
- **When every instance shares one component, the anomaly is in the
  cascade around it, not the component** — diff the ancestors, not the
  control. (R1-5)
- **Audit shared renderers, not just call sites.** Bare controls hiding
  inside shared components (e.g. `MlProgressView`) are the classic
  alignment-breaker. (R1-15)
- **Check both sides of any rule element.** A "bar with no whitespace"
  was `border-top` with `padding-top` but zero `margin-top` — padding
  only spaces one side. (R2-7)
- **Mirror existing spacing values instead of inventing new ones.**
  The modal's 17px padding below the rule became 17px margin above it.
  (R2-7)
- **Scoped override beats a new variant** when the complaint is a pairing
  (28px input vs 33px button), not the look itself — no `.small` button
  API that no other surface uses. (R2-7)
- **Two `margin-left: auto` items in one flex row split free space.**
  When inserting a right-aligned group before an already-right-aligned
  item, zero the old one via a sibling selector, not DOM restructuring.
  (R2-2)
- **Dropdowns anchor to the bar edge, not the pill.** The menu hangs off
  the full-height anchor; hanging it off the trigger pill would overlap
  the strip. (R2-9)
- **Tone down within the existing scale.** Radius 4px → 3px kept the
  app's 3–7px radius scale while visibly crisping the pill. (R2-9)
- **Mirror direction in state mapping, never CSS.** A `direction: rtl` /
  `scaleX(-1)` flip would reverse keyboard arrows and focus motion;
  an explicit value→columns function keeps arrows, screen readers, and
  the thumb agreeing that right means bigger. (R2-10)
- **Recheck initial state when inverting a mapping.** The `useState(3)`
  default silently changed meaning from "3 columns" to "preview size 3",
  so the default had to be re-derived (4) to preserve first paint.
  (R2-10)
- **Every transition needs a `prefers-reduced-motion` off-ramp.**
  (R2-8)
- **Check what sizes the container before touching the thing inside
  it.** The album-preview resize lived in the frame's aspect-state
  lifecycle (stale `useState` never reset on photo change), not the
  fill CSS (`cover` + 100% was already right). (R3-6)
- **Absolute `%` offsets resolve against the positioned ancestor, not
  the visual trigger.** A trigger pill with vertical margin inside a
  full-height anchor sits 3px above `top: 100%` — compare the menu edge
  against the trigger's border box and subtract the margin in a scoped
  override (`.menu-bar .dropdown-menu`), never by changing the shared
  base rule or removing the trigger's margin. (R3-7)
- **Prefer `min-width: 0` + ellipsis over fixed slots in flex
  toolbars.** Fixed slots are fragile across panel toggles (sidebar
  open/closed, overlay mode); a flexing block with
  `text-overflow: ellipsis` degrades gracefully by construction.
  (R3-8)
- **Magic alignment padding is a smell of diverged variants.**
  Unifying both variants onto one single-line shape deletes the
  constant instead of re-tuning it. (R3-8)
- **Leading-vs-mid-content spacing needs a positional selector.**
  Keep the base margin as the correct mid-content separator and
  override only the leading position (`> …:first-child`, flush 0 to
  match the content edge) — including sibling sections that share the
  pattern even when the task names only one area. (R3-3)
- **"Flush" means zero gap between the boxes.** The dropdown/trigger
  seam precedent (R3-7) extends to the collapsed backlink/toggle seam:
  internal padding provides glyph clearance, so no extra gutter rule
  is needed. Keep the term meaning the same thing everywhere. (R4-3)
- **Square joined edges on open, not on hover.** Task text said "on
  hover", but squaring a closed trigger leaves square corners with no
  panel to join — visibly broken. `.is-open` is the hook (it also
  covers hover-switching between open menus). Record the correction in
  the writeup. (R4-2)
- **Scope meeting-edge overrides like the existing flush override.**
  `.menu-bar .dropdown-menu` carries the radius change so shared
  inspector/sidebar/browser menus keep their rounding — and change
  radii only, no border surgery. (R4-2)
- **Fix alignment in the parent columns, not the constrained
  component.** The collapsed-toolbar gap was fixed via
  `.window-toolbar`/`.main-toolbar` widths because the backlink
  independence contract forbids sidebar-gated backlink selectors —
  read neighboring test contracts before choosing where to fix.
  (R4-3)
- **Split combined responsive selectors per state.** The 1020px rule
  covered open + collapsed toolbars in one selector; the collapsed
  fix needed its own branch or the gap survived at that breakpoint.
  (R4-3)
- **One delegated tooltip host beats per-trigger components.** A
  `data-tooltip` attribute + single portal bubble is a one-word
  migration per site, one positioning implementation to verify, zero
  new dependencies — and future tooltips work by adding an
  attribute. (R4-4)
- **"Show nothing" is a sized placeholder — until the placeholder
  itself reads as the bug.** R5-1's shimmer backlink pill and 68px
  histogram skeleton both read as weird artifacts, so R6 overturned
  both: the pending backlink renders literal `null` and fades in on
  arrival (R6-7), and the histogram starts flat (shell only, no
  curve paths) with the curves rising from zero (R6-2). The same
  shell in both states means no swap and no layout jump — strictly
  better than a matched-size skeleton. When a task flips a recorded
  contract, update the rationale here too. (R5-1, R6-2, R6-7)
- **Mirror the existing transition convention for state swaps.**
  The export preview's old→new pixel fade reuses the filmstrip
  `opacity 160ms ease` treatment, dimming to 0.45 while updating.
  (R5-6)
- **Pending feedback inside a fixed-size surface must be purely
  visual, never structural.** R5-6's "Updating preview…" status line
  mounted/unmounted on every settings change, resizing the Export
  modal — R6-1 deleted the line, leaving the 0.45 dim alone (opacity
  transition only, no layout impact). Any added/removed element
  reintroduces the resize. (R6-1)
- **Every new animation extends the `prefers-reduced-motion`
  block.** Shimmer, skeleton wave, bloom entrance, preview fade,
  backlink fade — no motion ships without its off-ramp. (R5-1,
  R5-6, R6-2, R6-7)
- **Animate the entering layer, not its static shell — and keep
  entrances opacity-only when motion would read as settling.** The
  histogram bloom moved from the whole svg onto the curve group
  starting at `scaleY(0)` (scaling the svg would launch the grid
  too), while the backlink fade pins "no transform" because a
  drifting link next to the sidebar toggle looks like layout
  settling. Mount-on-arrival entrances play exactly once; later
  updates mutate attributes (`d`), never re-mount. (R6-2, R6-7)
- **"No lines" means no paths, not zero-area paths.** A zero-height
  curve path still strokes a colored hairline over the baseline —
  the flat histogram mounts no curve paths at all until the data
  lands. (R6-2)
- **Orientation fixes mirror the sibling that already solved it.**
  The portrait preset box (3x too wide: landscape `flex: 1 0 66px`
  sizing with only an `object-fit: contain` portrait rule) took its
  43px width from the filmstrip's `.is-portrait` item directly below
  it — same photo, same constraint, consistent behavior. R8-1
  refined the truncation half of this rule (see next): the 43px box
  is now the thumbnail only. (R7-1)
- **Size each child of a compound component independently.** The
  43px portrait item held ~7 characters at the 9px label size, so
  "Golden Hour" / "Soft Light" clipped — a fix optimizing thumbnail
  compactness silently broke label legibility. The split keeps the
  72px name width on the item (fits the longest built-in, "Teal &
  Orange", with margin; the 8-preset strip still fits typical
  editor widths) while only the thumbnail stays 43px and centered,
  preserving the R7-1 no-letterbox intent with no markup change.
  Built-in names now show in full; ellipsis survives only as the
  graceful fallback for unbounded user-saved names, with the full
  text in the `Apply <name>` tooltip. When sizing a compound
  component, check every child element, not just the one in the
  report. (R8-1)
- **A narrower state must outrank every responsive override.**
  The 3-class portrait selector (`.presets-list.is-portrait
  .preset-item`) deliberately beats the single-class responsive
  `.preset-item` flex rules, so the narrow box holds at every
  breakpoint — verify the override wins, per the R1-5 rule. (R7-1,
  R8-1)
- **Leading content aligns with `flex-start` + trailing
  `margin-left: auto`, never `space-between`.** With space-between,
  two-child `[check, label]` items pushed the label flush right
  while three-child `[check, label, kbd/chevron]` items centered
  it — one rule misaligning the Zoom parent, the 4x/8x/16x flyout,
  and the sort menu at once. Fixing the shared rule covered all
  three; shortcuts stay right via their existing auto margin.
  (R10-1)
- **Dock beside content by offsetting inside the existing
  positioned ancestor.** The zoom pane reaches past the frame's
  right edge as an absolutely positioned child (`left: calc(100% +
  12px)`, flush `bottom: 0`), so it scrolls with the photo and
  needs no layout changes — moving it to the stage wrap would
  have bought nothing. (R10-2)

## 4. Navigation and state

- **Sidebar/backlink behavior depends on the view — gate on it.**
  Inside a photo, the highlighted collection is inferred, never picked,
  so clicking it must navigate, not toggle; in the grid the same click
  toggles. Ship it as a tested pure `@f8/core` predicate consumed by
  App — the same seam as `shouldEscapeToLibrary`,
  `resolveCollectionClick`, and `shouldShowPhotoBacklink`.
  (R2-11, R2-12)
- **A toggle reused as a backlink is a misnavigation bug.** The grid
  toggle fired in both views, carrying grid clicks into a single
  photo; the fix was a one-directional `back` action, with the toggle
  itself untouched. (R2-12)
- **Remove wrong affordances instead of disabling them.** A disabled
  backlink in the grid still asks "back to what?"; static text makes
  the misnavigation impossible by construction. (R2-12)
- **Keep follow-on state keyed off the resolved value, not the clicked
  id** — a toggle to All must inherit All's entry filters, not the
  clicked album's. Any future resolver on that path needs the same
  treatment. (R2-11)
- **Check for an existing discriminator before restructuring state.**
  The `job: 'heal' | 'warmup'` tag already distinguished user work from
  background checks, so the silent-warmup fix was a display filter with
  no hook or transport change. (R2-3)
- **Background success goes silent, background failure stays visible.**
  Hiding "Server ready." removes distraction; hiding failures strands
  users behind the paint gate with no explanation. And a missing `job`
  tag must stay visible — fail open, not silent. (R2-3)
- **Finished repair work is immutable; newest patch wins on top.**
  A touch-up never re-heals the stroke underneath, and deleting the
  underlying stroke later leaves the touch-up's blended pixels as-is.
  (R2-4)
- **Paste into the working image before `onGroupDone`, not after** —
  later groups in the job must see the patch even if the cache hook
  fails. (R2-4)
- **Don't split shared paths per method.** Classic `heal` and `ml-heal`
  share the queue/export path; splitting stacked-sourcing behavior per
  method would double call-site logic for no user benefit. (R2-4)
- **Verify reachability before "fixing" a suspect gate.** The `App.tsx`
  `!editor.ready` gate looked guilty for the loading flash but is
  effectively unreachable after the library gate — checking saved a
  pointless change. (R2-8)
- **A flash can have stacked causes.** The solid loading overlay *and*
  the mount-time empty canvas both flashed; fixing only one would still
  flash. Always check what paints beneath an overlay. (R2-8)
- **Session-only UI state vs persisted recipe flags is the recurring
  reload-bug shape.** Derive applied-state from the recipe (face/
  selective/denoise do); anything initialized empty and never seeded
  will look idle after reload. (R1-7)
- **When UI feedback is gated on a server round-trip, any server
  saturation reads as "click does nothing."** Verify the button
  fires first, then trace where state actually updates. (R1-16)
- **Optimistic updates need a consistency story for concurrent
  full-record upserts, not just rollback** — a repair saveEdit PUT
  would have wiped a naive optimistic star. (R1-16)
- **Out-of-order async settles need sequence numbers** once users can
  act faster than the server responds (rapid toggles during a slow
  PATCH). Settle only the latest PATCH authoritatively; drop stale
  responses. (R1-16)
- **Legacy-disabled recipes are the perennial edge case for Details
  changes.** Values-alone dirtiness (flag flips back on first drag)
  is the settled convention — pin it explicitly in each new test
  file rather than assuming it. (R1-12)
- **A highlight implying an action must share that action's
  lifetime.** Persisting the enhance "applied" flag while the revert
  snapshot stayed session-only stranded the button
  enabled-without-a-reset — the persisted half must reopen idle, and
  the seed-only helper (`enhanceModeForRecipe`) goes with its tests
  instead of staying exported to invite reintroduction. (R3-4)
- **When a drag feels laggy, check what the state update re-triggers,
  not the handler.** The paint and overlay render were cheap; the cost
  was a full-res canvas repaint subscribed to the same state on every
  pointermove. Bail out early for gestures whose pixels the pipeline
  provably cannot change (base canvas excludes repair stamps) — a
  proven invariant, not a gamble — after the generation bump so
  in-flight runs still cancel. (R3-5)
- **Predict frame size from metadata; keep measured pixels as
  post-paint truth.** Stored dims plus live rotation/crop fully
  determine the pipeline's output size, so the loading frame can be
  right on first paint (`loading ? predicted : measured` tracks edits
  streaming in after open); fall back to the last measured aspect, not
  a constant, for corrupt metadata. (R3-6)
- **Provenance is not look — persist it in its own column.** The Auto
  action stack lives beside the recipe, never inside `EditState`, so
  it can't leak into `edited` detection, presets, copy/paste, or
  export. (R4-1)
- **Revert snapshots cover only what the action changed.** A
  full-recipe snapshot made Auto Enhance's revert restore stale
  face/selective/denoise states, wiping work done after the Auto —
  narrow the snapshot to the enhanceable look and keep current values
  for the rest. (R4-1)
- **No snapshot, no highlight.** Flags alone never seed a revert
  entry: pre-stack recipes reopen idle rather than stranded, the same
  honest rule as R3-4, now with a path back to revertible on fresh
  apply. (R4-1)
- **Omitted preserves, empty clears.** In partial-update APIs an
  omitted stack must not wipe the stored one (legacy recipe-only
  writers), while explicit `[]` clears — pin both directions. (R4-1)
- **Trace dropped fields end to end before blaming the disk.**
  The "missing weights" bug was no path mismatch: setup and server
  shared one resolver, but the client transport dropped the server's
  `weightsReady` and the note mapped every quiet not-ready to
  "missing". Verify the suspected cause first; the break was one
  layer up. (R4-6)
- **Plumb the finer signal instead of redefining the shared one.**
  `ready`/`serving` also mean "session serves" to the warmup poller,
  so the fix carries `weightsReady` alongside rather than narrowing
  `ready` to weights-only. (R4-6)
- **Choose coordinates invariant to the changes they must survive.**
  Dialog-owned `%` focus stays valid across export size presets, so
  preset switches re-render with the same focus and only a photo
  change resets to center. (R4-8)
- **One pipeline run feeding two consumers keeps them consistent by
  construction.** The size estimate and the quality preview share a
  single `renderExportPreview` run — the number and the pixels can
  never disagree, at no extra render cost. (R4-7, R4-8)
- **While a new run is pending, hide — never show stale pixels under
  a new label.** The preview shows a loading note (like the size
  line), which would otherwise mislead under a changed quality.
  (R4-8; transition behavior refined by R5-6 below.)
- **Keep-stale-during-transition is the refined rule.** R5-6 keeps
  the previous preview mounted while the next render runs (dimmed
  with an "Updating preview…" status + fade swap) instead of
  collapsing to the placeholder on every preset change — but ONLY
  while pending: a failed re-render still clears, so stale pixels
  never pose as new output; 2x arming still hides immediately (its
  pixels can't exist yet) and PNG still renders nothing. The target
  note keeps naming the new settings; R6-1 removed the separate
  status line (it resized the modal), so the dim alone says the
  pixels are mid-transition. (R5-6, R6-1)
- **Unknown-until-inferred state resolves to null, never to a
  placeholder value.** `resolveBacklinkCollection` returns null
  before the photo-driven inference settles (grid loads start
  settled since the URL names the collection) — and names the
  photo's album at render time while a cross-album switch is in
  flight, matching the inference effect's outcome a frame early so
  no stale name flashes. Ship it as a tested pure `@f8/core`
  predicate, per the R2-11 seam. (R5-1)
- **Don't reset derived state on every navigation when effects
  ordering can strand it.** Resetting histogram state on each
  photo switch risked a null stuck between PhotoCanvas and App
  effects plus flicker on every filmstrip click — stale-then-update
  on switches stays, and the loading animation covers only the
  null→data transition. (R5-1)
- **Measure pointer input against the element the indicator is
  positioned against.** The focus square drifted because clicks
  were measured on the `<figure>` (rect folded in the caption
  height: bottom-edge clicks read 91%) while the square was
  positioned in the image box. Moving handlers to the positioning
  context removes the mismatch by construction — no caption-height
  offset hack to rot. Caption clicks then correctly do nothing.
  (R5-5)
- **Drags use pointer capture + a pure mapping helper.** Capture
  keeps the drag alive outside the box (the tone-curve precedent);
  press moves so click needs no separate handler;
  `draggable={false}` + `touch-action: none` keep native
  image-drag and scroll from hijacking the gesture; the
  client-point→% math lives in an exported pure helper so the
  node-only test env can cover it. (R5-5)
- **Every minted object URL goes through a revoking setter** (+
  unmount cleanup) so superseded previews never leak. (R4-8)
- **Recipe equality is per-key over canonical keys, never
  `JSON.stringify`.** Reset nulls optional ML fields that are absent
  from `DEFAULT_EDIT`, so the reset-produced recipe always carried
  extra `null` keys and stringify never matched — the Reset button
  stayed highlighted after every reset. The per-key check
  (order-independent, nullish-tolerant for optional fields,
  mirroring the `isOriginalLook` convention) fixes the predicate,
  not just the patch. A shared `RESET_PATCH` is the single source
  of truth for the reset shape, with a test pinning the
  patch→predicate loop (merge over a fully dirty edit ⇒ default).
  And a reset must clear every field the predicate checks —
  `denoise` strength survived `reset()` and re-ran on reopen.
  (R6-4; cf. the R1-3 "dirty mirrors reset keys" invariant.)
- **Emit one canonical URL form; parse leniently.** The app always
  writes `/photo/<id>/<tool>` (tool segment never omitted, so every
  editor URL round-trips exactly) while the parser also accepts bare
  `/photo/<id>`, trailing slashes, and unknown paths (normalized to
  canonical by the sync effect). Ids are
  `encodeURIComponent`-escaped on build and decoded on parse, so
  spaces round-trip and an encoded `%2F` stays inside one segment.
  (R6-6)
- **Legacy URLs ride the existing sync effect for free.** Old
  `?photo=`/`?album=`/`?collection=`/`?tool=` links still parse when
  the path carries no route (path wins on conflict), and the
  unchanged URL-sync effect rewrites them to canonical paths via
  `replaceState` — the redirect needed no new code. (R6-6)
- **Single-file reports get ground-truth verification first.**
  "Denoise Auto is on for DSC06322.ARW" started in `f8.db`: the
  ISO 6400 value was genuine, state resets per `photo.id` (no leak),
  and no ARW-specific handling exists — systematic elimination that
  named the real defect (draft-keyed highlight) instead of one file.
  The R6-4 repro-script instinct, applied to a data question. (R7-3)
- **Comments must track contract changes.** When Denoise stopped
  highlighting for drafts, `shouldAutoDenoise` ("seeds the draft",
  no longer "engages the toggle") and the stale "applied without a
  snapshot is a draft state" note were rewritten in the same commit
  — a comment describing the old contract invites reintroduction.
  (R7-3)
- **Magnifiers paint from the edited canvas, not the source.**
  The 16x loupe reuses the brush cursor tracking and the minimap's
  every-render `drawImage` mirror, so it shows adjustments, crop,
  and rotation exactly as framed at one `drawImage` per frame —
  zero extra render cost, consistent by construction (the R4-7/R4-8
  shared-run rule). Magnification is relative to the displayed
  photo, matching the existing zoom-percentage convention. (R7-4;
  reshaped to a fixed 8x corner pane in R8-3 with the same mirror.)
- **A `dismiss` with a fallthrough `return current` is a no-op
  trap.** Preview-ready denoise compiled and rendered fine but
  Cancel did literally nothing because that phase fell through
  unchanged. Enumerate every phase in a pure transition helper
  with exhaustive per-state tests, and trace each dismiss target
  against every render branch: the old code could also land on
  `idle` + stored recipe + live base, a combination the UI renders
  with zero actions (a re-preview dead end). Test the transition
  matrix, not just the reported state. (R8-2)
- **Verify shortcut availability across modifier branches.** Plain
  `Z` looked taken by undo until the keyboard map confirmed the
  Ctrl/Cmd branch returns before the plain-key map — `Z` (mnemonic
  for Zoom, free in the Preview domain) never collides with
  Ctrl/Cmd+Z. New shortcuts get listed in the menu item and the
  shortcuts dialog in the same commit. (R8-3)
- **Menu options toggle; the shortcut is just the default
  option.** Re-picking the active magnification turns the zoom pane
  off; Z fires the 8x action, so Z with 4x active switches to 8x
  rather than turning off — one rule, no special cases. (R9-1)
- **Fit means magnified diameter vs pane size, boundary
  inclusive.** A brush whose diameter × factor exceeds 180px stays
  out of the zoom pane; exactly 180px still draws — "same size or
  smaller" pins the boundary. (R9-1)
- **New computed routes must register in every collection
  guard.** `/album/rating-5` deep-links survive only because the
  unknown-collection guard, grid filter, and titles resolve through
  the shared `photoInCollection` / `isBuiltInCollection` /
  `titleForCollection` helpers — the inline duplicate in App was
  the bug shape, per the R2-11 seam. (R9-2)
- **Shared entry-exit helpers keep cross-view behavior
  uniform.** Touching a filter chip inside a smart album drops back
  to All Photos with that filter via the shared `dropEntryPreset`,
  like Favorites and Recently Edited. (R9-2)
- **Mirror the version as a literal with a drift-failing test, not
  a build-time import.** Importing `package.json` into core needs
  `resolveJsonModule` plus import-attribute handling across `tsc
  -b`, vitest, Vite, and the server's type-stripped dev mode; a
  mirrored `APP_VERSION` literal with a test that fails on drift
  plus a sync script chained into the version command has zero
  build risk and the same guarantee. (R9-3)
- **Fixed-group versioning for a single app number.** All four
  workspaces move in lockstep via one changesets `fixed` group;
  private packages need `version: true` or changesets won't move
  them at all; the command is `version-packages` because Yarn 4's
  built-in `version` would shadow a script of that name. (R9-3)
- **Derive placement synchronously from render state, not from
  DOM-measured effects.** Docking the zoom pane from `stageSize` +
  frame dims in the same render means zooming can never flash the
  wrong placement; the effect-updated `viewport` state lags zoom
  changes by a frame. (R10-2)

## 5. Testing practices (repo-specific)

- **Server-rendered tests pin markup contracts, not click-derived
  states.** Toggle-off paths, slider-0 disabled states, and other
  interaction-only states must be pinned at the CSS-rule level (via
  the `cssRule(selector)` helper) with an explicit comment — or
  wait for a jsdom/e2e pass. SSR `renderToStaticMarkup` + `cssRule`
  covers TSX+CSS without jsdom, and pins initial loading state for
  free since effects never run. (R1-4, R1-9, R1-13, R2-5, R2-7, R2-8)
- **App-level click behavior ships as pure `@f8/core` helpers.**
  UI tests are SSR-only with no click simulation and `App.tsx` has no
  unit harness — check for that seam first before reaching for jsdom or
  source-pinning workarounds. Prefer framework-free logic in core with
  node-runnable unit tests over untestable hook internals when a package
  has no DOM/effects harness. (R1-16, R2-10, R2-11, R2-12)
- **Source-pinning is the precedent for unobservable wiring**: closed
  `...` menu items (exact JSX string + ordering assertion), Toolbar
  action wiring, interface prop absence. Static markup can't observe
  `onChange` closures — the source-read precedent
  (`collapsePanels.test.tsx`, `detailsToggle.test.tsx`) is the honest
  way to pin wiring that survives a markup change. Scope
  interface-absence regexes to the interface body (`[^}]*`) —
  `[\s\S]*?` leaks into file content and false-fails. (R1-11, R1-12,
  R2-2, R2-12)
- **The `cssRule(selector)` helper anchors on `selector\s*{`.**
  Never write combined selectors (`.a, .b`) — they break the
  lookup. Duplicated rule bodies are the convention here. (R1-1)
- **Absence assertions must target a stable identifier
  (`aria-label`)**, not the absence of a modifier class, which
  passes trivially once markup is gone. Asserting the photo `src`
  URL is absent proved stronger than just checking for `<img`.
  (R1-10, R2-7)
- **Pin class+label pairings in one assertion** to catch
  per-section crosstalk that separate assertions miss. (R1-3)
- **Bound section-scoped assertions between known headings**
  (`<h3>Denoise</h3>`…`<h3>White Balance</h3>`) so later sections
  gaining similar classes don't cause false failures. For "last
  section" slices, anchor on structural tags (`lastIndexOf('<section')`),
  never fixed-width lookbacks — long inline SVGs break them. Global
  token counts are weaker; heading-bounded slices keep assertions
  scoped. (R1-8, R1-9, R1-10, R1-11)
- **Removing a section has test blast radius.** Anything slicing markup
  between `<h3>` headings or enumerating all panels hardcodes the
  section list — `collapsePanels`, `histogramFirst`, `singleResetIcon`
  all needed updates. (R2-2)
- **`html.split('<section…')` chunks are already bounded by the next
  delimiter** — only the last chunk needs an explicit bound. Verify
  chunk-boundary assumptions empirically before asserting. (R1-8)
- **Exact per-render label counts guard against vacuous passes**
  and surface un-audited instances. (R1-15)
- **SSR probes can pin hook state-initializer paths without
  jsdom**; the async effect path then shares the same tested
  helper. (R1-7)
- **Absence-pinning tests act as executable TODOs**: earlier
  `not.toContain(...)` pins fail loudly the moment the feature
  lands, making the update checklist self-evident. (R1-12)
- **Rewriting pinned tests is correct when the task overturns them**,
  but each rewrite needs a comment recording *why* the old pin was
  wrong, or the next reader will "fix" it back. (R2-1, R10-1)
- **Keep old testids through relocations** — same testid + tooltip
  strings collapse most churn to class-name updates. (R2-2)
- **`noUncheckedIndexedAccess` is on**: regex `match[1]` in tests needs
  `?? ''` to avoid a typecheck round-trip. (R2-9)
- **"Don't run Playwright" ≠ "don't update Playwright specs."** Grep
  e2e for the changed UI and update stale expectations in the same
  commit, or the next e2e run fails on an intended change. (R2-3,
  R4-4, R6-6)
- **A test pinning "keep X different" is a deliberate contract, not
  incidental coverage.** When a task flips it, update the rationale
  comment too — not just the assertion — and add an explicit match
  test plus a guard that the donor glyph's other use is untouched.
  (R3-2)
- **A more specific selector shape can dodge a "zero overrides"
  pin.** `> …:first-child` keeps those assertions green while still
  changing behavior — read the pinned contract and extend it in a new
  file rather than assuming green means unaffected; and always pin
  the `:first-child` child order in SSR markup, since a reorder
  silently disables the style with every test passing. (R3-3)
- **Stylesheet-pinning tests can assert relationships, not just
  literals.** Parsing the trigger margin and comparing it to the calc
  offset couples the two values so they cannot drift apart. (R3-7)
- **Verify new tests fail on old code** (`git stash` + rerun — R3-6:
  4 fail / 2 pass) to prove the test pins the fix, not incidental
  markup. SSR-rendered layout assertions are a cheap, jsdom-free way
  to do this. (R3-6, R10-1, R10-2, R10-3)
- **Substring traps in markup assertions.** `'</button>'`-style closers
  and a target attribute inside its own opening tag break naive
  `slice(a, b).not.toContain('<button')` checks on the boundary tags
  themselves — pin element boundaries explicitly
  (`lastIndexOf('<button', …)`). (R3-1)
- **Effect internals follow the core-helper seam.** Skip logic living
  in an effect with post-loading internal state isn't SSR-observable,
  so coverage goes through a pure `@f8/core` helper truth table — the
  same pattern as the existing canvas-drag routing. (R3-5)
- **Source sweeps match comments too.** A CSS comment mentioning
  "backlink" tripped the independence test's selector regex — word
  comments to avoid tripping prose-unaware assertions (or scope the
  sweep). (R4-3)
- **A migration sweep is the regression guard.** After moving every
  tooltip off `title`, a test sweeping all component sources fails on
  any native tooltip added back — the migration can't silently
  regress. (R4-4)
- **Untestable transports get pure parsers in core.** `apps/web` has
  no unit runner, so the health-payload mapping lives in core as a
  pure function with node tests — following the `superresTileProgress`
  precedent — instead of leaving the previously untested mapping
  uncovered. (R4-6)
- **Untestable environments get a `deps` seam.** Core tests run in
  node where the DOM export pipeline can't execute, so the estimate
  swaps its render/encode stages via an optional seam and pins the
  wiring (render-at-size → encode-with-settings → bytes+dims). (R4-7)
- **Pin controlled wiring; behavior follows structurally.** SSR-only
  tests can't click, so the focus tests inject off-center/edge values
  and assert both box and zoom follow — persistence across presets
  then follows from dialog-owned state. (R4-8)
- **Sanitize at the persistence boundary, never throw.** Unknown
  kinds/keys, snapshot-less entries, and duplicates are dropped by a
  sanitizer with garbage-input tests — stored data is untrusted
  input. (R4-1)
- **A test build catches what grep misses.** One inline snapshot with
  the old object shape survived a source grep and only failed at
  `build` — run the full gate, not just the tests you expect to
  change. (R4-6)
- **Handlers are invisible to static markup — pin them at source
  level.** `onPointerDown/Move/Up` and conditional `onDoubleClick`
  wiring can't be observed via `renderToStaticMarkup`, so the
  pointer-capture and reset-handler wiring are pinned by reading
  component source, while markup pins (tooltip/testid placement,
  `draggable="false"`) and pure-helper units cover the rest.
  (R5-4, R5-5)
- **Unanchored `cssRule` resolves the FIRST match — selector
  placement in the stylesheet is load-bearing.** The updating-dim
  rule had to sit mid-list so the helper still resolved the main
  rule first; keep new rules positioned with the helper in mind.
  (R5-6)
- **A figure-vs-box regression test pins coordinate fixes.**
  Asserting the same client point maps to 91% on the old rect and
  100% on the new one proves the test pins the fix, not incidental
  markup — the mapping-test equivalent of the R3-6 stash check.
  (R5-5)
- **Pin no-layout-shift with byte-identical markup assertions.**
  Updating-vs-settled export markup must differ only by the
  `is-updating` class; loading-vs-loaded histogram markup must be
  identical after stripping the live curve group. If nothing may
  appear/disappear, assert the bytes, not just the absence of one
  known element. (R6-1, R6-2)
- **Strictly-empty renders pin "nothing" exactly.** The pending
  backlink asserts the full `<div
  class="collection-breadcrumb"></div>` — no button, no span, no
  text — which is stronger than one absence check and fails on any
  future placeholder. (R6-7)
- **Stylesheet pins can assert size relationships.** The portrait
  preset test pins the 43px rule against the landscape sizing
  (under half the grown 118px max, under the 66px basis) — the
  R3-7 relational-pin instinct applied to a "too wide" report.
  (R7-1)
- **Effect-driven paint keeps the minimap seam.** The loupe's paint
  runs in an effect unreachable from server rendering, so UI tests
  pin the View-menu placement/checked state, the App wiring, the
  cursor-tracking gate, and the stylesheet — while the pure core
  geometry (`ZOOM_LENS_MAGNIFICATION = 16`, source-rect math, edge
  clamps) carries node-runnable unit tests. (R7-4)
- **Docs tasks get executable pins too.** The README rewrite ships
  `readme.test.ts`: README stays light (<150 lines, no deep-dive
  markers), every `docs/*.md` reference and embedded image exists,
  italics attributions and init commands are present, and each
  extracted doc holds its expected content. (R7-5)
- **Let the data drive fit assertions, not hand-picked examples.**
  The portrait test asserts every name in `PRESETS` fits the box
  under a deliberately conservative (~13%-over) glyph-width
  estimator plus 8px headroom — and the test caught the author's
  own miscount ("Teal & Orange" is 13 chars, not 12). Adding a
  longer preset later fails loudly. Calibrate the assertion's
  headroom honestly instead of inflating the design value to
  satisfy the estimator; document the real margin. (R8-1)
- **A rewritten pin keeps a guard proving it would catch the old
  bug.** R8-1 rewrote the six R7-1 tests that pinned the
  truncating 43px item (correct per the R2-1 overturn rule), and
  the new suite asserts the longest-name estimate exceeds 43px —
  proving the check fails on the old sizing. (R8-1)
- **Hook logic needing unit tests goes to core as pure
  functions.** `apps/web` has no unit-test harness (Playwright
  only, and these runs forbid it), so `dismissDenoiseStatus` lives
  in `@f8/core` with a node-runnable truth table covering every
  transient/settled phase × base/no-base — the same seam as R3-5
  and R4-6. (R8-2)
- **Tests pinning the old markup are the contract change when the
  task demands realignment.** The two pins of the bare centered
  denoise button were updated to the shared row and recorded in
  the writeup as the intended change — not worked around, not
  silently rewritten. (R8-2)
- **Strict parsers pin both acceptance and fallthrough.**
  `ratingForCollection` accepts only integers 1..5, and everything
  else falls through to album matching — pinned with invalid-id
  tests plus a grid-URL round-trip, so a bad smart-album id can
  never strand the grid. (R9-2)
- **Version mirrors get executable drift pins.** `APP_VERSION` is
  semver, equals all four workspace `package.json` versions, and
  the retired wording is gone from user-visible copy — while the
  sync script's three paths (in-sync no-op, cross-workspace drift
  failure, stale rewrite) get hand-verified exit-code coverage.
  (R9-3)
- **Nested labels need full-span matches.** `★★★` is a substring
  of `★★★★★`, so bare-substring assertions pass vacuously — pin
  whole labels (full-span matches, highest-first) instead.
  (R10-3)

## 6. Tooling gotchas

- **`muse.search` is flaky in this repo.** It defaults to **literal**
  matching — alternations like `a|b` silently return nothing unless
  `mode: "regex"` is passed; scoped/multi-path searches repeatedly
  returned empty for matches `grep -rn` found instantly. When search
  looks suspiciously empty, retry unscoped/single-path or fall back to
  `grep` before concluding code doesn't exist.
  (R1-2, R2-3, R2-4, R2-6, R2-7, R2-8, R2-10)
- **Vitest file filters are workspace-relative**
  (`src/components/...`), not repo-root-relative; root-relative
  filters exit 1 with "No test files found". (R1-2)
- **Vitest doesn't typecheck.** Always run the typecheck gate on
  new/changed test files — passing tests can hide fixture type
  errors only `tsc` catches. (R1-8, R1-12)
- **`@f8/web` resolves `@f8/core` and `@f8/ui` from `dist`, not `src`.**
  Rebuild the dependency's dist before typechecking, or you chase
  phantom errors — `TS2305 has no exported member` after adding a core
  export is a stale-build signal, not a real problem. The same
  applies to `@f8/ui` tests resolving `@f8/core` through
  `packages/core/dist` — a core `src` change needs a local core build
  before UI tests see it. "Tests pass but typecheck fails" is the
  signature of a stale `dist` (unit tests resolve source). Never
  commit `dist/`.
  (R1-7, R1-8, R1-12, R1-16, R2-4, R2-11, R2-12, R3-1, R3-5, R3-6,
  R4-4, R4-5, R4-6, R4-7, R4-8, R5-1, R6-6, R7-4, R8-2, R8-3,
  R9-1, R9-2, R9-3, R10-1, R10-2, R10-3)
- **Commit by explicit paths, never `git add -A`.** Stray files
  (e.g. `.DS_Store` under `docs/`) get swept in otherwise. (R1)
- **No CI, no configured linter** — both packages' `lint` scripts
  are no-op echoes. No Playwright for these tasks by instruction;
  unit/integration tests only; tests + typecheck are the only gates.
  (R1-9, R1-13, R2-4)
- **Vite `base: "./"` breaks deep-link reloads under nested
  paths.** R6-6's `/photo/…` and `/album/…` routes made the relative
  base resolve the favicon and lazy `vision.worker`/opencv chunks
  against `/photo/` or `/album/` (404s) — the fix is an absolute
  `"/"` base, verified in the built `dist/index.html`. Any routing
  change must re-check the base + lazy-chunk URLs in a production
  build. (R6-6)

## 7. Scope and ambiguity discipline

- **Deleting a rule/component requires an exhaustive usage grep
  first.** Proving a selector could only ever match the bug itself
  (or has zero remaining usages) is what makes deletion safe. One
  stray-visual report means auditing all consumers of the shared
  logic — the same tick root cause covered four sliders, and fixing
  only the reported one would have re-filed the bug twice; the
  `.menu-item` flex fix likewise covered the Zoom parent, the
  flyout, and the sort menu at once.
  (R1-5, R1-13, R2-5, R10-1)
- **Icon reuse audit before picking a glyph.** The obvious `Palette`
  pick was already taken by Hue & Saturation; `SwatchBook` had zero
  uses. And change the color-related surface, not the generic chrome.
  Before swapping, grep every usage of both glyphs to confirm the
  donor exists only at the reference site and no other test pins the
  target's glyph. (R2-6, R3-2)
- **When restyling, grep the responsive overrides too.** Old-shape
  rules at narrow breakpoints silently re-break the new shape at
  small widths if left behind. (R3-8)
- **A control duplicating another control's state is safe to delete
  only after proving no hidden semantics** — git history (e.g. the
  bypass→visibility conversion) can be that proof. Record it in the
  writeup so nobody re-litigates. (R1-11)
- **Record scope boundaries in the writeup.** Repair-tool sections get
  no resets (tool prefs, not photo edits); the Canvas "Loading the ML
  engine…" hint stays while the warmup UI goes silent; the shared
  `grid` toggle keeps its semantics while `back` is one-directional.
  Don't churn a settled contract owned by another task — leave it
  alone and document why. (R1-6, R1-8, R1-9, R1-13, R1-15, R2-1,
  R2-3, R2-12)
- **When a complaint's nouns are loose, anchor on physical
  measurements.** "Toolbar buttons need top/bottom margin" matched the
  zero-margin full-height menu triggers far better than tool buttons
  that already had 9px margins. Record the alternative reading in the
  writeup so it can be redirected cheaply. (R2-9)
- **Suffix removal and de-golding (or any two separable concerns)
  are separable decisions.** A face hit keeps its `· ML` engine
  tag for provenance while inheriting the non-gold span color.
  (R1-6)
- **Sequencing uniformity work into its own task keeps later tasks
  trivial.** Once Details converged to the plain-section shape,
  adding its reset was a single line plus test updates; R2-2–12 all
  reused R2-1's Auto-vs-ML rule, header order, and collapse invariant
  rather than re-deciding them. (R1-12, R2)
- **Out-of-scope findings still get recorded.** The straighten
  warmup cancel reusing the "Cancel repair" label is a label bug
  for a future task — noted in the R1-15 writeup, not fixed
  there. (R1-15)
- **Feasibility-conditioned tasks get an explicit verdict.** "If not
  accurate, don't do it" was answered by construction (background run
  of the real pipeline → byte-exact), with the rejected heuristic
  and its error bounds recorded — and where no number exists (2x),
  nothing shipped. (R4-7)
- **Answer the real pipeline, not a scaled proxy.** JPEG/WebP size
  is content- and encoder-dependent; encoding small and scaling errs
  by tens of percent. A debounced background run of the identical
  pipeline costs the same work the export does anyway. (R4-7)
- **Don't double expensive ML work for sub-1% accuracy.** The size
  estimate uses the blur repair fallback instead of the worker heal —
  pixel diffs confined to small regions — rather than paying two
  heal round-trips. (R4-7)
- **No speculative engine warm on a checkbox tick.** Warming the
  session when 2x is armed would burn server CPU on a maybe-export —
  a product call beyond the bug; the note sets the expectation
  instead. (R4-6)
- **Sub-perceptual deltas stay out of scope.** The 1.5px backlink/
  toggle edge delta was left alone — unifying heights would ripple
  into the open-sidebar state and grid title for no visible gain.
  (R4-3)
- **Check for the existing hook before adding state.** The trigger
  already toggled `is-open`/`aria-expanded`, so the rounding fix was
  pure CSS with no TSX change — same instinct as the R2-3
  discriminator check. (R4-2)
- **Design task N's seam so task N+1 can extend it.**
  `estimateExportBytes` was reimplemented on the new
  `renderExportPreview` without breaking callers, so the preview
  task shared the estimate's run instead of adding a second one.
  (R4-7, R4-8)
- **Removing a hint means auditing the behavior it advertised.**
  The Quality slider's double-click reset silently reset to `0`
  on a 10–100 scale (no `defaultValue` passed) — keeping a hidden
  broken reset while deleting its hint would be worse than
  removing both. A hint can be the only visible symptom of a
  broken default. (R5-4)
- **Deleting a control means proving each shared dependency still
  has consumers.** The removed Settings button's `downloadBlob`
  serves the real export path and `.text-button` spans the
  Inspector/browser — only the button-only `Download` icon import
  and the exclusive `.export-settings` subclass were dead.
  (R5-7)
- **Shared-pattern siblings outside the task get recorded, not
  fixed.** The denoise closeup shares the export preview's
  click-on-figure pattern and likely the same y-offset — noted in
  the R5-5 writeup as a follow-up, untouched in the commit.
  (R5-5)
- **Single-instance reports need a breadth check first.** "Reset
  stays highlighted on DSC06323.ARW" reproduced on every photo — a
  repro script (fresh default ⇒ default, after-reset recipe ⇒
  default) confirmed the predicate bug before any fix was written,
  and named the real scope (all photos, two defects) instead of one
  file. (R6-4)
- **Check the existing infrastructure before adding any.** Path-URL
  deep-link reloads needed no server change (`app.ts` already falls
  back non-`/api` GETs to `index.html`) and no redirect code (the
  URL-sync effect already rewrites). Verify first, then build only
  what's missing — the R2-8 instinct. (R6-6)
- **In multi-task batches, leave files owned by a later task
  alone.** Task 2 left the README's "library server" mentions for
  Task 5's rewrite instead of creating a conflict; Task 5 left
  `docs/learnings.md` for the parent synthesis. Record the deferral
  in the writeup so it reads as deliberate, not missed. (R7-2, R7-5)
- **Doc extraction moves content verbatim into one-question-per-file
  docs.** The README split into architecture (how it is built),
  features (what it does), and development (how to change it) with
  zero rewording; the ASD-STE100 simplification applied to the new
  README only — simplifying extracted detail loses information.
  (R7-5)
- **Reuse the only screenshot via `git mv`, staleness and all.**
  The 10MB root asset moved to `docs/screenshots/app.png` with
  history kept instead of duplicating; its staleness (old title
  bar) is noted in the writeup, and retaking was out of scope
  without browser automation. (R7-5)
- **Same tier, same message.** The app-server gate reword left
  "Photo server offline." (the ML-tier line in `Inspector.tsx`)
  untouched — it names a different tier, not this gate. (R7-2)
- **Read the prior task doc before touching an area.** The R7-1
  writeup explained *why* 43px existed, which led to the split
  solution (wide item, narrow thumbnail) instead of a blunt
  revert; `docs/tasks/11` plus `git log` revealed the zoom loupe
  as a partial implementation to reshape, not a greenfield
  feature — assuming a blank slate would have duplicated the
  toggle and menu wiring. (R8-1, R8-3)
- **A presentation change deletes what it obsoletes.** The
  cursor-clamp helper became dead the moment the magnifier pane
  stopped following the cursor; leaving it would confuse the next
  reader — and the singular/plural label branch went the moment
  ★ repetition removed plurality. Same instinct as the
  R1-10/R2-1 retire-both-halves rule. (R8-3, R10-3)
- **Scope a convention to what the task names.** R8-2 converged
  in-content tool actions onto `.suggestion-actions` but left
  header chrome, the straighten status row, and the B&W toggle
  untouched as documented boundaries — churning pinned,
  intentional treatments the task never named would be scope
  creep, not consistency. (R8-2)
- **"Show under X" is placement, not renaming.** The Zoom-in-View
  move kept the label, the shortcuts-dialog entry, and the Z
  shortcut stable — only the position (with the Show toggles,
  above the separator) changed. (R9-1)
- **Reshaping a feature means auditing sibling docs, not just the
  README.** `features.md` still described the old 16x loupe after
  the R8 pane reshapes — grep `docs/` for the old description in
  the same commit. (R9-1)
- **Read "counts we have saved" as distinct values present.**
  Star smart albums appear per rating present (3- and 5-star ⇒
  two rows, highest first), never for empty ratings — no row ever
  shows zero. Record the alternative reading in the writeup.
  (R9-2)
- **Install gaps ship as writeup caveats with the recovery
  command.** `@changesets/cli` was declared but uninstallable
  here (no registry access), so the writeup names the exact gap
  (`yarn.lock` doesn't cover it) and the fix (`yarn install`
  with network) instead of leaving a mystery failure. (R9-3)
- **A rare overlap beats a constant flicker.** The docked zoom
  pane can overlap the minimap at some scroll positions when a
  tall zoomed frame meets a very wide stage — accepted, because
  gating on measured viewport state would flicker the placement
  on every zoom-out. When two defects trade, ship the rare one
  and record it. (R10-2)

## Per-task index, R1 (writeups removed; commits reachable via git)

| # | Commit | Writeup (removed) | One-line summary |
|---|--------|-------------------|------------------|
| 1 | `8b9b2cc` | `01-ml-button-style.md` | Enabled ML matches enabled Auto (muted gold) |
| 2 | `0f9fabb` | `02-denoise-preview-16x.md` | After-only first row + 16× closeups + focus rect |
| 3 | `cdf1f78` | `03-reset-per-adjustment.md` | Persistent reset when non-default; Revert folded in |
| 4 | `468cfc3` | `04-denoise-auto-ml.md` | Denoise Auto converged into right-aligned header ML |
| 5 | `168db4f` | `05-subject-bg-slider.md` | Dead first-child rule stretching S&B toggle removed |
| 6 | `14a6db0` | `06-status-text-not-gold.md` | Plain "No faces found" / scene text, not gold |
| 7 | `044b423` | `07-scene-ml-reload.md` | Scene Enhance ML stays enabled across reload |
| 8 | `5dfc094` | `08-single-reset-icon.md` | Audit + regression pin: one reset icon per header |
| 9 | `b2a1d0d` | `09-denoise-golden-link.md` | Denoise actions become golden links |
| 10 | `fb32b91` | `10-reset-hover-unchanged.md` | No hover-tease reset on clean sections |
| 11 | `7428d8b` | `11-details-toggle.md` | Details drops duplicate header toggle |
| 12 | `3242784` | `12-details-reset.md` | Details gains header reset |
| 13 | `2e986a7` | `13-actions-golden-links.md` | Repair/face actions become golden links |
| 14 | `8dafe5b` | `14-ml-align-right.md` | Removal/Dust Spots run from right-aligned header ML |
| 15 | `913da57` | `15-cancel-dismiss-align.md` | Cancel/Dismiss share one action-row treatment |
| 16 | `75e5feb` | `16-star-during-repair.md` | Star/favorite applies immediately during repair |

## Per-task index, R2 (writeups removed; commits reachable via git)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `277507b` | `01-adjustment-styling-consistency.md` | Heuristics say Auto, collapsed keeps action, reset never hides, toggles retired |
| 2 | `21723d3` | `02-auto-enhance-header-button.md` | Auto Enhance becomes header Auto pill + `...` item |
| 3 | `4ee8f5b` | `03-silent-repair-warmup.md` | Repair warmup runs silent until a real repair starts |
| 4 | `91762c9` | `04-stacked-repair-sourcing.md` | Stacked ML repair heals against the repaired image |
| 5 | `bb1ada2` | `05-brush-size-origin-tick.md` | Origin tick gated on signed sliders only |
| 6 | `390f6f5` | `06-color-presets-icon.md` | Preset strip gets the SwatchBook icon |
| 7 | `ebea0ef` | `07-photo-information-modal-cleanup.md` | Modal drops preview, shrinks Add, spaces rule |
| 8 | `0d478da` | `08-no-flash-photo-loading.md` | Thumbnail hold + crossfade, loading pill |
| 9 | `517ea8e` | `09-topbar-menus-and-buttons.md` | Flush dropdowns, static f/8, slimmer triggers |
| 10 | `dc9edb0` | `10-grid-size-slider-direction.md` | Slider value is preview size, mirrored to columns |
| 11 | `7d265b9` | `11-album-click-deselects.md` | Re-clicking a sidebar album returns to All Photos |
| 12 | `d669239` | `12-photo-backlink-rethink.md` | Editor-only backlink pill, static grid title |

## Per-task index, R3 (writeups removed; commits reachable via git)

| # | Commit | Writeup (removed) | One-line summary |
|---|--------|-------------------|------------------|
| 1 | `a53eb50` | `task-1.md` | Reset-to-original toolbar action next to presets toggle |
| 2 | `4372e63` | `task-2.md` | Toolbar presets toggle matches strip SwatchBook icon |
| 3 | `3e88164` | `task-3.md` | Adjustments descriptions flush with first slider label |
| 4 | `082fb5b` | `task-4.md` | Reloaded Auto enhance reopens idle, not enabled-without-reset |
| 5 | `c867547` | `task-5.md` | Skip canvas repaint during live repair drags |
| 6 | `66f0ae1` | `task-6.md` | Album preview frame sized at final image aspect |
| 7 | `ebbd1cb` | `task-7.md` | Top menu dropdowns open flush with trigger pills |
| 8 | `747a425` | `task-8.md` | Photo backlink becomes single-line ghost back button |

## Per-task index, R4 (writeups removed; commits reachable via git)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `31b07f3` | `task-1-persisted-action-stack.md` | Persisted per-photo Auto action stack; reverts survive reload |
| 2 | `8446249` | `task-2-menu-dropdown-meeting-rounding.md` | Open trigger/panel meeting edges squared via `.is-open` |
| 3 | `aa9bf98` | `task-3-collapsed-backlink-flush.md` | Collapsed toolbar hugs toggle; backlink seam has zero gap |
| 4 | `8fa9df8` | `task-4-themed-viewport-safe-tooltips.md` | Hand-rolled `data-tooltip` + delegated themed bubble |
| 5 | `011e73f` | `task-5-photo-only-toolbar-gating.md` | Photo-only toolbar buttons omitted in library view |
| 6 | `7e4c58e` | `task-6-superres-cached-weights-note.md` | Cached-but-cold weights get an honest note, not "missing" |
| 7 | `2414132` | `task-7-export-size-estimate.md` | Byte-exact size estimate via background real-pipeline run |
| 8 | `2d09d19` | `task-8-export-jpeg-zoom-preview.md` | 16× lossy quality preview sharing the estimate's run |

## Per-task index, R5 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `c881f31` | `backlink-flash-histogram-loading.md` | Null-while-unknown backlink + shimmer pill; animated histogram skeleton |
| 2 | `64e14c6` | `undo-redo-reset-album-view.md` | Undo/Redo/Reset omitted on album view via `showPhotoTools` |
| 3 | `79f070f` | `reset-highlight-when-edited.md` | Reset highlighted with `is-active` iff `canReset` |
| 4 | `32261ce` | `remove-quality-reset-hint.md` | Quality-only `disableReset` drops broken hint + handler |
| 5 | `58139d9` | `export-preview-drag-click-position.md` | Draggable focus square; clicks measured on image box |
| 6 | `37c7bae` | `export-preview-keeps-open-on-preset-change.md` | Stale-dimmed preview fades to new pixels across presets |
| 7 | `4ccba62` | `remove-download-settings-button.md` | Export dialog Settings button + dead CSS removed |

## Per-task index, R6 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `d053e4e` | `01-export-modal-no-resize.md` | "Updating preview" line removed; dim-only updating feedback |
| 2 | `5361a40` | `02-histogram-flat-start.md` | Histogram starts flat, curves rise from zero |
| 3 | `8f212d2` | `03-copy-filename.md` | Filename click copies via boolean clipboard helper |
| 4 | `cb39df2` | `04-reset-button-highlight.md` | Per-key `isDefaultEdit` + shared `RESET_PATCH` + denoise cleared |
| 5 | `1245b9d` | `05-export-button-photo-only.md` | Export gated on `showPhotoTools` |
| 6 | `2cded86` | `06-path-urls.md` | `/photo/<id>/<tool>` + `/album/<id>` routes, legacy queries redirect |
| 7 | `1697df2` | `07-backlink-fade.md` | Pending backlink renders null, fades in on arrival |

## Per-task index, R7 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `85ff3a5` | `08-preset-box-width.md` | Preset boxes narrow to 43px on portrait photos |
| 2 | `8941d8d` | `09-server-not-running-wording.md` | "library server" → "application server" copy |
| 3 | `6a708c2` | `10-denoise-auto-state.md` | Denoise Auto highlights only for stored auto |
| 4 | `b09ca22` | `11-zoom-in-view.md` | View-menu 16× cursor loupe in photo view |
| 5 | `82d5918` | `12-readme-rewrite.md` | ASD-STE100 README + architecture/features/development docs |

## Per-task index, R8 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `0b79e5f` | `13-preset-names-no-truncate.md` | Portrait preset items back to 72px names, 43px thumbnails only |
| 2 | `72e9e73` | `14-denoise-cancel-align.md` | Denoise Cancel dismisses every transient phase; actions share `.suggestion-actions` |
| 3 | `315bc9a` | `15-zoom-preview-8x.md` | Fixed 8x corner preview pane with Z shortcut |

## Per-task index, R9 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `776cc83` | `16-zoom-view-submenu.md` | Zoom in View submenu under Show (4x/8x/16x), compare-aware pane, repair circle |
| 2 | `5d47e70` | `17-star-smart-albums.md` | Star-rating smart albums in the sidebar Library group |
| 3 | `7540661` | `18-app-version-changesets.md` | App version replaces edition label; changesets set up at 0.1.0 |

## Per-task index, R10 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `516f80f` | `19-zoom-dropdown-alignment.md` | Zoom in View in own menu section; `flex-start` label alignment |
| 2 | `76f4bec` | `20-zoom-lens-outside-dock.md` | Zoom pane docks beside photo when stage has room |
| 3 | `84bec18` | `21-star-album-glyph-labels.md` | Star smart albums labeled ★×N instead of "N Stars" |
