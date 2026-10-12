# Task 01 — Rename the app to f/8

## What changed

User-visible name is now **f/8** (`APP_NAME` in `packages/core/src/branding.ts`);
identifier-safe contexts use **f8**. No user-visible string names Photomator
(or the interim name Safelight) anymore.

- Branding: `APP_NAME` `"Safelight"` → `"f/8"`; About-dialog disclaimer drops
  the "makers of Photomator" clause (keeps the Apple/Pixelmator non-affiliation
  note). Menus, About dialog, and Topbar pick the name up automatically.
- Page shell: `apps/web/index.html` title → "f/8 — Your Personal Darkroom",
  meta description updated.
- Packages: `@photomator/*` → `@f8/*` (core, ui, server, web), root package
  `photomator` → `f8`; all imports and `yarn workspace` references updated;
  `yarn.lock` regenerated via `yarn install`.
- Env vars: `F8_*` is primary everywhere (`F8_DATA`, `F8_LIBRARY`, `F8_ROOTS`,
  `F8_HOST`, `F8_PORT`, `F8_API`, `F8_ML_*`, `F8_STRAIGHTEN_ML_*`); every
  pre-rename `PHOTOMATOR_*` name stays as a fallback alias.
- Server paths: catalog `f8.db`, uploads `~/Pictures/f8`, startup log
  "f/8 library: …".
- Browser storage: tool prefs `f8.tool-prefs-v1`, grid scroll
  `f8-grid-scroll:`, preview-cache IndexedDB `f8-preview-cache`, ML weights
  cache `f8-ml-heal-v1`, e2e hook `window.__f8Test`.
- Tests/fixtures: `f8-test-*` tmp prefixes, `f8.db` fixture catalog.
- Docs: README rebranded (title, env table, paths, Project Map, workspace
  commands) with a compat-shim note; this writeup added.

## Decisions

- **f/8 vs f8 rule:** display copy (menus, dialogs, title, logs, README prose)
  uses `f/8`; anything a slash would break (npm scopes, env vars, file names,
  storage keys, JS identifiers) uses `f8`.
- **Compat shims kept (data-loss prevention only):**
  - `PHOTOMATOR_*` env aliases — existing scripts/docker setups keep working.
  - `photomator.db` fallback — served when `f8.db` is absent, so an upgrade
    never starts with an empty library.
  - `~/Pictures/Photomator` fallback — used when `~/Pictures/f8` is absent.
  - `photomator-demo-*-v1` localStorage keys — still read once by the
    one-shot server migration, then cleared.
  - `photomator.tool-prefs-v2` — read once as a fallback, migrated to the new
    key on next write (`readToolPrefsRaw`/`writeToolPrefsRaw`).
  - `PHOTOMATOR_API` alias in `vite.config.ts`.
- **Renamed without fallback (rebuildable caches/ephemera):** preview-render
  IndexedDB (worst case: one clean-then-healed pop-in per photo after upgrade),
  ML weights Cache Storage name (currently unused at runtime — engines are
  server-side), grid scroll offsets (session-only), e2e hook (test-only).
- **Disclaimer:** the "not affiliated with … the makers of Photomator" clause
  named the third-party app our old name collided with; with the rename it
  would only confuse, so it now reads "not affiliated with Apple or Pixelmator".
- **Left untouched:** `tasks.md` keeps the original task wording (historical
  input, not app naming); `screenshot.png` is a binary artifact.

## How verified

- `yarn workspace @f8/core test` — all pass, incl. updated `branding.test.ts`
  (`APP_NAME === "f/8"`, no `photomator`/`safelight` in any user-visible copy).
- `yarn workspace @f8/server test` — all pass, incl. new `config.test.ts`
  (F8 defaults, F8 primary, PHOTOMATOR aliases, legacy db/library fallbacks)
  and the `PHOTOMATOR_ML_HEAL_STEPS` alias test in `ml-heal.test.ts`.
- `yarn typecheck` (turbo, all workspaces) — passes.
- `grep -rni photomator` over tracked sources shows only the documented
  compat shims, their tests, and the tasks.md task statement.
- Playwright was not run (per task instructions).
