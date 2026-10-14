# Task 6: Path-based URL structure

## Problem

Library deep-links used query strings (`?photo=<id>&tool=<tool>` for the
editor, `?album=<id>` for the grid). The task asked for path-based routes
instead.

## Route conventions chosen

- `/photo/<id>/<tool>` — editor view. The tool segment is always written
  by the app (`adjust`, `crop`, `repair`); parsing also accepts a bare
  `/photo/<id>` (default tool) and trailing slashes.
- `/album/<id>` — library/grid view.
- `/` (and unknown paths) — default view: editor on the seed photo, as
  before. Unknown paths are normalized to the canonical path for the
  resolved state by the URL-sync effect.
- Ids are `encodeURIComponent`-escaped on build and decoded on parse, so
  ids with spaces round-trip; an encoded `/` (`%2F`) stays inside one
  segment.

## Change

- `packages/core/src/libraryUrl.ts`: `parseLibraryUrl` now takes
  `(pathname, search)` and reads the path first; `buildLibraryUrl` returns
  a canonical path (`/album/<id>`, `/photo/<id>/<tool>`).
- `apps/web/src/App.tsx`: `initialUrl`, the URL-sync effect, and the
  popstate handler all pass `pathname` (+ `search` for legacy links) to
  the parser and write the built path directly. Same-view updates still
  `replaceState`, view switches still `pushState`.
- `apps/web/vite.config.ts`: `base` changed from `"./"` to `"/"`. With
  nested paths a relative base resolves the favicon and the lazy
  `vision.worker`/`opencv` chunks against `/photo/` or `/album/` on
  deep-link reloads (404s); the absolute base fixes that. Verified in the
  built `dist/index.html` (`/favicon.svg`, `/vision.worker-*.js`).
- `apps/web/tests/e2e/collection-filters.spec.ts`: URL navigation and
  assertions updated to path form (not run — Playwright is out of scope
  per task rules).
- `packages/core/src/collections.ts`: comment updated (`?album=` →
  `/album/<id>`).
- `README.md`: documented the scheme in Persistence and Privacy + a
  Project Map row for `libraryUrl.ts`.

No server change was needed: `apps/server/src/app.ts` already falls back
any non-`/api` GET to `index.html`, so deep-link reloads serve the app.

## Decisions

- Back-compat is kept and cheap: legacy `?photo=`, `?album=`,
  `?collection=`-alias, and `?tool=` links still parse when the path
  carries no route (path wins on conflict), and the existing URL-sync
  effect rewrites them to the canonical path via `replaceState` — the
  redirect needed no new code.
- The tool segment is always emitted (never omitted for the default
  `adjust`) so every editor URL has one canonical form and round-trips
  exactly.
- `parseLibraryUrl(buildLibraryUrl(...))` call shape in
  `collections.test.ts` needed no change: the built path is the parser's
  first argument.

## Tests

- Rewrote `packages/core/src/libraryUrl.test.ts` for the path scheme (22
  tests): editor/album parsing, omitted/invalid tool, trailing slashes,
  bare/unknown/incomplete paths, extra segments, percent-decoding,
  legacy-query back-compat (photo-wins, collection alias, path-wins),
  build output, round-trips, and legacy→path normalization.
- Full `@f8/core` suite: 52 files / 898 tests pass.
- `yarn workspace @f8/core typecheck` and `@f8/web typecheck` clean (core
  `dist` rebuilt first — web types resolve against it). Web production
  build succeeds. Playwright not run (per task rules).
