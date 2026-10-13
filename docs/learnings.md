# Learnings

Distilled from per-task writeups and subagent learnings across two
`tasks.md` runs. Read this before touching the inspector, repair,
toolbar, or library UI so we don't repeat the same mistakes.

- **R1** = first run (16 tasks). Its `docs/tasks/` writeups were removed
  during the task reset; the index below is preserved for archaeology.
- **R2** = second run, 2026-10-13 (12 tasks). Writeups live in
  `docs/tasks/01–12`.

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
  wrong, or the next reader will "fix" it back. (R2-1)
- **Keep old testids through relocations** — same testid + tooltip
  strings collapse most churn to class-name updates. (R2-2)
- **`noUncheckedIndexedAccess` is on**: regex `match[1]` in tests needs
  `?? ''` to avoid a typecheck round-trip. (R2-9)
- **"Don't run Playwright" ≠ "don't update Playwright specs."** Grep
  e2e for the changed UI and update stale expectations in the same
  commit, or the next e2e run fails on an intended change. (R2-3)

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
  export is a stale-build signal, not a real problem.
  (R1-7, R1-8, R1-12, R1-16, R2-4, R2-11, R2-12)
- **Commit by explicit paths, never `git add -A`.** Stray files
  (e.g. `.DS_Store` under `docs/`) get swept in otherwise. (R1)
- **No CI, no configured linter** — both packages' `lint` scripts
  are no-op echoes. No Playwright for these tasks by instruction;
  unit/integration tests only; tests + typecheck are the only gates.
  (R1-9, R1-13, R2-4)

## 7. Scope and ambiguity discipline

- **Deleting a rule/component requires an exhaustive usage grep
  first.** Proving a selector could only ever match the bug itself
  (or has zero remaining usages) is what makes deletion safe. One
  stray-visual report means auditing all consumers of the shared
  logic — the same tick root cause covered four sliders, and fixing
  only the reported one would have re-filed the bug twice.
  (R1-5, R1-13, R2-5)
- **Icon reuse audit before picking a glyph.** The obvious `Palette`
  pick was already taken by Hue & Saturation; `SwatchBook` had zero
  uses. And change the color-related surface, not the generic chrome.
  (R2-6)
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

## Per-task index, R2 (writeups in `docs/tasks/`)

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
