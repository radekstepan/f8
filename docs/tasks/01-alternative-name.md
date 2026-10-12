# Task 01 — Alternative name + accurate Help → About

## Decision

**Adopted name: Safelight.** User-visible strings (About dialog, app menu,
Help menu, menu-bar indicator, page title/meta) now use it. Internal
identifiers (`@photomator/*` packages, `photomator-demo-*` storage keys,
`~/Pictures/Photomator`) are deliberately unchanged for compatibility.

## Naming shortlist

Criteria: no collision with an existing photo editor, darkroom/local-first
resonance, short, spellable.

| # | Name | Rationale | Verdict |
|---|------|-----------|---------|
| 1 | **Safelight** | The red darkroom lamp under which prints are handled safely; evokes safe, local, non-destructive editing. Single word, memorable. | **Picked** |
| 2 | Fixer | The chemical that makes the image permanent; short and confident. Slightly generic as a common noun. | Runner-up |
| 3 | Lightproof | A darkroom must be lightproof; doubles as a privacy promise (everything stays on-device). A touch long. | Runner-up |
| 4 | Enlarger | The darkroom projector that turns negatives into prints; fits develop-and-export. Less obvious to non-film users. | Considered |
| 5 | Contact Sheet | The overview grid photographers review; fits the photo browser. Two words, weaker as an app menu name. | Considered |
| 6 | Stop Bath | The step that halts development — "your originals stop here, safe". Quirky; obscure outside film circles. | Considered |
| 7 | Redlamp | Compound form of the safelight idea; brandable, but reads as a typo of "red lamp". | Rejected |
| 8 | Silver Halide | The light-sensitive film chemistry; distinctive but long and hard to type from memory. | Rejected |

Names such as Darkroom, Lightbox, and Developer were excluded up front
(existing apps / confusing double meanings). Trademark clearance was not
checked — treat the pick as a working title pending a proper search.

## What was inaccurate in Help → About

Old copy (in `packages/ui/src/components/EditorDialogs.tsx`):

1. Called the product **Photomator** — the name of a real third-party app.
2. "All processing happens in your browser" — false: RAW decoding, the
   SQLite catalog, and Best-tier ML repair run in the local server
   (`apps/server`, LibRaw via `dcraw_emu`, ONNX on server CPU).
3. "RAW development, AI processing, and machine-learning models are not
   included" — false: full-res RAW import and tiered on-device ML Heal
   (LaMa/Moebius, cached weights) are core features.
4. Extension paths (`editor/data.ts`, `editor/image.ts`, `components/`) did
   not exist in this monorepo.
5. Menu labels "About this demo" / "About the Kitchen Sink" and the
   `KITCHEN SINK v1.0` indicator carried the retired demo brand plus a
   version (1.0) that matches no package version (0.0.0).

## Changes

- `packages/core/src/branding.ts` (new): `APP_NAME`, `APP_EDITION`,
  `APP_TAGLINE`, `APP_DESCRIPTION`, `EXTENSION_POINTS` (real
  `packages/...` paths), `ABOUT_DISCLAIMER` (non-affiliation + local-first
  facts: on-computer library, untouched originals, local RAW develop,
  on-device repair models, histogram-based auto adjustments).
- `packages/core/src/index.ts`: export the branding module.
- `packages/ui/src/components/EditorDialogs.tsx`: About dialog renders from
  branding constants; title is now "About Safelight".
- `packages/ui/src/components/Topbar.tsx`: app menu renamed to Safelight,
  both About items read "About Safelight", indicator reads
  `LOCAL-FIRST EDITION` (fake `v1.0` dropped).
- `apps/web/index.html`: title → "Safelight — Your Personal Darkroom";
  meta description no longer says "Photomator-inspired".
- `packages/core/src/branding.test.ts` (new): 5 Vitest tests locking the
  name, the non-affiliation disclaimer, the accuracy claims, the real
  extension paths, and the absence of retired demo labels.

## Verification

- `yarn workspace @photomator/core build` — pass (rebuilds `dist`, ignored).
- `yarn workspace @photomator/core test` — **426/426 pass** (20 files,
  incl. 5 new branding tests).
- `yarn workspace @photomator/ui typecheck` — pass, no output.
- `yarn workspace @photomator/web typecheck` — pass, no output.
- Server tests untouched (no server files changed); UI package has no test
  runner, so copy is covered via the core branding module. Manual check:
  `yarn dev`, open app menu → About Safelight and Help → About Safelight.

## Unresolved / follow-ups

- Trademark/domain search for "Safelight" not performed.
- README, `docs/plans`, package names, storage keys, and
  `~/Pictures/Photomator` still use the old name intentionally (compat;
  rename separately if desired). The `.demo-version` CSS rule is now unused
  but harmless.
- Changes left uncommitted per instructions.
