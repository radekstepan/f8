---
'@f8/core': patch
---

The top-right version indicator stays pinned to the changesets-managed app version: the release-time sync step is now covered by an automated test, so a future `yarn version-packages` cannot silently stop updating the displayed version.

## Task writeup (docs/tasks/22-version-top-right.md)

## Request

"Which version of the app are we showing in the top right corner? Is it
any one being moved by changesets? I want to make sure we keep updating
this version number."

## Answer

Yes — the top-right corner shows the changesets-managed version, and it
keeps updating through the release loop:

- Rendered by: `MenuBar` in `packages/ui/src/components/Topbar.tsx`
  (`.version-indicator`, `margin-left: auto` pins it right) as
  `v<APP_VERSION>`; the About dialog brand line shows the same value.
- Source: `APP_VERSION` in `packages/core/src/branding.ts`, currently
  `"0.1.0"`. It mirrors the four workspace `package.json` versions
  (`@f8/core`, `@f8/ui`, `@f8/web`, `@f8/server`), which move in lockstep
  via the changesets `fixed` group in `.changeset/config.json`.
- Update loop: `yarn changeset` → `yarn version-packages` (runs
  `changeset version`, then `scripts/sync-app-version.mjs` rewrites
  `APP_VERSION`) → rebuild → the indicator shows the new version.
- Guards: `branding.test.ts` fails if `APP_VERSION` drifts from any
  workspace version; `appVersion.test.tsx` pins the render wiring and
  CSS; the new `syncAppVersion.test.ts` (this commit) covers the sync
  script itself. The root `package.json` stays at `0.0.0` by design.

## Finding: already implemented

This exact task was built in commit `7540661` ("Show app version
instead of edition label; set up changesets at 0.1.0", see
`docs/tasks/18-app-version-changesets.md`). I verified the wiring is
still intact in the current tree: all four workspaces at `0.1.0`,
`APP_VERSION` matches, the sync script no-ops cleanly, and no hardcoded
or stale version strings remain in the UI. So this commit adds the one
missing piece rather than reworking anything.

## Change (this commit)

- `packages/core/src/syncAppVersion.test.ts` (new, 6 tests): automated
  coverage for `scripts/sync-app-version.mjs`, which the previous task
  verified only by hand. Covers stale-version rewrite (surrounding file
  content preserved), in-sync no-op, workspace-drift refusal,
  non-semver refusal, missing-declaration refusal, and the script's
  existence at the path `version-packages` calls.
- `.changeset/app-version-sync-coverage.md` (new): patch changeset, per
  the repo rule that each task commit carries one.
- No production code changed; no README update (no architecture change).

## Decisions

- **Fixture copy, zero prod change.** The sync script derives the repo
  root from its own path, so each test copies the real script into a
  temp fixture tree (four `package.json` files plus a `branding.ts`)
  and runs it there with `node`. This exercises the actual release
  script without adding test-only hooks to it.
- **Did not run `yarn version-packages`.** That is a release action and
  would consume the three pending changesets belonging to other tasks
  (zoom dropdown alignment, zoom-lens dock, star-album glyphs). It stays
  a maintainer step; this commit only guarantees the sync half of it.
- **Changeset is `@f8/core` patch.** The change is test-only with no
  user-visible effect, but the task rules require a changeset per
  commit; the `fixed` group moves all four workspaces together anyway.

## Tests

- New `syncAppVersion.test.ts`: 6/6 pass; `branding.test.ts`: 9/9 pass.
- Full `@f8/core` suite: 55 files / 958 tests pass.
- Full `@f8/ui` suite (incl. `appVersion.test.tsx`): 66 files /
  526 tests pass.
- `@f8/core` typecheck passes. No Playwright, per the task rules.

## Caveats

- `@f8/*` imports resolve to `dist/`, and `@f8/core` has no watch/dev
  mode — after a future `version-packages`, rebuild core before `yarn
  dev` reflects the new version (true of any core change, not just the
  version). Turbo `build`/`test`/`typecheck` ordering (`^build`) already
  handles this for those commands.
