# Task 03 — Remove pre-rename legacy branding

## What changed

Removed every pre-rename fallback so the app answers only to its `f/8`
identity (`F8_*` env vars, `f8.db`, `~/Pictures/f8`, `f8.*` storage keys):

- `apps/server/src/config.ts`: dropped the dual-name `pick()` helper and the
  pre-rename catalog/library-file fallbacks. Config now reads `F8_DATA`,
  `F8_ROOTS`, `F8_LIBRARY`, `F8_HOST`, `F8_PORT` only (plus generic `HOST` /
  `PORT`), always resolves `f8.db` / `~/Pictures/f8`, and no longer takes an
  `exists` override (it existed solely for the fallback probes).
- `apps/server/src/{ml-heal,face-detect,dust-spots,semantic-search,superres,denoise,object-detect,selective-mask,straighten-ml}.ts`:
  removed the pre-rename env fallbacks from every `*_DIR` / `*_URL` /
  `*_OFFLINE` / `*_STEPS` / `*_THREADS` / `*_EP` / `*_WEIGHTS` lookup.
- `packages/ui/src/hooks/useLibrary.ts`: deleted the one-shot pre-server
  `localStorage` migration (`migrateLegacyState` + helpers); library load is
  now a straight `client.getLibrary()`.
- `apps/web/src/hooks/useToolPrefs.ts`: deleted the pre-rename prefs-key
  fallback and its forward-migration writes.
- `apps/web/vite.config.ts`: dropped the pre-rename API proxy alias.
- `packages/core/src/branding.ts`: trimmed the header comment that documented
  the removed fallbacks (it also pointed at a `docs/tasks/01-rename-f8.md`
  that does not exist).
- `README.md`: removed the fallback-aliases paragraph, the
  `localStorage`-migration sentence, and the "legacy migration" project-map
  mention.

## Tests

- `apps/server/src/config.test.ts`: rewrote — removed the alias/precedence/
  fallback cases; kept defaults + `F8_*` coverage and added `~` expansion,
  default host/port/roots/derived-dirs, and `PORT`/`HOST` fallback cases.
- `apps/server/src/ml-heal.test.ts`: removed the alias case; added step-value
  trimming and `mlHealDir` default/override coverage.
- `packages/core/src/branding.test.ts`: removed the negative guards that
  named the retired product (asserting absence of a name requires naming it);
  the positive `APP_NAME === "f/8"` assertion and the remaining copy guards
  stay.

## Decisions

- Full removal, no deprecation shim: per the task, old names are simply not
  honored anymore. Anyone still exporting them gets defaults.
- The checkout directory itself still carries the old name; renaming a
  user's directory is out of scope (the config test still asserts basenames
  only for this reason).
- `tasks.md` still contains the task text naming the old product; it is the
  shared work list, not app code, so it was left untouched.
