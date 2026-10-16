# Learnings

Distilled from per-task writeups and subagent learnings across seventeen
`tasks.md` runs. Read this before touching the inspector, repair,
toolbar, export, menus, zoom, navigation, or library UI so we don't
repeat the same mistakes.

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
- **R11** = eleventh run, 2026-10-14 (11 tasks). Writeups continue
  the running log in `docs/tasks/01-version-top-right.md` and
  `docs/tasks/22-*.md`–`31-*.md`.
- **R12** = twelfth run, 2026-10-14 (11 tasks). Writeups continue
  the running log in `docs/tasks/32-*.md`–`42-*.md`.
- **R13** = thirteenth run, 2026-10-14 (6 tasks). Writeups continue
  the running log in `docs/tasks/43-*.md`–`48-*.md`.
- **R14** = fourteenth run, 2026-10-14 (3 tasks). Writeups continue
  the running log in `docs/tasks/49-*.md`–`51-*.md`.
- **R15** = fifteenth run, 2026-10-15 (2 tasks). Writeups in
  `docs/tasks/01-stretched-photo-loading.md` and
  `02-blurry-badge-standard.md` (a fresh 01- numbering, not a
  continuation of the running log).
- **R16** = sixteenth run, 2026-10-15 (8 tasks). Writeups continue
  the running log in `docs/tasks/52-*.md`–`59-*.md`.
- **R17** = seventeenth run, 2026-10-15 (4 tasks). Writeups in
  `docs/tasks/01-selective-color-slider-lag-and-swatch-ring.md`,
  `02-compare-original.md`, `03-saved-presets-submenu.md`, and
  `04-ml-enhance-conditional.md` (a fresh 01- numbering like R15).

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
- **"ML" means trained weights run on the primary path.** A
  logistic-regression form whose coefficients were typed in by hand
  after eyeballing fixtures — "set by inspection, not fitted on
  labeled photos" — is a heuristic with extra steps, not ML. That
  tell demoted Scene Enhance and Dust Spots to Auto; U²-Net,
  YuNet, YOLOv8n, DnCNN, Real-ESRGAN, LaMa, and CLIP keep the
  badge. (R11-9)
- **Headers report applied change, never a recorded check.** A
  no-face Enhance Faces scan is pixel-neutral and
  `isNeutralEdit`-clean, so its recorded recipe entry must not
  light ML or the reset — a semantic `faces > 0` flag replaced
  bare `Boolean(applied)`. (R11-8)
- **When the action moves, the ML credit collapses to a
  name-adjacent badge.** The toggle conversion removed every
  header Auto/ML button; the little `MlBadge` by the tool name is
  now the only ML marking on Enhance Faces and Subject &
  Background. (R11-11)
- **A switch that can't act yet describes its state, not an
  action.** Suggestion-less toggles (Curves/Details/Effects, the
  Denoise no-suggestion precedent) are disabled while off with
  "at defaults" tooltips and light with "on — click to reset to
  defaults" once tweaked; the tri-state Subject & Background
  switch names all three states (empty/active/bypassed) in its
  tooltips. (R12-2, R12-4)
- **Relocated controls keep verbatim copy.** The toolbar remove
  button reuses the heading's exact `Remove from library (Del)`
  label, glyph, and dispatch — position moves, nothing else.
  (R12-8; cf. R1-14, R2-2)
- **Severity follows the viewing context, not just the
  signal.** The grid's blurry badge is a filled red-brown
  verdict, but the photo view reuses the same label as a
  muted amber outline chip with "Might be" copy — in the
  photo view you are already looking at the pixels, so the
  hint is a nudge, and "might" matches the heuristic
  fixed-threshold detector behind it. (R14-3; superseded by
  R15-2 below.)
- **One shared badge kills drift by construction**
  (supersedes the R14-3 severity-by-context rule). Both
  views render the same neutral `BlurryBadge` (9px lucide
  `TriangleAlert` inheriting the badge's text color, plus
  the word "Blurry") — the per-view costumes ("Blurry ·
  ML" red-brown pill vs "Might be blurry" amber chip)
  were exactly the drift that standardization exists to
  remove. (R15-2)
- **Placeholder scores are not measurements.**
  Hand-added labels land as `{ score: 1, source: 'user' }`
  (a server-store placeholder), so the tooltip branches
  on source: ML flags get "· {pct}% confidence",
  hand-added flags get "Marked blurry by hand" with no
  percentage — which also fixed the old tooltip
  crediting ML for flags the user added themselves.
  (R15-2)
- **Copy fixes follow the sibling that already got it
  right.** "Flagged blurry by" gained its missing "as"
  from the Duplicate badge's existing "Flagged as a
  near-duplicate" — grep the parallel surface before
  inventing the corrected wording. (R16-2)
- **Statistical learning called ML needs its Boundaries
  note.** Per-user medians are honest ML only in the
  statistical-learning sense, so the docs say so
  outright (no neural net, no weights); and the menu
  item takes no `MlBadge` — the badge marks tools
  where a model runs, and the name already says ML.
  (R16-7; cf. R11-9)
- **A standard takeover keeps its heading; only the
  detail line varies.** The offline gate's heading and
  manual Try again are untouched — cause-specific
  copy (browser-offline vs unreachable server) plus
  the auto-retry note live in the second line.
  (R16-8)
- **Scoped learning names its scope in the UI.**
  The subject-scoped enhance hint names the subject
  ("No consistent habit across your grapes photos
  yet") and the ready tooltip cites the evidence
  ("Learned from 3 photos like this (grapes)") —
  while the global fallback stays silent, exactly
  as before. (R17-4)
- **Gesture tooltips teach; accessible names stay
  stable.** The immediate-hold + pin tooltip reads
  "Compare with original (B) — hold to peek,
  Shift+click for full original" while the button's
  accessible name is unchanged — the R16-4
  hint-not-name rule for a second gesture on one
  control. (R17-2)

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
- **Automatic sections carry one header switch, not a button plus
  a reset** (supersedes the R2-1 reset+action contract for tools
  with an automatic action): off→on applies the suggestion, on→off
  resets to defaults, and hand tweaks light it via dirtiness.
  Sections with no automatic action (Curves, Details, Effects,
  B&W) keep their header resets — there is no suggestion for a
  toggle to apply. (R11-11)
- **Converge onto the existing pretty control.** The toggle is the
  shared `Toggle` from `EditorUI.tsx` with generically-extended
  `testId`/`hint`/`disabled` passthroughs — the R1-4
  generic-optional instinct applied to the conversion target.
  (R11-11)
- **Whole-photo and other-tool actions stay out of a per-tool
  conversion.** The panel Auto Enhance pill keeps its
  pill-plus-revert (it restores the pre-enhance look, not
  defaults), and Repair/straighten buttons are different tools
  outside the "in Color Adjustments" scope. (R11-11)
- **A submenu parent with a state-dependent click must open by
  keyboard without clicking.** ArrowRight routes via `setSubmenu`
  directly — clicking the parent would fire the new clear action;
  off-click keeps the flyout toggle so touch users can still
  reach the 4x/8x/16x options. (R11-2)
- **Clearing through the parent still dismisses the menu.** The
  parent re-picks the active factor through `action()`, matching
  every other View-menu item — and reuses the existing re-pick
  toggle-off rule, so no new `MenuAction` and no `App.tsx`
  change. (R11-2)
- **Decorative subgroup icons are aria-hidden glyphs in an
  inline-flex label.** Subject gets the avatar, Background the
  picture (11px against 9.5px caps, centered, 4px gap); tests pin
  each group to its glyph scoped by group testid, so a swap
  fails. (R11-7)
- **A toggle that can't apply yet must say why by being
  disabled.** Denoise toggle-on only drafts the ISO suggestion
  (Preview/Apply still own the photo change), and the switch is
  disabled while working or suggestion-less-and-empty — but
  stays clickable while anything is stored, so it can clear.
  (R11-11)
- **Curves reset clears Midtones plus anchors together**
  (`{ curve: 0, curvePoints: [] }`) with matching dirty, and the
  Midtones slider takes `disableReset` — the R1-3
  dirty-mirrors-reset invariant extended to the new keys, and
  the only slider in the inspector with the opt-out. (R11-5)
- **One switch per header, with no reset left to render**
  (supersedes the R11-11 no-suggestion carve-out):
  Curves/Details/Effects/B&W all converted — disabled-while-off
  where there is no suggestion to apply, bidirectional only for
  B&W (off-to-on genuinely converts). The shared header lost
  its `onReset`/`dirty` props and the latent snapshot-revert
  path, so a reset is unrenderable by construction; the panel
  Auto-Enhance revert, crop straighten row, menu Reset All,
  and slider double-click resets deliberately stay. (R12-2)
- **A single toggle owns on/off end to end by bypassing, never
  clearing.** The Subject & Background header switch segments
  when empty and bypasses/restores while a mask lives, so
  toggle-off destroys nothing; the labeled Clear stays as the
  explicit destructive path, and bypassed slider groups dim
  via `is-off` (the Faces precedent) so off reads at the
  values. (R12-4)
- **New toolbar buttons dispatch existing menu actions.**
  Toolbar remove fires the Image-menu `remove` case (confirm
  dialog, Del shortcut, copy all unchanged), stays photo-only
  via `showPhotoTools`, and carries its danger hover tint to
  the new hook. (R12-8; cf. R3-1)
- **Menu moves keep actions, labels, and shortcuts stable.**
  Focus Mode moved to the top of View in its own section
  (item + separator ahead of the Show toggles) with the
  `fullscreen` action untouched; the empty Window menu died
  with its shortcut-less duplicate Photo Browser entry while
  the canonical `Photo Browser (G)` stayed. (R12-6; cf. R9-1)
- **Album menus group Generate above a separator from
  Delete, plus Remove while a cover is set.** Sidebar
  Generate disables on empty albums; the grid header's copy
  never disables (a filtered-empty grid is not an empty
  album) — same items, honestly different gates. (R12-9)
- **A mode that unmounts the toolbar ships its own exit.**
  Focus mode hides MenuBar/Toolbar/Sidebar/Inspector/
  PresetStrip/status, so a floating `.focus-exit` button
  (shared `IconButton`, `Minimize2` glyph, `Exit focus mode
  (Shift F)` label) parks fixed top-right at z-index 90 —
  above canvas chrome, below dialogs (100) and toasts
  (150), half-opacity until hover/keyboard focus. Esc
  leaves the mode before compare/tool/album exits; Shift F
  toggles, and `grid` (G) plus browser Back/forward leave
  it too. (R13-5)
- **Photo-level status lives in the heading, never over
  the pixels.** The blurry hint sits with its file-type/
  Edited chip peers in the filename row — an overlay on
  the frame would compete with compare labels, the zoom
  lens, and retouch overlays. (R14-3)
- **New shortcuts land in the shortcuts dialog.** Home/End
  navigation ships its `First / last photo` row in the
  Navigation section of `EditorDialogs.tsx` in the same
  commit — a shortcut nobody can discover is half a
  feature. (R14-2)
- **"Standardize" means one shared component, not two
  matching snippets.** `BlurryBadge` lives in
  `EditorUI.tsx` next to the existing shared `MlBadge`;
  matching copy pasted in two places re-drifts on the
  next touch. (R15-2)
- **Hover detail attaches to the indicator, not the
  canvas.** The blurry tooltip rides the badge's
  existing `data-tooltip` — hovering photo pixels for
  the same info would fight brush, pan, and zoom-lens
  interactions. (R15-2)
- **New per-range sections copy the Selective Color
  contract whole.** Range picker (swatches/chips) +
  dirty dots on touched ranges + the manual Curves/
  Details/Effects toggle (lights on first tweak,
  resets all, disabled while off) + one undo step
  per slider drag via a `<feature>:<range>:<param>`
  merge key. Selective Clarity is the second
  instance; a third per-range tool starts by
  copying it. (R16-3, R16-5)
- **The same action in two places holds in both.**
  Toolbar and canvas-status Compare buttons share
  one press-and-hold state machine (400 ms
  threshold, injectable scheduler, one-shot
  release-click suppression) — holding one while
  the other click-toggles would be incoherent.
  Keyboard activation stays click-only: hold is a
  pointer gesture and `\` already covers keyboard
  peek. (R16-4)
- **Hint text must not become the accessible name.**
  `IconButton` takes a `data-tooltip` override so
  the hold hint ("hold to peek") shows without
  renaming the button for existing order/gating
  tests and assistive tech. (R16-4; cf. R4-4, R6-3)
- **The second submenu generalizes the first one's
  handler.** The Image > Presets flyout copies the
  zoom-options pattern (hover opens, click toggles,
  `data-submenu` parent, active check), and the
  ArrowRight/Left handler now reads the focused
  parent's `data-submenu` instead of hardcoding
  `zoom-lens` — one keyboard path for both flyouts.
  (R16-6; cf. R9-1)
- **One shared picker keeps two surfaces
  identical.** The strip's toggle-off (re-pick
  reverts to Original) moved into App's shared
  `selectPreset` so the menu behaves exactly like
  the strip; removing the Add Adjustment footer
  left Black & White always rendered (a one-toggle
  basic section needs no second home). (R16-6)
- **Tooltips on disabled items ride a wrapper span.**
  Mouse events pass through disabled buttons, so
  the not-ready ML Auto Enhance ("N of 3 edited
  photos", "no consistent habit yet") puts its
  `data-tooltip` on a block wrapper via the shared
  `.menu-disabled-tip` rule. (R16-7)
- **New enhance modes join the shared stack, not a
  side channel.** Taste is the third `EnhanceMode`
  with the full contract (pure-taste toggles back,
  other modes apply fresh keeping the earliest
  snapshot, in-flight async invalidates) and
  surfaces through the same header revert icon —
  so the single-reset pin holds untouched.
  (R16-7)
- **Remove the wrong-layer affordance instead of
  fixing it.** The photo Try again died rather
  than being repaired: retrying a dead server
  photo-by-photo was the wrong layer — outages
  surface as the auto-recovering takeover, leaving
  the photo error for single broken images.
  (R16-8; cf. R2-12)
- **The third submenu copies the flyout contract
  whole.** The ... menu's Saved Presets parent
  follows the Image > Presets pattern (hover opens,
  click toggles for touch, `data-submenu` parent,
  active preset checked, parent checked while a
  saved preset is the active look) — the R9-1 /
  R16-6 pattern now has three instances. An empty
  library renders a disabled "No saved presets
  yet" item instead of an empty flyout. (R17-3)
- **Transient and persistent views compose by
  OR, with unpin-first exits.** The whole-original
  pin ORs into the same `showOriginal` layer the
  transient hold uses (no canvas paint changes);
  the pin survives photo switches like the split
  while `\`/button hold clears; a plain click
  while pinned unpins without toggling the split,
  and reset, crop entry, and Escape all exit it.
  (R17-2)
- **Tooltips on enabled items get their own
  wrapper class.** The ready subject-scoped
  enhance carries its tooltip on a layout-neutral
  `.menu-tip` wrapper — reusing the disabled
  wrapper's class name would lie on an enabled
  item. (R17-4; cf. R16-7)

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
- **A big blurred shadow is densest at the box edge — it reads
  as a dirty border, not a lift.** The fix is a keyline-first
  stack: a light hairline ring (topmost, ~8% white) for crisp
  separation from the dark stage, a tight contact shadow to
  ground the frame, and a negative-spread ambient whose dense
  core pulls away from the edge. On a near-black stage a
  black-only shadow either bands or vanishes. (R11-3)
- **Don't reshape geometry to fix a shadow artifact.** The
  "rounded corners" were the blur rounding the shadow band, not
  the frame — the canvas stays square (compare divider and crop
  grid assume it) with no `overflow: hidden`, which would also
  clip the outside-docked zoom lens. (R11-3)
- **Long near-black gradients band; wide blurs draw
  silhouettes.** The R11-3 ambient (50px blur, 67% black over
  `#151517`) quantized into visible 8-bit steps and reached
  far enough past the frame to draw a rounded corner on the
  stage. The fix halves gradient length (the banding lever)
  and alpha (the silhouette lever) while keeping the
  keyline — soften, don't remove, or the frame looks
  pasted-on. A banding-guard test caps max blur/alpha so a
  future "richer shadow" can't regress it. (R12-1)
- **Reorders kill positional selectors — replace them with
  class hooks.** The narrow-viewport `:nth-of-type(2)` rule
  silently changed victims on every toolbar reorder (info →
  compare → reset, and this move would have hidden compare);
  reset now hides by `.toolbar-reset` class and survives
  future insertions. (R12-7; extends R1-5, R2-9)
- **Removing a menu renumbers every positional menu rule.**
  Deleting Window made Help the 5th trigger, so the rule
  hiding the 5th menu at ≤460px was removed outright —
  re-pointing it would have stranded About + Shortcuts with
  no alternative route. (R12-6; cf. R2-9)
- **Mixed-size inline text aligns on `baseline`, never
  `center`.** The filmstrip name (9px) + count (8.5px)
  centered their unequal boxes, lifting the smaller
  count's baseline — the reported "count shows higher".
  Equalizing sizes would erase the intended quieter
  count; `line-height` hacks only narrow the gap.
  `baseline` holds for any future size tweak. (R13-4)
- **A third identical complaint means remove, not soften
  again** (qualifies the R12-1 "soften, don't remove"
  rule). Two softening passes both kept the 1px keyline
  and both were followed by the same "rigid border +
  oval" report: only an unblurred ring can draw a hard
  edge, and negative spread shrinks the source rect so
  blur dominates into a detached halo. The frame now
  carries a plain two-layer drop shadow (contact + short
  downward falloff); dark edges melting slightly into
  the stage is the accepted trade. (R13-2)
- **Every layer stretched into the frame needs
  `object-fit: cover`.** The thumbnail hold had it but
  the cached preview didn't, so any frame/bitmap aspect
  mismatch (the predictor ignores straighten) distorted
  the preview itself; residual mismatches now crop a
  sliver instead of stretching the photo. (R15-1)
- **Outline chips are unreadable over thumbnails —
  scrim them neutrally.** The grid blurry pill keeps a
  dark translucent scrim matching the duplicate pill
  (`#000a` + gray border), not a color; the photo-view
  hint takes the neutral `file-type` chip outline. Both
  rules carry `inline-flex` + gap for icon/text pairing.
  (R15-2)
- **Stale content hides instantly; fresh content
  fades in.** The loading frame snaps to the new
  photo's aspect while the old canvas was still
  fading out over 350 ms — visibly stretching the
  previous photo into the new frame. `transition:
  none` under `is-loading` kills the fade-out, and
  removing the class restores the base transition
  so the 0→1 settle still animates. Same asymmetry
  for the Compare layer: one CSS hide rule covers
  both Compare and hold-for-original with no JSX
  change. (R16-1)
- **Wipe the backing store when repaint lands a
  frame late.** The original canvas repaints in a
  passive effect *after* the loading-clears commit,
  so one frame could flash stale stretched pixels —
  `width = 0; height = 0` on switch renders nothing
  until the repaint. The edited canvas needs no
  wipe: it repaints synchronously in `renderBase`
  before loading clears in the same batch. (R16-1)
- **Align only what the request names.** The album
  Blurry pill took RAW's borderlessness + text
  color only — not its background, size, or
  position (bottom-left vs the top-left cull
  stack) — and the photo-view hint and duplicate
  pill were left alone. (R16-2)
- **Long flyouts scroll inside the viewport.**
  The presets submenu caps at `min(60vh, 420px)`
  with a scroll so big preset lists never run off
  screen. (R16-6)
- **Selection is one tight ring on the dot, never
  a padded border.** The swatch button hugs the
  color dot (no padding/border) and selection /
  hover / keyboard focus all draw the same
  `box-shadow` ring directly on it — the padded
  accent border read as color circle, gap, yellow
  outline, and the global `button:focus-visible`
  offset outline added a third ring. Applied
  identically to the Selective Clarity chips,
  which shared the structure. (R17-1)
- **Edge-docked flyouts open inward.** The
  inspector docks at the right edge, so its
  submenu opens left of the parent (the generic
  rule opens right, off the viewport) and caps
  at `min(60vh, 320px)` with a scroll like the
  Image > Presets flyout. (R17-3)

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
- **Reseed-then-sweep is the slider-spam shape.** A never-cleared
  shared fetch promise re-seeded the overlay store on every
  slider tick while the orphan sweep immediately evicted the
  re-seeded entries — one DELETE per tick, forever. The fix is
  idempotence (each orphan purged once, purged-id set,
  filtered merge), not a timer: persistence was already
  debounced, so the requested debounce existed and the bug was
  elsewhere. Verify before adding timers. (R11-4)
- **One-shot fetches are consumed one-shot per photo; sweeps
  are generation-guarded.** The photo-open fetch ref clears on
  settle, stale runs can't purge with a predated live set, and
  fresh PUT paths re-arm their id because undo can restore a
  swept stroke. (R11-4)
- **Deserialized collections compare by length, never by
  reference.** A server recipe's fresh `curvePoints: []` must
  still read as default/Original (the retouches convention) or
  every loaded photo opens Edited/Custom. (R11-5)
- **Curve math lives in core as pure reducers.** Normalize
  (sort/clamp/dedupe/cap), add/move/remove, a Fritsch–Carlson
  monotone spline (smooth like a real curve tool, slope-limited
  so it never overshoots a placed anchor), and a 256-entry table
  that is null while identity so the pipeline skips the lookup.
  The graph draws the exact render mapping — WYSIWYG by
  construction. (R11-5)
- **Make overlapping controls additive, not rival.** The
  Midtones slider keeps its parametric bend while the graph
  gains real control points (Lightroom-style): existing recipes
  render identically and the "slider does the same thing"
  overlap is gone because the graph no longer bends from a bare
  drag. (R11-5)
- **Tooltip hosts read `HTMLElement` only.** Tooltips on SVG
  scenes go on the wrapper div — svg/circle nodes can never
  trigger `TooltipHost`. (R11-5)
- **A global apply pushes per-section entries, not a derived
  highlight.** Global Auto moved section sliders (resets showed)
  but pushed only its own stack entry (pills stayed dark);
  deriving `mlApplied` from enhance state would have lit
  buttons whose revert contract had no snapshot to honor.
  Highlight ⟺ entry ⟺ revert, one mechanism. (R11-10;
  superseded by the R11-11 toggle conversion, which lights
  sections via dirtiness with no entries of their own.)
- **Fresh snapshots per enhance for section reverts,
  earliest-wins for the whole-photo revert.** A pre-enhance
  category auto snapshots older values than the enhance base,
  so reusing it would make a section revert undo more than the
  enhance did. (R11-10)
- **A snapshot's presence retargets the section reset.**
  After an enhance, section reset restores the pre-enhance
  values rather than the slider defaults — the established
  `AdjustmentSection` contract, and the more useful target.
  (R11-10)
- **Retired stack entries get a load-time sanitizer.** The
  toggle conversion deleted the per-category machinery its
  buttons served; legacy persisted category entries drop on
  load with the server round-trip covered. (R11-11)
- **Toggle-off bumps the run token before resetting** so an
  in-flight auto cannot land on the reset recipe — the R1-16
  sequence-number instinct at the new seam. (R11-11)
- **Gray-world's dominant-color failure is the textbook ML
  win; exposure targeting is taste.** Learned illuminant
  estimation (CCC/FC4 on thumbnails, ONNX + classical
  fallback) heads the WB/Lightness assessment, while
  Lightness's mid-gray pull is already covered by the scene
  classifier's night cap — and the cheapest real win is
  neither: running the existing estimators per U²-Net mask
  turns two global autos local with no new model. Model
  outputs never bypass the caps and dead zones — they are
  load-bearing UX. (R11-6)
- **Async→recipe sync effects are sync-once-per-base, never
  equality-guarded.** Denoise's recipe/base-equality guard
  re-stored the strength right after undo (wiping redo and
  re-firing the toast) because hook pixels survive undo; the
  fix tracks each applied base by identity through a pure
  core step helper (`nextDenoiseRecipeSync`, mirroring the
  straighten `runId:angle` keying) so every base syncs
  exactly once. Sibling syncs were audited clean (ready-only,
  self-dismissing, or user-triggered). (R12-11)
- **Undo keeps hook pixels; the recipe is the truth.**
  Clearing hook pixels on undo would force a server re-run
  on redo — keeping them makes redo instant while the
  cleared recipe flips the canvas back immediately. And undo
  never auto re-runs ML when it lands on a mismatched
  recipe: a multi-second run on Cmd+Z would surprise, so
  the one-click Restore path owns recipe-without-pixels
  (same as after reload) — with the corner (Inspector
  right, pixels pending) recorded in the writeup. (R12-11)
- **Sort presentation at render, keyed off the same
  condition the render uses.** Sidebar albums sort covered-
  first + numeric-aware name order in the `Sidebar` render
  (one order for load/create/generate/remove, no reorder
  bookkeeping); empty-string cover counts as no thumbnail
  because the row's `<img>`-vs-glyph gate keys off the same
  truthiness. `updateAlbum` merges by id (no refetch, no
  scroll jump). (R12-10)
- **Representative picks rank existing user signals.**
  Album cover = first favorite, else highest-rated, else
  first by filename — skipping missing/imageless records,
  preferring the thumbnail URL. Deterministic, one click,
  no picker. (R12-9)
- **Multi-press gestures must clear transient drag state.**
  Each double-click press sets `dragIndex` via the dot's
  pointerdown, so the removal handler clears it first or a
  post-removal pointermove drags a neighbor under the stale
  index. Double-click is safe against the add-on-press
  gesture (dot pointerdown stops propagation), and a
  `preventDefault`-only `onContextMenu` stays for habitual
  right-clicks. (R12-3)
- **Pointer capture retargets follow-up mouse events to the
  capture element.** While the tone-curve dot holds capture
  on the svg, `dblclick`/`contextmenu` never reach the dot
  — which is why both the original right-click removal and
  the R12-3 double-click removal silently never fired.
  Removal now runs at `pointerdown` (always hits the dot
  before capture exists) and returns before
  `setPointerCapture`, so `contextmenu` targeting stays
  natural and dual-level `preventDefault` suppression
  lands. `onDoubleClick` stays only as an unadvertised
  fallback. (R13-3; supersedes the R12-3 gesture)
- **Right press on empty graph is a no-op, never an
  add.** Any-button add-on-press turned a missed
  right-click into a duplicate point plus a menu; the
  `button === 2` branch now returns without adding (the
  `PhotoCanvas` minimap `event.button !== 0` precedent),
  and svg near-misses within the 12-unit grab radius
  remove via `hitAnchor`. (R13-3)
- **Gate view modes at render time instead of flipping
  prefs.** The old focus toggle set
  `sidebarOpen`/`inspectorOpen` false, clobbering the
  user's layout; hiding panels behind `!focusMode` mounts
  restores the exact previous layout on exit for free,
  including presets and filmstrip prefs. (R13-5)
- **Force the mode's view through a predicate, not just
  entry state.** Entering focus mode sets the editor
  view, but state can still name the grid mid-mode
  (popstate, `/` search parking) —
  `resolveFocusView`/`isFilmstripVisible` pure core
  predicates (the `isInspectorVisible`/
  `shouldShowPhotoTools` seam) keep a photo-less grid
  from ever rendering under the mode. (R13-5)
- **Variety without losing the ranking means random
  within the top tier.** Generate-thumbnail picks
  uniformly inside the tier sharing the head's favorite
  flag + rating (filename orders the tier so injected
  randoms map stably); lower tiers are never picked while
  the top tier is non-empty. Excluding the current cover
  — stateless, the caller already knows it — beats
  cycling by stored index, falling through to the next
  tier when the cover was the whole top tier and to the
  lone photo when every candidate shares one URL.
  (R13-6)
- **Neighbor preloads wait for navigation to settle.**
  Radius-2, forward-first alternating outward (`n+1, n-1,
  n+2, n-2`), wrapping exactly like the arrow handler —
  behind an 80 ms debounce whose timer resets on every
  step, so rapid arrowing never steals bandwidth from the
  photo being opened and the current photo always wins
  the race. Covers a fast double-tap without fetching the
  album. (R14-1)
- **Flush confirmed pixels on switch instead of
  shortening the idle save.** The 2 s idle preview-cache
  save never fires for quickly-visited photos, but
  shortening it would write half-settled states during
  slider drags — so the photo-change reset stashes the
  previous photo's final canvas pixels while the canvas
  still holds them. Safe only because every paint is
  generation-guarded; verify that invariant before adding
  any new async paint path. (R14-1)
- **Hidden layers paint on demand, not in the
  pipeline.** The Compare "Original" layer repainted every
  navigation while clipped to zero width — now the
  pipeline stashes decoded inputs and a demand effect
  paints only while Compare/Show Original is visible
  (skipping non-geometry ticks). The first Compare toggle
  per photo pays one GPU pass instead of every navigation
  paying it. (R14-1)
- **Focus and selection compose by sharing `event.key`.**
  The strip moves *focus*, the global handler moves the
  *selection*, and the strip never calls
  `stopPropagation` — so Home/End land together exactly
  how arrows already compose, with no filmstrip change.
  Fix focus-outside-the-strip by adding to the global
  handler, not by teaching the strip to select. (R14-2)
- **Already-there navigation is a silent no-op.** Not
  even `selectPhoto` with the same id — it resets zoom
  and clears search state — so the resolver returns null
  at the open end. (R14-2)
- **View-scoped shortcuts keep native meanings
  elsewhere.** Home/End navigate only in the editor; the
  library keeps native grid scroll (arrows only ever took
  Left/Right, so there was no scroll-theft precedent to
  follow). (R14-2)
- **Gate the divergent consumer; never flip shared
  state for one of them.** `loading` gates frame aspect
  + canvas visibility + the spinner pill: the R14-1
  preview branch cleared it to hide the spinner, which
  also flipped the frame to the previous photo's
  measured aspect and revealed the stale stretched
  canvas. Loading now stays true until `finishPaint`;
  only the spinner gates on `!previewUrl`. (R15-1; fixes
  an R14-1 regression)
- **An `<img>` overlay does not instantly cover what's
  beneath it.** Blob-URL decode is async, so the layer
  underneath must already be correct or hidden —
  holding `loading` keeps the predicted frame and hides
  the stale canvas during the gap. (R15-1)
- **Fix with hiding, not repaint timing.** Stale
  pixels are never the right content during loading,
  so instant-hiding both canvas layers beats trying
  to paint the new pixels earlier — simpler and
  robust to every pipeline duration. (R16-1)
- **"Edited" is the Reset predicate, not the look
  predicate.** Compare disables on `isDefaultEdit`
  (geometry-only edits and retouches still compare
  meaningfully), so Reset and Compare agree — and
  Reset exits the split, since it would strand two
  identical halves behind a disabled button.
  (R16-4)
- **Sparse per-range recipes mirror `curvePoints`.**
  One entry per touched range, empty is the
  identity, neutral entries pruned on write; only
  the three length-vs-reference comparisons
  (`isDefaultEdit`, `isOriginalLook`,
  `isNeutralEdit`) learn the new key — every
  spread-based downstream (server merge, preview
  key, copy/paste, enhance snapshots,
  `patchBreaksEnhancePure`) flows through
  untouched. Accepted trade-off, shared with
  curves: a hand-edited all-neutral list reads
  non-default while rendering neutral. (R16-3,
  R16-5)
- **Point ops and neighborhood ops land in
  different passes of the one pipeline.**
  Selective Color rides the point pass (after
  global hue so the picker names post-correction
  hues, before B&W so B&W still wins outright);
  Selective Clarity extends the detail passes
  (wide blur plane shared with global clarity,
  medium-blur plane for texture). Both still
  land in the shared pipeline, so canvas,
  Compare, histogram, and export agree — while
  the CSS-filter thumbnails honestly approximate
  without them. (R16-3, R16-5)
- **Gates keep ranges from grabbing what they
  don't own.** Chromatic ranges ignore near-grays
  (hue is degenerate at zero saturation) and the
  Whites/Neutrals/Blacks bands ignore vivid colors,
  via crossfading saturation gates; selective
  clarity skips the global midtone weight (the
  range bells already localize — weighting would
  mute Shadows exactly where it should bite).
  (R16-3, R16-5)
- **Sections own their toggles; no cross-gating.**
  Selective Color ignores `colorEnabled` and
  Selective Clarity ignores `detailsEnabled` —
  bypassing a section via a sibling's toggle would
  surprise. (R16-3, R16-5)
- **Duplicated formulas get a pinning test, not an
  import.** The clarity range bells copy the global
  tonal weights locally (importing from
  `adjustments.ts` would cycle) with equality
  pinned across all luminances — drift fails
  loudly. Same reason the texture radius is
  banded 1..5 between sharpness (1) and clarity
  (2..10): each detail control owns a frequency
  band. (R16-5)
- **Presets carry looks, never per-photo state.**
  `presetValuesForEdit` (one helper shared by
  save + copy) strips geometry, heal strokes, and
  denoise; `applyPreset` preserves the target's
  own denoise even against legacy presets saved
  with it — denoise is ISO-keyed per-photo, so
  applying a look keeps it rather than wiping or
  adopting the preset's. (R16-6)
- **A taste profile replaces samples, never
  accumulates.** One sample per photo id; a key
  joins the patch only when touched on half the
  photos (min two) with 3+ photos overall; the
  value is the median (robust to the one
  experimental edit), snapped and clamped. Pure
  auto output never records — the enhance
  stack's pure flag is the human-signal
  detector, so the profile can't converge on
  the app's own suggestions. Only the seventeen
  numeric look sliders learn; geometry,
  retouching, denoise, and structured state
  (curves, selective entries, flags) stay out.
  (R16-7)
- **Ping verifies; events and bursts only
  suspect.** Every offline trigger (browser
  event, 3-broken-images-in-10s burst via a
  capture-phase window listener — resource
  errors don't bubble) must fail a live
  `GET /api/health` (`cache: no-store`) before
  the takeover flips, because a localhost server
  survives a dropped uplink. The `online` event
  reloads immediately; while offline a 5s ping
  reloads on first success. (R16-8)
- **Hot pixel loops render from a per-render
  plan.** Selective Color resolves its packed
  triples once per render to the active slots
  only (slot order, chromatic/achromatic gate
  flags), and the loop inlines the HSL
  round-trip scalar (no allocations), reads
  range metadata from a static slot table (no
  `Map` lookups), folds hue distance without
  modulo, and evaluates each saturation gate
  once per pixel — ~1.8x at 1800px with
  byte-identical output. The plan derives from
  the packed bits, not rescaled from the
  recipe, so float32 rounding cannot disagree
  — and the public packed API stays over the
  same core so the two cannot drift. (R17-1)
- **Classify the gesture on release, never
  delay the feedback on press.** Immediate
  hold-to-compare fires on pointer down; the
  400 ms timer survives only as a click window
  (quick release clicks through to the split
  toggle, late release suppresses it). The
  protocol and injectable scheduler are
  unchanged — the value was repurposed, not
  removed. (R17-2; cf. R16-4)
- **Alternate gestures skip the primary press,
  never ride it.** Shift+click never enters the
  hold (no flash, release is a safe no-op) and
  non-primary buttons never peek; Shift+B gives
  keyboard parity before the plain-key map so
  it can never hit `compare`. (R17-2)
- **Conditional learning scopes the whole
  patch, and silence beats borrowing.** Each
  taste sample carries its photo's top ML
  label; three same-subject photos generalize
  their medians onto the next one (majority
  runs within the scope, so a 2-of-3 subject
  habit counts as a global minority), thin
  subjects fall back to the global medians —
  but a subject with evidence and no habit
  stays silent rather than borrowing the
  global style, which would reintroduce the
  exact leak scoping removes. Per-key backoff
  would mix two styles into one unexplainable
  patch. (R17-4; fulfills the R16-7 per-scene
  follow-up)
- **Similarity tags are model output, not
  user text.** Hand-added labels are
  organizational free text scoring 1, so they
  would always win — only `source: "ml"`
  labels group photos, and untagged photos
  (offline import, legacy records) learn and
  enhance globally, the pre-change behavior.
  Retags are real changes: labels can land
  after the edit, so a tag change on re-record
  moves the sample's scope and forces the
  write-through. (R17-4)
- **Versioned payloads migrate in place under
  the same storage key.** Bumping the key
  would orphan learned taste and churn the
  backfill; the payload version governs, old
  readers fail safe (garbage in, empty out),
  and the seed backfill tags samples from the
  new per-photo labels map. (R17-4)

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
- **Hand-verified release paths get fixture-tree tests after
  the fact.** The `version-packages` sync script was verified by
  hand in R9; R11-1 copies the real script into a temp fixture
  tree (four `package.json`s + a `branding.ts`) and runs it
  with `node` — the actual release script under test with zero
  test-only hooks. (R11-1)
- **Conversions ship a full-panel sweep.** One suite pins all
  seven header switches (each the sole header control),
  switch-free manual sections with resets on dirt, exact ML
  badge counts, hand-only keys lighting the toggle, source
  pins for every toggle branch, and source pins proving the
  old stack surface is gone. (R11-11)
- **Pin both sides of a semantic gate.** The faces-0 test pins
  the quiet header (plain button, `aria-pressed="false"`,
  run-ML tooltip, no reset) while the faces-1 test pins the
  highlight — neither side passes vacuously. (R11-8)
- **Audits pin the audited table.** The ML-vs-Auto suite pins
  heuristic→Auto / model-run→ML across menus, dialogs, and
  preset labels, so the next tool gets classified by a
  failing test. (R11-9)
- **Spline tests pin mathematical properties, not just
  outputs.** Monotonicity, no-overshoot, pinned extremes, the
  display bend against the pipeline bell, and display-path
  corners together prove the editor is WYSIWYG. (R11-5)
- **Shadow pins assert layer order and absence.** The
  keyline must be the topmost shadow layer, the old blur and
  faint ring must be gone, and the frame carries no
  border/radius of its own — via the `cssRule` pin, per the
  R1-4 SSR convention. (R11-3)
- **Docs-only changes still run the closest suite.** No new
  tests for the ML writeup, but the full core suite confirms
  the analyzed code is untouched and green. (R11-6)
- **Order pins assert adjacency on both sides, in both
  toggle states.** Presets-between-compare-and-info and
  remove-between-presets-and-info pin "directly between, no
  button in between" for Show and Hide presets alike —
  single-neighbor assertions would pass with a drifter on
  the other side. (R12-7, R12-8)
- **Structural pins prove the absence can't regress.**
  The shared header owns no reset by construction (props
  deleted, not just unused); no positional
  `toolbar-actions > .icon-button:nth-of-type` selector
  remains; the heading is remove-free; the filmstrip
  footer contains no browser button. (R12-2, R12-5,
  R12-7, R12-8)
- **Style guards parse values, not just literals.** The
  banding guard parses `box-shadow` layers and caps max
  blur at 24px and black alpha at `#0006`, so any future
  shadow retune trips it — the R3-7 relational-pin
  instinct applied to a gradient defect. (R12-1)
- **Undo/redo flows script through the pure step
  helper.** Six core cases drive write-once, no-rewrite-
  after-undo, no-write-on-redo, second-apply, restore-
  without-write, and null-reset through
  `nextDenoiseRecipeSync` — the App effect stays a thin
  wiring, per the R8-2 core-seam rule. (R12-11)
- **Sort helpers pin total order, not just examples.**
  Covered-before-plain with per-group names, empty-cover
  as plain, numeric names, id tiebreak, non-mutating
  input, and comparator consistency — plus an SSR row-
  order pin proving selection highlight survives the
  reorder. (R12-10)
- **New test seams match existing conventions.**
  `initialOpenMenu`/`initialAlbumMenu` mirror
  `initialDropTarget`/`initialContextMenu` — the next
  reader finds the pattern, not a one-off. (R12-9)
- **`expect.poll` does not retry a throwing callback**
  (verified in Playwright 1.64.0 `invokePollMatcher`:
  only matcher failures retry) — one tick with
  `window.__f8Test` unreachable (HMR reload window; the
  app never deletes the hook) failed the spec with an
  immediate `TypeError`, not a timeout. Every `__f8Test`
  poll now reads null-safely and treats missing-hook as
  "not yet" via pure core classifiers
  (`healWaitStarted`/`healWaitSettled`, 12-case truth
  table), while one-shot assertion reads stay strict so
  a dead page fails loudly instead of passing
  vacuously. (R13-1)
- **Injectable randomness keeps randomized picks
  deterministic under test.** `pickAlbumCover` takes
  `random: () => number` (default `Math.random`, clamped
  so out-of-range sources still land in the tier);
  `random: () => 0` without exclude reproduces the legacy
  winner — keep the legacy outcome reachable as one
  injected input so the change stays reviewable as "same
  ranking, randomized selection". (R13-6)
- **Pin event-handler ordering at source level.** The
  curves removal-before-capture order is pinned in the
  source-pin test so a future refactor cannot silently
  re-capture first and re-break both gestures — ordering
  assertions belong with the wiring pins. (R13-3)
- **Shadow guards assert shape absence, not just pinned
  values.** Beyond the exact layers, the suite rejects
  any `#ffffff` layer and any negative spread, so a
  future "richer shadow" cannot silently reintroduce the
  rigid ring or the oval halo; the banding guard
  tightened (max blur 24→18px). (R13-2; extends R12-1)
- **Effect-resident behavior pins via source, agreed
  behavior pins via both helpers.** App-effect wiring
  (preload effect + cleanup, unconditioned preview load,
  switch flush, on-demand original paint) follows the
  `focusMode.test.tsx` source-pin precedent — and when
  two handlers must land together, a core test ties the
  selection target to the strip focus target for the same
  key. (R14-1, R14-2)
- **Soft treatments pin the absence of the severe
  style.** The photo-view blurry hint asserts an outline
  border, no background fill, and none of the grid
  badge's `#7c4534` red — so a future "richer chip"
  cannot silently reintroduce the verdict look. (R14-3;
  cf. R13-2)
- **Standardization tests assert the old copy is
  gone.** Grid + photo views pin the "Blurry" text,
  warning icon, and confidence tooltip — and pin
  "Blurry · ML" / "Might be blurry" absent, with CSS
  rejecting red `#7c4534` and amber on both rules
  (extends the R14-3 absence-pin; the grid red it
  referenced no longer exists). (R15-2)
- **Pin every clearing site of a shared flag.** The
  preview branch must never clear `loading`, so the
  suite pins exactly two remaining `setLoading(false)`
  calls (decode-error path + `finishPaint`) — a third
  clearer fails loudly instead of reintroducing the
  stretch-snap. (R15-1)
- **Every new Inspector section re-enumerates six
  suites.** `collapsePanels` titles, switch counts
  in `adjustmentConsistency` / `autoMlToggle`,
  `singleResetIcon`'s fully-applied fixture,
  `mlSections`, `detailsToggle` — each panel bumps
  them (8→9→10→11 switches, 11→12→13 rows this
  run). Global absence pins (`>Clarity</label>`)
  must be re-scoped to their section slice when a
  sibling legitimately owns the same label.
  (R16-3, R16-5, R16-6)
- **Read the reference declaration from the
  stylesheet, don't hardcode it.** The blurry
  badge pins that its rule contains RAW's exact
  `color` declaration read live from CSS — a
  future RAW recolor fails loudly instead of
  drifting apart. (R16-2; cf. R15-2 absence-pins)
- **Removed UI gets absence pins in three
  layers.** No Add Adjustment markup, no source
  references, no orphaned CSS rules — deletion
  of `addAdjustmentLayout.test.tsx` came with
  its inverse in the new suite. (R16-6)
- **Inject the scheduler behind gesture timing.**
  The hold state machine takes its timer as a
  parameter, so tests drive the 400 ms delay,
  release suppression, and re-arm with no fake
  timers. (R16-4)
- **Targeting tests prove the untouched pixel is
  byte-identical.** Blue-only tweak leaves red
  pixels untouched; shadows-clarity bites only
  its checkerboard half; neutral renders are
  byte-identical — plus full-hue/luminance
  coverage so no input falls in a dead gap.
  (R16-3, R16-5)
- **Pinned literals resist reuse refactors.**
  `canReset` keeps its inline
  `!isDefaultEdit(editor.edit)` instead of
  reusing the new `hasEdits` — the toolbar test
  pins that literal expression as its contract.
  (R16-4)
- **Persistence helpers ship garbage-tolerant.**
  The taste profile's localStorage parse never
  throws (29-test suite incl. corrupt-payload
  cases), and seed-backfill + forget paths are
  covered behaviorally through static markup.
  (R16-7)
- **Fast paths pin bit-identical output
  against the reference, never approximate
  equality.** The differential sweep (~2.8k
  colors × 8 recipes, exact `toEqual`) caught
  a 1-ulp drift from "simplifying" the
  hue-distance modulo — the `+360` step rounds
  and does not round-trip — so the fast path
  replicates the exact rounding and any future
  drift fails loudly. Plus a plan-shape test
  (null while neutral, slot order, gate
  flags). (R17-1)
- **Closed menus get `initial*` test seams
  matching the Filmstrip precedent.**
  `initialMenuOpen`/`initialSubmenu` let the
  saved-presets suite assert real open-menu
  markup SSR can't otherwise reach — and the
  byte-identical `closeAction`, already pinned
  by the autoEnhance suite, stays untouched
  while the flyout resets through the existing
  dismiss paths. (R17-3)
- **Conditional behavior pins both scopes plus
  the no-borrow silence.** The taste suite
  grows 29→52: tagging, user-label ignore,
  retag moves, scope selection incl.
  majority-within-subject, tag round-trip, v1
  migration, sanitization, tagged backfill —
  and the UI pins the subject hint, the ready
  tooltip + `.menu-tip` rule, and App wiring.
  (R17-4)

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
  R9-1, R9-2, R9-3, R10-1, R10-2, R10-3, R12, R13-1, R13-5,
  R13-6, R14-1, R14-2 — and e2e resolves core from `dist` too, so a core
  build is needed before the next e2e run sees new exports.
  Conversely no rebuild is needed when touching only
  already-exported core constants (R14-3 reused
  `CULL_LABEL_BLURRY` with none) — the rule triggers on
  new exports.)
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
- **`yarn changeset` needs an interactive TTY for package
  selection.** In headless sessions, hand-write the changeset
  in the CLI's exact format instead — every R11 commit did,
  and R14-2 again. (R11, R14-2)
- **Never run `yarn version-packages` to verify.** It is a
  release action that would consume other tasks' pending
  changesets; it stays a maintainer step. (R11-1)
- **New capability is `minor`, fixes and docs-only are
  `patch`.** The Curves editor and the toggle conversion
  shipped minor; the writeup and label audits shipped patch.
  (R11-5, R11-6, R11-9, R11-11)
- **`apps/web/tsconfig.json` does not include `tests/`** —
  e2e edits need an ad-hoc strict `tsc --noEmit`
  (mirroring `tsconfig.base.json`: strict +
  `noUncheckedIndexedAccess` +
  `noUnusedLocals/Parameters`) over the changed
  spec/helper files, plus a scratch check of constructed
  `evaluate` strings against present/missing hook
  states. (R13-1)
- **Unscoped `grep -rn` over the repo hangs.** It descends
  into `apps/server/data` binaries — always scope greps
  with `--include` and explicit paths. (R14-2)
- **`yarn changeset` needs an interactive TTY — hand-write
  in its exact format.** Headless subagents write the
  `.changeset/*.md` file by hand (front-matter package
  bumps + summary); reviewers check the format matches
  what the CLI would emit. (R16-7, R16-8, R17-4)
- **Rebuild `dist/` before tests/typecheck, then leave it
  untracked.** `dist/` is gitignored but is what `@f8/*`
  imports (and the UI typecheck's `@f8/core` types)
  resolve to locally — stale dist reads as phantom
  failures ("your new API does not exist"); rebuilt
  output stays out of the commit. (R16-6, R16-8,
  R17-4)

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
- **Check whether the task is already built before building
  it.** R11-1's version task was fully implemented in R9-3 —
  verified intact (four workspaces at 0.1.0, `APP_VERSION`
  matches, sync no-ops) and extended only with the missing
  piece (sync-script tests) instead of a rework. The R8-1
  read-the-prior-doc rule, applied to the task itself. (R11-1)
- **Defer internal renames to the task that rewrites the
  surface.** `MlCategory`/`mlApplied`/`mlRevert` stayed known
  misnomers through the writeup and the audit, then died in
  the toggle conversion that removed their UI; the server
  wire value (`DustSpotsSource "ml"`) stays, because renaming
  churns the API for no user-visible gain. (R11-6, R11-9,
  R11-11; cf. R2-1)
- **Persisted-label follow-ups get flagged, not fixed.**
  Cull-assist's classical `Blurry · ML` / `Duplicate · ML`
  catalog badges are a migration-flavored change outside a
  tool-icon audit's scope — recorded in the writeup, left
  untouched. (R11-9)
- **Control-level changes document in `features.md` /
  `architecture.md`, not the README.** The README lists no
  per-section controls, and `readme.test.ts` pins its shape —
  the R7-5 one-question-per-file rule deciding the target.
  (R11-5, R11-11)
- **Analysis tasks conclude with explicit
  non-recommendations.** The ML writeup names what it rejects
  (server-side neural enhancement, unclamped model outputs)
  and frames the two real upgrades as standalone projects
  with model-license and offline questions — not drive-by
  edits. (R11-6)
- **Every task commit carries a changeset, even test-only
  and docs-only.** The task rule holds at `patch` with no
  user-visible effect; the `fixed` group moves all four
  workspaces together anyway. (R11-1, R11-6)
- **Deleting a control deletes its dead props.** The
  filmstrip's `onGrid` and the photo heading's `onRemove`
  went with their buttons — a surviving callback invites a
  second button to drift back in. Typecheck + full suite
  confirm nothing else referenced them. (R12-5, R12-8;
  cf. R5-7)
- **Removing one route keeps every other route.** The
  filmstrip button died while the G shortcut, the `grid`
  menu action, and the Photo Browser menu entry stayed —
  the task named only the button. (R12-5)
- **Named-scope siblings stay untouched.** Enhance Faces
  keeps its header/content pairing (only Subject &
  Background was named), View > Show Presets stays (only
  the toolbar icon moved), and no slider-drag re-enable
  or App behavior change rides along a pure layout move.
  (R12-4, R12-6, R12-7; cf. R8-2)
- **A "find/generate" ask gets an automatic pick plus its
  inverse.** One click regenerates the album cover from
  ranked signals — and Remove ships alongside so the
  no-thumbnail state (which the follow-up sort task
  needs) is reachable in the UI. Both album menus (sidebar
  row, grid header) get the items, and the pick runs over
  the full library, never the filtered grid. (R12-9)
- **Check the existing backend before building one.**
  PATCH `/api/albums/:id` with `cover`, the `albums.cover`
  column, and the sidebar's cropping `<img>` all existed —
  the thumbnail feature was client-only. The R2-8/R6-6
  instinct, applied to the server. (R12-9)
- **Sub-perceptual geometry stays out of scope.** Subpixel
  `frameWidth` softens the 1px keyline slightly, but
  full-pixel rounding would ripple through the lens/minimap
  math for an imperceptible gain at 8% white — recorded,
  untouched. (R12-1; cf. R4-3)
- **Relocations and bug fixes skip the README.** Pure
  control moves, single-button removals, and the undo
  fix needed no doc change — no behavior or architecture
  shift, per the R11-5 one-question-per-file rule.
  (R12-4–R12-8, R12-11)
- **When the task names a primary and a fallback and
  browser behavior can't be verified, ship both on one
  branch.** Right-click and Shift-click removal share one
  pointerdown condition (one `shiftKey` check plus test
  pins), guaranteeing a working gesture either way with
  no Playwright to decide between them. (R13-3)
- **Read the complaint's own clarification to pick the
  fix.** "Not horizontally centered — the count shows
  higher" points at the relative vertical offset (fixed
  with `baseline`), not bar-centering the title group,
  which would collide with the right-side Presets/sort
  actions. (R13-4)
- **Unreachable exit paths are dead code.** Focus mode's
  `back` case keeps its exact statement (dispatched only
  from the unmounted backlink; `photoBacklink.test.tsx`
  pins it) while `grid` gains an exit because the G
  shortcut stays reachable in the mode — verify
  reachability before adding, per the R2-8 rule.
  (R13-5)
- **Answer both halves of a "randomize but keep order"
  ask.** The thumbnail task's "still should have an
  order" became the exported `rankAlbumCoverCandidates`
  ranking the random tier is drawn from — the order is
  now explicit API, not just an internal sort. (R13-6)
- **Same shape, different hazard class stays out of
  scope.** Server-API polls share the throw-doesn't-
  retry shape but fail for API reasons, not a missing
  test hook — left alone and recorded, not swept into
  the hook-tolerance fix. (R13-1)
- **Rule out the network before optimizing the client.**
  Server HTTP caching was already correct (content-
  addressed `immutable` previews) and the per-photo ML
  hooks fire no network on photo change — so the
  arrowing fix stayed purely client-side. The R12-9
  check-the-backend instinct, applied to the wire.
  (R14-1)
- **Performance follow-ups get deferred with a note, not
  fixed.** Filmstrip item memoization and an in-memory
  LRU of final renders would help, but both add
  memory/complexity risk beyond a "bit of a lag" —
  recorded as future work in the writeup. (R14-1)
- **Relationship flags don't follow single-photo
  signals.** The photo view gained only the blurry hint:
  duplicate is a between-photos relationship that makes
  sense on the grid, not on a single open photo. The
  task named only the blurry fact. (R14-3)
- **Perf, shortcut, and one-pill tasks skip the
  README.** Faster arrowing, Home/End navigation, and
  the blurry hint needed no doc change — no new UI
  concepts or architecture, per the R11-5
  one-question-per-file rule. (R14-1–R14-3; cf.
  R12-4–R12-8, R12-11)
- **Scope the restyle to the named view.** The album
  Blurry pill changed; the photo-view hint (already
  matching its own RAW counterpart) and the
  duplicate pill sat out — the request named the
  album view only. (R16-2)
- **Entry points gated, exotic exits deferred.**
  Compare gates every entry (buttons, menu, B
  shortcut) plus the reset case, but undo-to-default
  doesn't auto-exit the split — recorded as out of
  scope, not half-fixed. (R16-4)
- **The task's exclusion list is exhaustive, not a
  starting point.** "Don't copy denoise or heal"
  left face/selective ML masks and enhance
  bookkeeping untouched on their own flows — no
  scope expansion by analogy. (R16-6)
- **Resilience UX behind an existing gate needs no
  README.** Offline detection adds no feature
  surface or architecture, so writeup + changeset
  carry it; the pre-existing ~500ms-edit-loss
  window is recorded as a known limitation with
  its follow-up (queued-while-offline replay),
  not fixed. (R16-8)
- **Learning taste is worth it, with honest
  bounds.** Photographers re-apply a house look
  photo after photo; medians over 3+ photos
  reproduce it in one click, track drift
  automatically, and stay silent without
  evidence — no preset authoring, no neural net
  (dozens of photos × seventeen numbers never
  justifies one). Bounds: global taste only
  (warm-portraits/cool-landscapes needs the
  per-scene follow-up), noisy with few photos,
  mirrors habits rather than judging them.
  Full analysis in `58-ml-taste-enhance.md`.
  (R16-7)
- **Benchmark the hot path before optimizing
  it.** The slider-lag fix started by timing
  `renderAdjustedPixels` (neutral 43 ms,
  selective 1-range 334 ms): per-pixel
  allocation, `Map` lookups, modulo hue
  distance, an eleven-slot scan, and a gate
  evaluation per range — each named waste
  became one line of the fix, and scratch
  benchmarks (kept out of the repo) proved
  the ~1.8x. (R17-1)
- **Fix the sibling sharing the defect.**
  Selective Clarity chips had the same
  double-circle structure as the Selective
  Color swatches — leaving them double-ringed
  while fixing their sibling would be
  inconsistent. The R1-5 audit-all-consumers
  instinct, applied to a visual defect.
  (R17-1)
- **Architectural follow-ups get recorded with
  their hook, not attempted.** Full drag-jank
  removal needs rAF coalescing or
  reduced-res-while-dragging plus visual
  verification — out of scope here, but the
  writeup names the existing seam
  (`RangeControl.onDraggingChange`) so the
  follow-up starts concrete. Same for the
  ... menu's missing arrow-key navigation
  (a menu-wide change). (R17-1, R17-3)
- **When the fallback turns out easy, ship
  both.** Immediate hold was the ask and
  Shift+click the fallback; classifying on
  release made the hold trivial, and the pin
  covers deliberate whole-picture compare
  with zero hold ambiguity — plus Shift+B
  parity for free. Record why both, not just
  what. (R17-2)
- **New gestures and small menu wiring land
  in `features.md`, not the README.** Hold
  timing and a submenu change no architecture
  — the R11-5 one-question-per-file rule
  deciding the target. (R17-2, R17-3)
- **Similarity choices ship their rejected
  candidates.** Subject = top ML label won
  over scene (too coarse), pHash (near-dups
  only), and embeddings (client clustering
  for dozens of photos): already computed
  server-side, synced, offline-capable, and
  user-visible in the label chips. Label
  granularity stays the vocabulary's —
  embedding clustering is the recorded
  escape hatch. (R17-4)
- **New subjects wait for the same evidence
  bar.** Three same-subject edits before
  scoping kicks in — the original global
  gate, deliberately unchanged — and weak top
  tags still group, because trusting stored
  tags keeps grouping identical to the
  visible chips. (R17-4)

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

## Per-task index, R11 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `ea6aaef` | `01-version-top-right.md` | Top-right version pinned to changesets sync with script tests |
| 2 | `4756a59` | `22-zoom-parent-clears.md` | Zoom in View parent click clears the preview |
| 3 | `5032c3b` | `23-photo-frame-shadow.md` | Photo frame shadow becomes a subtle keyline lift |
| 4 | `7e18b04` | `24-heal-overlay-delete.md` | Orphaned heal overlays purged once, not per slider tick |
| 5 | `3ab8494` | `25-curves-reset-points.md` | Curves header reset + addable tone-curve points |
| 6 | `ab08f7a` | `26-ml-white-balance-lightness.md` | ML prospects writeup for White Balance and Lightness |
| 7 | `e6deb8b` | `27-subject-background-icons.md` | Avatar/picture icons for Subject/Background subgroups |
| 8 | `5a4ec31` | `28-enhance-faces-no-faces.md` | Enhance Faces header quiet on no-face scans |
| 9 | `5fdb64a` | `29-ml-auto-icon-audit.md` | Scene Enhance + Dust Spots demoted to Auto; S&B keeps ML |
| 10 | `6f4b990` | `30-global-auto-highlight.md` | Global Auto lights the per-section Autos it drove |
| 11 | `c18753e` | `31-auto-ml-toggle.md` | Color Adjustments Auto/ML buttons become header toggles |

## Per-task index, R12 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `71a7739` | `32-photo-frame-banding.md` | Ambient shadow softened to kill banding + halo silhouette |
| 2 | `d7a98b4` | `33-curves-effects-details-toggles.md` | Curves/Details/Effects/B&W get header toggles; section reset retired |
| 3 | `5be7f5a` | `34-curves-double-click-remove.md` | Curves points remove on double-click, not right-click |
| 4 | `bb8af84` | `35-subject-background-single-toggle.md` | Subject & Background keep one bypassing header toggle |
| 5 | `9aee3d7` | `36-filmstrip-browser-button.md` | Filmstrip photo-browser button + dead `onGrid` removed |
| 6 | `2fb730b` | `37-focus-mode-view-menu.md` | Focus Mode opens View in its own section; Window menu dropped |
| 7 | `47010ba` | `38-presets-toggle-order.md` | Presets toggle sits between compare and info; reset hides by class |
| 8 | `5bce8c5` | `39-toolbar-remove-action.md` | Delete moves from photo heading to left of info |
| 9 | `a5610e8` | `40-album-thumbnail.md` | Album (...) menus gain Generate/Remove thumbnail |
| 10 | `063a0e6` | `41-album-sidebar-sort.md` | Sidebar albums sort covered-first, then by name |
| 11 | `55f3f4b` | `42-undo-denoise-immediate.md` | Undo of Denoise clears the recipe via sync-once-per-base |

## Per-task index, R13 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `b282d2c` | `43-playwright-heal-brush.md` | Heal e2e waits tolerate a transiently missing test hook |
| 2 | `24afa04` | `44-canvas-shadow.md` | Canvas shadow becomes a plain two-layer drop (keyline + halo removed) |
| 3 | `e80487d` | `45-curve-point-remove.md` | Curves points remove on Shift-click/right-click at pointerdown |
| 4 | `7daaea8` | `46-filmstrip-heading-centering.md` | Filmstrip name + count share one baseline |
| 5 | `2b81dfe` | `47-focus-mode.md` | Focus mode keeps only the photo and the filmstrip |
| 6 | `dd1ea05` | `48-album-thumbnail-random.md` | Generate thumbnail randomizes within the most interesting tier |

## Per-task index, R14 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `bb49961` | `49-fast-album-arrowing.md` | Neighbor preload + preview flush + on-demand Compare layer |
| 2 | `b15c96c` | `50-home-end-photo-navigation.md` | Home/End jump to first/last photo (editor-only) |
| 3 | `aab306a` | `51-photo-view-blurry-hint.md` | Soft "Might be blurry" hint pill in the photo heading |

## Per-task index, R15 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `bcbb00b` | `01-stretched-photo-loading.md` | Preview holds loading; spinner gates on !previewUrl; preview cover |
| 2 | `1459bd0` | `02-blurry-badge-standard.md` | Shared neutral BlurryBadge both views; source-branched tooltip |

## Per-task index, R16 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `967a1c9` | `52-stale-canvas-stretch.md` | Instant-hide stale canvases on switch; wipe original backing store |
| 2 | `fac4690` | `53-blurry-badge-raw-match.md` | Blurry pill matches RAW; "Flagged as blurry" copy |
| 3 | `5ede446` | `54-selective-color.md` | Selective Color: 11 ranges × Hue/Saturation/Luminance |
| 4 | `43084b2` | `55-compare-hold.md` | Hold Compare to peek original; disabled with no edits |
| 5 | `e69eb2c` | `56-selective-clarity.md` | Selective Clarity: 3 tonal ranges × Texture/Clarity |
| 6 | `5bbc559` | `57-presets-submenu.md` | Add Adjustment removed; Image > Presets submenu; presets basic-only |
| 7 | `ae2c43a` | `58-ml-taste-enhance.md` | On-the-fly taste profile + ML Auto Enhance menu action |
| 8 | `d12ece7` | `59-offline-recovery.md` | Ping-verified offline takeover + auto-reload; photo Try again dropped |

## Per-task index, R17 (writeups in `docs/tasks/`)

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
| 1 | `5025630` | `01-selective-color-slider-lag-and-swatch-ring.md` | Per-render plan cuts Selective Color ~1.8x; single tight swatch ring |
| 2 | `6515202` | `02-compare-original.md` | Immediate hold-to-compare + Shift+click/Shift+B whole-original pin |
| 3 | `f044997` | `03-saved-presets-submenu.md` | Saved presets surface in the ... menu's Saved Presets submenu |
| 4 | `44ae534` | `04-ml-enhance-conditional.md` | ML Auto Enhance learns per subject tag, not one global style |
