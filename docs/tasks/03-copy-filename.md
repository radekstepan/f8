# Task 3: Clicking filename in photo view copies it

## Change
The filename in the photo-view heading was plain text. It is now a button
(`packages/ui/src/components/PhotoCanvas.tsx`): clicking it copies
`photo.name` to the clipboard and flashes a "Copied!" confirmation for
1500ms (`FILENAME_COPIED_MS`).

Affordance and feedback follow existing app conventions:
- The button carries `data-tooltip="Copy filename"` (flipped to `Copied!`
  after a successful copy), rendered by the global `TooltipHost` — no
  native `title` tooltips anywhere, per the codebase rule.
- A lucide `Copy` icon sits next to the name, hidden until hover/focus
  (`apps/web/src/index.css`), swapping to a `Check` in `--accent` while
  the confirmation shows. Both icons are the same size, so the swap
  causes no layout shift.
- `aria-label` announces `Copy filename <name>` / `Copied <name>`, and
  the global `:focus-visible` outline already covers keyboard users.

Copying goes through a new `copyTextToClipboard` helper
(`packages/ui/src/utils/clipboard.ts`, exported from `@f8/ui`): the
async Clipboard API first, then the legacy textarea + `execCommand`
fallback for non-secure contexts, resolving `false` (never throwing)
when nothing works. Confirmation shows only on success. The flash
resets when the photo changes and its timer is cleared on unmount.

## Decisions
- Button around the name only, not the whole `.photo-filename` row:
  the RAW/JPEG badge and Edited indicator stay non-interactive.
- No toast system: the app has none, and a tooltip + inline check is
  enough confirmation for a one-word copy action.
- Helper returns `boolean` instead of throwing so the call site stays a
  one-liner and failure is silently a no-op (no error UI for copy).

## Tests (`packages/ui/src/components/filenameCopy.test.tsx`)
SSR markup + stylesheet pins (repo has no DOM test env) plus helper
unit tests with stubbed globals:
- `renders the filename as a button with a copy hint`: testid, tooltip,
  aria-label, name in a span.
- `keeps the file-type badge and edited indicator next to the button`:
  button precedes the badge in DOM order.
- `styles the button as an affordance with a hover-revealed icon`:
  pointer cursor, icon hidden until hover/focus/copied.
- `tints the button while the copied confirmation shows`: accent color
  on `.is-copied`.
- `copyTextToClipboard`: Clipboard API path, execCommand fallback path
  (value set, area removed), false with no mechanism, false on rejected
  write, false on failed execCommand.

## Verification
- `yarn workspace @f8/ui test`: all pass (471 tests, incl. 9 new).
- `yarn workspace @f8/ui typecheck`: clean.
- No README change: behavior-only fix, no architecture or feature change.
