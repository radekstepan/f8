# Task 2: Reword "library server is not running"

## Problem

The offline gate said "The library server is not running." The server
is no longer library-only (it serves edits, presets, ML heal/denoise,
semantic search, cull assist), so "library server" misdescribes what
is down. The requirement: say the application or server is not
running instead.

## Change

Reworded every user-facing "library server" string to "application
server" (3 strings in 3 files), plus 2 code comments for consistency:

- `apps/web/src/App.tsx` — offline-gate heading:
  "The library server is not running." →
  "The application server is not running."
- `packages/core/src/library.ts` — fetch-failure `LibraryError`:
  "The photo library server is not reachable. Start it with yarn dev
  and try again." →
  "The application server is not reachable. Start it with yarn dev
  and try again." (this message renders as the offline-gate
  subheading via `library.error`).
- `packages/ui/src/hooks/useLibrary.ts` — non-Error fallback:
  "Could not reach the library server." →
  "Could not reach the application server."
- `packages/core/src/library.ts` — 2 comments ("served by the
  … server", "HTTP client for the … server") updated to match.

A repo-wide grep confirms no "library server" remains under
`apps/*/src` or `packages/*/src` outside the new tests' own
assertions.

## Decisions

- Chose "application server" over bare "server" (keeps specificity
  about what to start) and over "application/server" (slash reads
  awkwardly in a heading). It is also the standard term for an app's
  backend server, and it matches the task's "application or server".
- Left `LibraryError`, `LibraryStatus`, `createLibraryClient`, and the
  `library-gate` CSS class untouched: internal identifiers, not
  user-facing copy; renaming them would churn the API for no user
  benefit.
- Left the two "library server" mentions in `README.md` alone: Task 5
  of this batch rewrites the README, so touching it here would only
  create a conflict.
- Left "Photo server offline." (ML-tier line in `Inspector.tsx`)
  alone: it describes the ML tier specifically, not this gate.
- No README update: copy-only change, no architecture change.
- Doc number `09-` continues the existing `docs/tasks/NN-` sequence
  (this is item 2 of the new `tasks.md` batch, but the folder is one
  running log).

## Tests

- `packages/core/src/library-client.test.ts` — new behavioral test:
  a throwing `fetch` yields `LibraryError` status 0 with the exact
  new "application server" message, and the message does not match
  /library server/i.
- New `packages/ui/src/hooks/offlineWording.test.ts` (4 tests): pins the
  App.tsx heading, the useLibrary fallback, and the core client
  message at the source level (the offline gate lives in apps/web,
  which has no unit runner — Playwright only, out of scope — so the
  resetDehighlights/topbarMenus source-pin precedent applies), plus
  a blanket "library server" appears nowhere in the three files.

## Verification

- `packages/core`: full suite — 52 files, 899 tests, all pass
  (includes the 1 new wording test).
- `packages/ui`: full suite — 62 files, 485 tests, all pass
  (includes the 4 new `offlineWording` tests).
- `typecheck` clean in `@f8/core`, `@f8/ui`, and `@f8/web`.
- Playwright not run (out of scope per task rules).
