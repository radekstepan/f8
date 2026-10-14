# Task: App version plus changesets

## Request

Instead of "Local-first edition", show the app's overall version in its
place. Use changesets and start bumping versions of the packages and the
app overall.

## Change

- `packages/core/src/branding.ts`: `APP_EDITION` ("THE LOCAL-FIRST
  EDITION") and `APP_EDITION_SHORT` ("LOCAL-FIRST EDITION") are gone,
  replaced by `APP_VERSION` (`"0.1.0"`). The workspace `package.json`
  versions are the single source of truth; `APP_VERSION` mirrors them.
- `packages/ui/src/components/Topbar.tsx`: the menu bar's right-hand
  indicator now renders `v0.1.0` (was "LOCAL-FIRST EDITION") under the
  renamed `version-indicator` class.
- `packages/ui/src/components/EditorDialogs.tsx`: the About dialog's
  brand line now renders `v0.1.0` (was "THE LOCAL-FIRST EDITION").
- `apps/web/src/index.css`: `.demo-indicator` renamed to
  `.version-indicator` (both rules, same styling); the dead unused
  `.demo-version` rule removed.
- `.changeset/config.json` (new): all four workspaces in one `fixed`
  group so they share a single version; `baseBranch: master`; default
  bundled changelog generator; `privatePackages: { version: true, tag:
  false }` — without `version: true`, changesets would not move private
  package versions at all (the default is `false`).
- `.changeset/README.md` (new): the going-forward workflow (add a
  changeset, run the version command, commit).
- `scripts/sync-app-version.mjs` (new): rewrites `APP_VERSION` from the
  workspace versions; fails loudly when the workspaces disagree or the
  version is not semver, and no-ops when already in sync.
- `package.json` (root): new `changeset` and `version-packages`
  (`changeset version && node scripts/sync-app-version.mjs`) scripts,
  plus `@changesets/cli` in `devDependencies`.
- Initial bump: `apps/server`, `apps/web`, `packages/core`,
  `packages/ui` moved from `0.0.0` to `0.1.0`. No pending `.changeset/`
  files remain — the bump is already applied. The root `package.json`
  stays at `0.0.0` (changesets versions workspaces, not the root).
- `docs/development.md`: new "Versioning" section documenting the
  workflow.

## Decisions

- **`fixed` group, not independent versions.** The task asks for "the
  app's overall version", so the four workspaces move in lockstep as one
  number rather than versioning independently.
- **`APP_VERSION` literal plus a test, not a build-time import.**
  Importing `package.json` into core would need `resolveJsonModule` and
  import-attribute handling across `tsc -b`, vitest, Vite, and the
  server's type-stripped dev mode. A mirrored literal with a test that
  fails on drift (and a sync script chained into the version command)
  has zero build risk and the same guarantee.
- **Both edition spots replaced.** The string rendered in two places
  (menu-bar indicator and About dialog brand line); both now show the
  version. The "local-first" wording in `APP_DESCRIPTION` and the
  `index.html` meta description stays — it describes the architecture
  accurately and is not the edition label.
- **No `version` script name.** Yarn 4's built-in `version` command
  could shadow a script of that name, so the command is
  `version-packages`.
- **No git tags per release** (`tag: false`): the repo has no
  release/tag workflow, so versioning does not create tags.
- **No README update.** A label swap plus release tooling is neither an
  architecture change nor a complex feature; the workflow lives in
  `docs/development.md` and this writeup.
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so core was rebuilt after the
  change for tests/typecheck; the rebuild stays untracked.

## Caveats

- `@changesets/cli` was declared in the root `devDependencies` but
  could not be installed here (no npm registry access in this
  environment), so `yarn.lock` does not cover it yet. Run `yarn
  install` once with network access; until then `yarn changeset` and
  `yarn version-packages` fail with a missing binary. Everything else
  (tests, typecheck, build, the sync script) was verified without it.

## Tests

- `packages/core/src/branding.test.ts` (extended, +3 tests): `APP_VERSION`
  is semver, equals all four workspace `package.json` versions, and the
  retired "edition" wording is gone from user-visible copy. Core suite:
  54 files / 945 tests pass.
- `packages/ui/src/components/appVersion.test.tsx` (new, 4 tests):
  menu bar renders `v<APP_VERSION>` in `.version-indicator`, About
  dialog renders it in the brand line, no "edition" in either, and the
  stylesheet carries the renamed rules (dead `demo-*` classes gone).
  UI suite: 66 files / 523 tests pass.
- `scripts/sync-app-version.mjs`: verified all three paths by hand —
  in-sync no-op (exit 0), drift across workspaces (exit 1 with a clear
  message), and a stale `APP_VERSION` rewritten to match.
- `yarn typecheck` (6 tasks) and `yarn build` (4 tasks) pass; server
  suite (19 files / 180 tests) passes. No Playwright, per the task
  rules.
