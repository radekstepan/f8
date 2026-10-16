---
'@f8/core': minor
'@f8/ui': minor
'@f8/web': minor
---

The Adjustments ... menu gained ML Auto Enhance: the app learns your taste from the photos you edit — no train step, every saved edit teaches it on the fly — and once three edited photos show a consistent habit, ML Auto Enhance applies your per-adjustment medians as a whole-photo enhance with the usual revert. Untouched auto output is never learned from, and the profile lives only in the browser.

## Task writeup (docs/tasks/61-ml-taste-enhance.md)

## Request

"Is it possible to learn from the adjustments I've made, have a "train"
action somewhere or just do it on the fly and in Adjustments in the ...
menu have an ML Auto Enhance action? Writeup if there is any benefit to
this."

## What changed

There is now an ML Auto Enhance action in the Color Adjustments `...`
menu, backed by a personal taste profile that learns on the fly — no
train step:

- `packages/core/src/tasteProfile.ts` (new): the profile model. Each
  edited photo contributes one sample (its non-default values across the
  seventeen numeric look sliders, keyed by photo id so re-saving replaces
  rather than double-counts). A key joins the enhance patch only with a
  consistent habit: touched on at least half of the edited photos
  (minimum two), with at least three edited photos overall
  (`MIN_TASTE_PHOTOS = 3`); the applied value is the median, snapped to
  the slider step and clamped to its range. Pure auto output (any enhance
  entry still flagged pure) is skipped via `isPureAutoStack`, so the
  profile can only learn recipes a human shaped. Includes the
  never-throws localStorage parse/serialize pair and
  `tasteProfileFromSeed` for the first-run bootstrap.
- `packages/ui/src/hooks/useTasteProfile.ts` (new): the hook. Loads the
  profile from localStorage, backfills once from the library seed when
  nothing is stored, exposes `record`/`forget` with write-through, and
  derives `summary`/`patch`/`ready`.
- `packages/ui/src/hooks/useEditor.ts`: new `autoEnhanceTaste` method —
  the third mode of the shared enhance slot (`EnhanceMode` gains
  `"taste"`, preserved by the stack sanitizer). Synchronous (no pixel
  analysis — the patch is the caller's medians), over the factory-default
  base, with the full stack contract: pure-taste toggles back, other
  modes apply fresh keeping the earliest snapshot, in-flight async
  enhances are invalidated.
- `packages/ui/src/components/Inspector.tsx`: the `...` menu lists ML
  Auto Enhance second (adjust tool only, offered only). Until the profile
  is ready the item is disabled with the reason in a tooltip ("N of 3
  edited photos", or "no consistent habit yet"); the tooltip rides a
  block wrapper span because mouse events pass through disabled buttons
  (new `.menu-disabled-tip` CSS rule). An applied taste enhance surfaces
  through the shared header revert icon — same icon and label as classic,
  so the single-reset pin holds.
- `apps/web/src/App.tsx`: the debounced persist now also records the
  settled recipe (`persistEdit` wraps `library.saveEdit` +
  `taste.record`), removed photos are forgotten, and the Inspector gets
  `onAutoTaste`/`tasteReady`/`tastePhotos`.
- Docs: `docs/features.md` (Adjust bullet + Boundaries note),
  `docs/architecture.md` (key-files row + the browser-local persistence
  exception), `README.md` (one Adjust line). Changeset is `minor` for
  `@f8/core` + `@f8/ui` + `@f8/web`, hand-written in the CLI's exact
  format (`yarn changeset` needs an interactive TTY).

## Decisions

- **On-the-fly learning, no train action.** Settled recipes (the
  debounced persist, not keystrokes) teach the profile, and the library
  seed backfills existing edits on first run — both were cheaper and more
  invisible than a train button the user must remember to press, and the
  task allowed either. A manual "relearn" action is the natural follow-up
  if the profile ever drifts from the library (e.g. multi-device edits).
- **Medians, not means and not a neural net.** A median over a handful of
  photos resists the one experimental edit that would drag a mean, stays
  explainable ("your typical contrast is +18"), and needs no weights,
  training data, or server. Calling a per-key median "ML" is honest in
  the statistical-learning sense and is labeled as such in the Boundaries
  note; there is deliberately no `MlBadge` on the item (the name already
  says ML, and the badge marks tools where a model runs).
- **Majority-touched keys only.** A key the user set on one photo out of
  ten is not taste — requiring half the photos (min two) keeps rare
  one-off edits out of every future enhance.
- **Pure auto output never records.** Without this the profile would
  learn the app's own suggestions back from untouched Auto Enhance runs
  and converge on itself. The enhance stack's pure flag is exactly the
  human-signal detector, including for taste itself (running ML Auto
  Enhance and saving without tweaking teaches nothing).
- **Default base, not Natural.** Taste medians are absolute values
  learned from default-based recipes; layering them over `INITIAL_EDIT`
  would double-apply warmth/contrast the user never chose.
- **Browser-local profile.** Per-device localStorage keeps a personal
  model out of the shared server catalog and offline-friendly; the cost
  (no sync across devices) is documented.
- **Only the seventeen numeric look sliders are learned.** Geometry,
  retouching, and denoise are per-photo by nature; presets labels,
  enabled flags, tone-curve anchors, Selective Color/Clarity entries,
  and the ML look states are structured/boolean state a median cannot
  represent. Black & White is the most-missed exclusion and the obvious
  next key (as a frequency rule, not a median).

## Benefit analysis: is learning from adjustments worth it?

Yes, with honest bounds. Photographers are habitual: most develop a
house look (a little extra contrast, warmer whites, lifted shadows) and
re-apply it photo after photo. Today that costs a preset the user must
build, name, find, and maintain — and presets are all-or-nothing
snapshots that go stale as taste drifts. A learned profile removes the
authoring step entirely: after three edited photos the app can already
reproduce the user's typical look in one click, it tracks drift
automatically (samples are replaced, never accumulated), and the
per-key majority rule means it only asserts habits with evidence while
staying silent otherwise.

The bounds matter. This learns *global* taste, not *conditional* taste:
it cannot know you warm portraits but cool landscapes, and with few
photos the medians are noisy (hence the 3-photo gate and the majority
rule). It also learns from final recipes regardless of provenance, so a
user who applies Vivid to everything teaches "Vivid" — correct as taste,
but it means the profile mirrors habits rather than judging them. The
natural next steps, in value order: per-scene profiles (the scene
classifier already exists — learn one median set per scene), then
deviation learning (record how the user tweaks *after* Auto Enhance, so
the profile personalizes the pixel-aware auto instead of replacing it),
then Black & White frequency. None of them needs a neural network
either — the dataset (dozens of photos, seventeen numbers each) will
never justify one, and the median approach stays debuggable forever.

## Verification

- New suites: core `tasteProfile` (29 tests: sampling, pure-auto skip,
  record/replace/drop/forget, thresholds, median robustness, snapping,
  patch gating, persistence round-trip + garbage tolerance, seed
  backfill), UI `useTasteProfile` (9 tests: load/corrupt/record-skip/
  drop/forget behaviorally through static markup, backfill + App persist
  wiring source-pinned), UI `tasteEnhance` (7 tests: menu order/state/
  hints, shared revert, adjust-only, editor + App wiring pins).
- `yarn test`: core 1148, server 181, UI 669 — all pass.
  `yarn typecheck`, `yarn lint`, `yarn build` green. No Playwright, per
  the task rules.
