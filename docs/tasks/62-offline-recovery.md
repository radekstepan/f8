# Task: Offline detection and recovery

## Request

"This photo could not be loaded should not show the 'Try again'
button. And be better at detecting when we are offline, e.g. in the
album view the thumbnails are all broken. Instead I should see the
standard offline UI takeover message. And we should ping if we are
back online and then reload."

## What changed

- `packages/ui/src/components/PhotoCanvas.tsx`: the "This photo could
  not be loaded" overlay lost its Try again button (and the now-dead
  `retry` state plus its two effect deps). The message drops the
  dangling "and try again" tail, since there is no retry affordance
  left: "This photo could not be loaded. Check your connection."
  `packages/core/src/image.ts` carries the same copy (it owns the
  rejection; the canvas line is the non-Error fallback) — updated in
  lockstep.
- `packages/core/src/offline.ts` (new): the pure connectivity policy.
  `noteImageFailure` records one broken-image timestamp, prunes
  failures older than `OFFLINE_IMAGE_ERROR_WINDOW_MS` (10s), and
  reports whether `OFFLINE_IMAGE_ERROR_BURST` (3) tripped;
  `OFFLINE_PING_INTERVAL_MS` (5s) sets the while-offline ping cadence.
- `packages/core/src/library.ts`: new `client.ping()` — a lightweight
  `GET /api/health` probe with `cache: "no-store"` (a cached 200 would
  read as "back online" while down). No server change; the endpoint
  already serves `{ ok: true }`.
- `packages/ui/src/hooks/useLibrary.ts`: the hook now owns
  connectivity. A capture-phase window `error` listener counts broken
  `<img>`s (resource errors don't bubble, so capture is required) —
  grid, filmstrip, presets, and sidebar thumbnails all report through
  it with no component API changes — and a burst verifies via
  `verifyConnection()`, which pings before flipping `status` to
  `offline`, so one corrupt photo never takes down the app. The
  browser `offline` event verifies too (a localhost server survives a
  dropped uplink, so the ping is the arbiter, not `navigator.onLine`),
  with a connection-specific gate detail; the `online` event reloads
  immediately. While `offline`, an interval pings every 5s and reloads
  the library on the first success, so the takeover resolves itself.
  `markOfflineIfDown` now also carries the failure message into the
  gate instead of leaving the fallback copy.
- `apps/web/src/App.tsx`: the offline gate (unchanged heading and
  manual Try again) gains a second line — "Retrying automatically —
  this page reloads when the server is back." No other App change was
  needed: the takeover already keys off `library.status`.
- Tests: core `offline` (5 tests: trip threshold, window pruning,
  boundary, ping cadence), `library-client` ping block (2 tests:
  endpoint + no-store, status-0 on unreachable), UI
  `offlineRecovery` (10 source-pinned tests: no photo retry, message
  sync, event/burst/poll wiring, gate note, manual retry kept).
  `photoStaleCanvasStretch.test.tsx` had its reset-effect locator
  updated (`retry` left the dep array; the effect itself is
  untouched). Changeset is `patch` for `@f8/core` + `@f8/ui` +
  `@f8/web`, hand-written in the CLI's exact format (`yarn changeset`
  needs an interactive TTY).

## Decisions

- **Ping verifies; events and bursts only suspect.** Flipping the
  takeover on `navigator.onLine === false` alone would false-positive
  in the common local setup (unplugged uplink, localhost server and
  browser still fine). Every trigger — browser event, image burst —
  must fail a live `/api/health` fetch with status 0 before the gate
  appears, and a passing ping clears the burst.
- **One global image-error listener instead of threaded props.**
  Wiring `onError` through PhotoBrowser, Filmstrip, PresetStrip, and
  the sidebar would touch four component APIs and still miss the next
  thumbnail; a six-line capture listener in the hook covers every
  `<img>` in every view, and the burst threshold plus ping guard the
  false-positive case (e.g. one corrupt file re-erroring on
  virtualized remounts costs a single ping).
- **No photo-level retry at all.** The task removes the button rather
  than fixing it because retrying a dead server photo-by-photo was
  the wrong layer: genuine outages now surface as the takeover (with
  auto-recovery), leaving the photo error for single broken images,
  where "check your connection" plus navigating away is the honest
  story.
- **Gate copy stays standard.** The heading and manual Try again are
  untouched per the request ("the standard offline UI takeover
  message"); only the detail line varies by cause (browser-offline vs
  unreachable server) and the new auto-retry note was added.
- **No README/docs update.** This changes no architecture and adds no
  user-facing feature surface — it is resilience UX behind an
  existing gate — so the writeup plus changeset carry it.

## Known limitation

Edits made in the ~500ms before an offline flip still lose their last
keystrokes: the editor flushes its debounced persist on unmount, but
the save fetch fails against the unreachable server and the recipe
only lived in the unmounted editor state. (Pre-existing for every
`markOfflineIfDown` flip, not introduced here.) Queued-while-offline
edit replay would fix it and is a follow-up, not this task.

## Verification

- `yarn test`: core 1155, server 181, UI 680 — all pass.
  `yarn typecheck` (core, ui, web) green after rebuilding core's
  `dist` (the UI typecheck resolves `@f8/core` types from `dist`).
  No Playwright, per the task rules.
