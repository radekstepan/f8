# Learnings from tasks.md (Tasks 1–16)

Distilled from the per-task writeups in `docs/tasks/` and the subagent
learnings. Read this before touching the inspector UI so we don't repeat
the same mistakes.

## 1. Styling conventions (hard rules)

- **Gold is for links/actions ONLY.** Status text, badges, and focus
  indicators must use label grey (`#bdbdc7`), white, or another neutral —
  never action gold. (Tasks 1, 2, 6, 9, 13)
- **Check token reuse before deleting a style.** Confirm the old tokens
  have zero other consumers and that the replacement palette is already
  shared (e.g. `.slim-button.is-active`, `.ml-badge`) — that confirms
  the unification direction. (Tasks 1, 5, 13)
- **Equal-specificity source order matters.** A later `.is-active` rule
  already beats `:hover`; deleting an active-hover override can be a
  no-op rather than a regression — but verify, don't assume. (Task 1)
- **A `flex: none` / override guard is useless if a broader selector
  beats it on specificity.** Verify overrides win instead of just
  adding them. (Task 5)
- **First-child/nth-child CSS selectors are markup-order landmines.**
  Adding or removing a sibling silently changes which element matches.
  Avoid them for styling; prefer explicit classes. (Task 5)
- **Retiring a CSS state means deleting both the hidden base and its
  reveal rule.** Leaving either invites resurrection. (Task 10)
- **When every instance shares one component, the anomaly is in the
  cascade around it, not the component** — diff the ancestors, not the
  control. (Task 5)
- **Audit shared renderers, not just call sites.** Bare controls hiding
  inside shared components (e.g. `MlProgressView`) are the classic
  alignment-breaker. (Task 15)

## 2. Component contracts (`AdjustmentSection` and headers)

- **`dirty` must mirror exactly the keys its own reset restores**,
  otherwise the reset gets stuck on. Pin this invariant at source
  level (see §4) since markup can't observe closures. (Tasks 3, 4, 12)
- **Gate reset visibility on semantic state, not the handler.**
  `onReset` presence can't mean "show" when reset-to-defaults
  sections (always valid) and snapshot sections (omit-when-clean)
  share one component. (Tasks 3, 10)
- **Revert/reset keys off snapshot presence, not mode presence.**
  Seeding a highlight without its snapshot creates a dishonest
  revert affordance. (Task 7)
- **The header ML control is toggle-shaped** ("revert when
  highlighted, otherwise apply fresh"). Converging a momentary action
  onto it forces a real UX decision: make it a true toggle with an
  honest tooltip, or set `applied: false` so every click is honestly
  a fresh run (the Face Enhance pattern for ephemeral assists).
  (Tasks 4, 14)
- **A toggle that can't un-apply must degrade to re-apply**, never to
  clearing labels while keeping values. (Task 7)
- **Generic-optional beats section-specific in shared components.**
  Optional `disabled`/`title` fields on `AdjustmentMl` kept every
  existing consumer's markup byte-identical and paid off immediately
  for later convergences. (Tasks 4, 14)
- **Converge to the existing sibling shape exactly** (e.g. Curves/
  Effects `initiallyOpen`) rather than inventing a third variant.
  (Task 11)

## 3. State, persistence, and async

- **Session-only UI state vs persisted recipe flags is the recurring
  reload-bug shape.** Derive applied-state from the recipe (face/
  selective/denoise do); anything initialized empty and never seeded
  will look idle after reload. (Task 7)
- **When UI feedback is gated on a server round-trip, any server
  saturation reads as "click does nothing."** Verify the button
  fires first, then trace where state actually updates. (Task 16)
- **Optimistic updates need a consistency story for concurrent
  full-record upserts, not just rollback** — a repair saveEdit PUT
  would have wiped a naive optimistic star. (Task 16)
- **Out-of-order async settles need sequence numbers** once users can
  act faster than the server responds (rapid toggles during a slow
  PATCH). Settle only the latest PATCH authoritatively; drop stale
  responses. (Task 16)
- **Legacy-disabled recipes are the perennial edge case for Details
  changes.** Values-alone dirtiness (flag flips back on first drag)
  is the settled convention — pin it explicitly in each new test
  file rather than assuming it. (Task 12)

## 4. Testing practices (repo-specific)

- **Server-rendered tests pin markup contracts, not click-derived
  states.** Toggle-off paths, slider-0 disabled states, and other
  interaction-only states must be pinned at the CSS-rule level (via
  the `cssRule(selector)` helper) with an explicit comment — or
  wait for a jsdom/e2e pass. (Tasks 4, 9, 13)
- **The `cssRule(selector)` helper anchors on `selector\s*{`.**
  Never write combined selectors (`.a, .b`) — they break the
  lookup. Duplicated rule bodies are the convention here. (Task 1)
- **Absence assertions must target a stable identifier
  (`aria-label`)**, not the absence of a modifier class, which
  passes trivially once markup is gone. (Task 10)
- **Pin class+label pairings in one assertion** to catch
  per-section crosstalk that separate assertions miss. (Task 3)
- **Bound section-scoped assertions between known headings**
  (`<h3>Denoise</h3>`…`<h3>White Balance</h3>`) so later sections
  gaining similar classes don't cause false failures. For "last
  section" slices, anchor on structural tags (`lastIndexOf('<section')`),
  never fixed-width lookbacks — long inline SVGs break them. Global
  token counts are weaker; heading-bounded slices keep assertions
  scoped. (Tasks 8, 9, 10, 11)
- **Exact per-render label counts guard against vacuous passes**
  and surface un-audited instances. (Task 15)
- **Static markup can't observe `onChange` closures.** The
  source-read precedent (`collapsePanels.test.tsx`,
  `detailsToggle.test.tsx`) is the honest way to pin wiring that
  survives a markup change. (Tasks 11, 12)
- **SSR probes can pin hook state-initializer paths without
  jsdom**; the async effect path then shares the same tested
  helper. (Task 7)
- **Absence-pinning tests act as executable TODOs**: earlier
  `not.toContain(...)` pins fail loudly the moment the feature
  lands, making the update checklist self-evident. (Task 12)
- **Prefer framework-free logic in core with node-runnable unit
  tests** over untestable hook internals when a package has no
  DOM/effects harness. (Task 16)
- **Collapsed sections render the reset but hide the ML button**
  (`ml && open`) — collapsed-with-icon is the sharpest case for
  single-icon pins. (Task 8)

## 5. Tooling gotchas

- `muse.search` defaults to **literal** matching — alternations
  like `a|b` silently return nothing unless `mode: "regex"` is
  passed. (Task 2)
- **Vitest file filters are workspace-relative**
  (`src/components/...`), not repo-root-relative; root-relative
  filters exit 1 with "No test files found". (Task 2)
- **Vitest doesn't typecheck.** Always run the typecheck gate on
  new/changed test files — passing tests can hide fixture type
  errors only `tsc` catches. (Tasks 8, 12)
- **`@f8/web` resolves `@f8/ui` (and core) from `dist`.** Rebuild
  the dependency's dist before running the web typecheck, or it
  validates stale output. (Tasks 7, 8, 12, 16)
- **Commit by explicit paths, never `git add -A`.** Stray files
  (e.g. `.DS_Store` under `docs/`) get swept in otherwise.
  (Tasks 1–16)
- **No CI, no configured linter** — both packages' `lint` scripts
  are no-op echoes. No Playwright for these tasks by instruction;
  unit/integration tests only. (Tasks 9, 13)
- `html.split('<section…')` chunks are already bounded by the next
  delimiter — only the last chunk needs an explicit bound. Verify
  chunk-boundary assumptions empirically before asserting. (Task 8)

## 6. Deletion and scope discipline

- **Deleting a rule/component requires an exhaustive usage grep
  first.** Proving a selector could only ever match the bug itself
  (or has zero remaining usages) is what makes deletion safe.
  (Tasks 5, 13)
- **A control duplicating another control's state is safe to delete
  only after proving no hidden semantics** — git history (e.g. the
  bypass→visibility conversion) can be that proof. Record it in the
  writeup so nobody re-litigates. (Task 11)
- **Record scope boundaries in the writeup.** Neighboring tasks own
  neighboring contracts (e.g. Task 9 → Task 13 handoff list,
  straighten's gold revert, B&W's toggle-duplicate, modal Cancel
  chrome, toast notifications). Don't churn a settled contract
  owned by another task — leave it alone and document why.
  (Tasks 6, 8, 9, 13, 15)
- **Suffix removal and de-golding (or any two separable concerns)
  are separable decisions.** A face hit keeps its `· ML` engine
  tag for provenance while inheriting the non-gold span color.
  (Task 6)
- **Sequencing uniformity work into its own task keeps later tasks
  trivial.** Once Details converged to the plain-section shape,
  adding its reset was a single line plus test updates. (Task 12)
- **Out-of-scope findings still get recorded.** The straighten
  warmup cancel reusing the "Cancel repair" label is a label bug
  for a future task — noted in the Task 15 writeup, not fixed
  there. (Task 15)
- **Keep both spellings greppable** when display convention
  differs from plain text: `Before · 16×` captions with ASCII
  `16x` retained in aria-labels. (Task 2)
- **Reuse removed copy verbatim as tooltips** when converging
  controls — preserves honest framing at zero copy cost. (Task 14)

## Per-task index

| # | Commit | Writeup | One-line summary |
|---|--------|---------|------------------|
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
