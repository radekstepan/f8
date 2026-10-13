# Task 13: Repair/Face actions become golden links, not grey buttons

## Symptom

"Remove people", "Find dust spots", "Repair N selected" (and the sibling
"Remove N selected", both retries, and "Apply face enhance") rendered as
grey `slim-button`s, while every action around them — Cancel, Dismiss,
Rescan, Clear, Update preview — was already the golden `text-button` link.
`object-removal-retry` (grey) even disagreed with `dust-spots-retry`
(gold) for the identical repair-scope control.

## Root cause

`ObjectRemovalControl`, `DustSpotsControl`, and `FaceEnhanceControl`
(`packages/ui/src/components/Inspector.tsx`) gave their primary in-content
actions `class="slim-button…"` — the grey raised-button style — while the
Task 6/9 convention reserves gold for links/actions and renders every other
in-content action as `text-button` (`#b8a279`, hover `#f0d496`). Unlike the
Denoise swap (Task 9), no per-section margin lived in a `slim`-specific
selector here (`.suggestion-actions > button` sizes both classes alike, and
the full-width detect links carry no top-margin rule), so the swap is
class-only. With all six converted, `.slim-button` had zero usages left,
so its four sheet rules were dead.

## Fix

- `packages/ui/src/components/Inspector.tsx` — six class swaps, titles /
  testids / disabled logic / handlers untouched:
  - `object-removal-detect`, `dust-spots-detect`: `slim-button
    full-width` → `text-button full-width` (stay centered full-row links).
  - `object-removal-apply`, `dust-spots-apply`: `slim-button` →
    `text-button`; the `checked === 0` disabled state now dims through
    the Task 9 `.text-button:disabled` rule (reused, not duplicated).
  - `object-removal-retry`: `slim-button` → `text-button`, unifying it
    with the already-gold `dust-spots-retry`.
  - `face-enhance-apply`: `slim-button` → `text-button`.
- `apps/web/src/index.css` — deleted the four dead `.slim-button` rules
  (base, `:hover:not(:disabled)`, `.is-active`, `:disabled`). No other
  component used the class (verified repo-wide); `.secondary-button`
  rules stay for dialogs and the out-of-scope controls below.

## Audit table

| Control | Before | After | Notes |
|---|---|---|---|
| Remove people (`object-removal-detect`) | slim full-width | text full-width | converted |
| Remove N selected (`object-removal-apply`) | slim | text | disabled dim via shared rule |
| People Retry (`object-removal-retry`) | slim | text | now matches dust Retry |
| Find dust spots (`dust-spots-detect`) | slim full-width | text full-width | converted |
| Repair N selected (`dust-spots-apply`) | slim | text | disabled dim via shared rule |
| Dust Retry (`dust-spots-retry`) | text | text | already gold, pinned |
| Apply face enhance (`face-enhance-apply`) | slim | text | converted |
| Denoise preview/apply/restore | text | text | Task 9, untouched |
| Header ML/Auto pills | ml/auto | ml/auto | header controls, out of scope |
| Icon-only reset/revert | icon-button | icon-button | out of scope |
| Toggles, segmented controls | — | — | state controls, out of scope |
| Cancel / Cancel repair / Dismiss | text | text | Task 15 owns alignment |
| Modal footers (Cancel/Export/Remove…) | secondary/primary/danger | unchanged | dialog chrome, out of scope |
| Label Add, Try again, Clear filters, Import Photos, Import from folder, FsBrowser Close | secondary/primary | unchanged | forms / empty states / dialogs, out of scope |
| B&W Make Black & White (`secondary-button full-width`) | secondary | unchanged | see boundary below |

## Scope boundary

- Left for Task 15: Cancel / Cancel repair / Dismiss padding + alignment.
- Task 14 owns the ML-badge right-alignment in One-Click Removal / Dust
  Spots headers; this change touches content rows only.
- Black & White's in-content button stays `secondary-button`: it is a
  boolean toggle duplicate of the header toggle (same `onChange` flip as
  Task 11's Details duplicate-toggle discussion), not a fire-once action
  link — and it sits behind the Inspector's internal `extraSections`
  state, so server-rendered tests cannot reach or pin it. Neither task
  names it; Task 9's handoff named exactly the six assist controls above.

## Tests

- `packages/ui/src/components/repairSections.test.tsx`
  - Rewrote `uses slim buttons…` as `renders every repair action as a
    golden link, never a grey button`: pins all five repair testids as
    `text-button` across idle / ready / error renders, and asserts no
    `slim-button`/`secondary-button` survives anywhere in the repair
    tool render (no bounding needed — nothing else there uses them).
  - New: unchecked-everything ready states render `disabled=""` on both
    apply links with "Remove/Repair 0 selected" labels, and the dim is
    pinned to the reused `.text-button:disabled` rule via `cssRule`.
  - New: `.slim-button` is absent from the whole sheet.
- `packages/ui/src/components/objectRemoval.test.tsx` — retry pin is now
  `class="text-button"`.
- `packages/ui/src/components/faceEnhance.test.tsx` — apply pin is now
  `class="text-button"`, plus a `slim-button` absence assertion.

## Verification notes

- Specificity: the shared `.text-button:disabled` rule (Task 9) already
  outranks the base color rule and the `:hover:not(:disabled)` guard
  keeps disabled apply links from brightening — verified by rule
  inspection, same as Task 9.
- The 0-checked disabled apply state is reachable in server rendering
  (all-unchecked detections), so unlike the denoise strength-0 case it
  is pinned at the markup level, not just the CSS level.
