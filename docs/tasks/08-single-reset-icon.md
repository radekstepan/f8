# 08 — One revert/reset icon per adjustment

## Request
"Make sure adjustments have just one icon for revert/reset. Not two.
Just one."

## Audit
Swept every `AdjustmentSection` header in all three tools, rendered
server-side in maximally-applied states (every ML snapshot live, every
slider off defaults, all assists applied), counting `section-reset` and
`ml-revert` icons in the header only (before `adjustment-content`).
Result: no adjustment shows two icons anywhere — Tasks 3 and 4 already
converged the headers, and nothing regressed since.

Adjust tool, everything applied + fully dirty (classic enhance mode):

| Section | Header icons | Note |
|---|---|---|
| Auto Enhance | 1 reset | shared snapshot reset |
| Scene Enhance | 0 | only the last-used mode carries it |
| Enhance Faces | 1 reset | clears the stored adjust |
| Subject & Background | 1 reset | clears the stored mask |
| Denoise | 1 reset | clears the stored denoise (Task 4) |
| White Balance | 1 reset | snapshot-or-defaults routing |
| Lightness | 1 reset | snapshot-or-defaults routing |
| Hue & Saturation | 1 reset | snapshot-or-defaults routing |
| Curves | 1 reset | kept while collapsed |
| Details | 0 | no header reset yet (Task 12) |
| Effects | 1 reset | kept while collapsed |

Zero `ml-revert` icons anywhere in the adjust tool. Scene mode flips the
single enhance icon to Scene Enhance (Auto Enhance drops to 0). At
defaults the five slider sections each tease exactly one hover-only
reset; the snapshot sections render no icon at all.

Repair tool: no header icons in any of the five sections. The Repairs
section clears from a single content-level `retouch-clear` icon; its
per-group deletes are per-item scope, not a second section reset.

Crop tool: no adjustment headers; straighten pairs Auto with exactly the
one remaining `RevertButton` while a snapshot lives, zero icons without
a snapshot, zero `section-reset` in every state.

## Change
No source change: the audit found zero violations, so there was no root
cause to fix. The deliverable is the sweep itself, committed as a
regression test (below) so a second icon can never creep back into a
header unnoticed.

- New `packages/ui/src/components/singleResetIcon.test.tsx` (repo
  convention: server-rendered, no jsdom): an `auditHeaders` helper
  splits the markup into sections (never nested — each chunk ends at
  its `</section>`) and counts header-only icons per section.

## Tests
- `singleResetIcon.test.tsx`, 5 tests:
  - all-applied adjust render: every header ≤ 1 icon, the exact
    icon-bearing set pinned (9 resets, 0 reverts), Scene Enhance at 0
    in classic mode, Details pinned at 0 (Task 12 flips it), collapsed
    Curves/Effects keep exactly their one icon;
  - scene-mode render: the same sweep, icon on Scene Enhance only;
  - defaults render: ≤ 1 per header, exactly 5 hover-only resets, no
    reverts;
  - repair render (ready assists + one stamp): zero header icons in all
    five sections, exactly one `retouch-clear`;
  - crop render: exactly one `ml-revert` with a snapshot, zero without,
    zero `section-reset` in both.
- Full `@f8/ui` suite (31 files / 256 tests) passes; `@f8/ui` and
  `@f8/web` typechecks pass (`ui` dist rebuilt first — web resolves
  `@f8/ui` from dist); lint is an unconfigured no-op echo. No
  Playwright (per task rules).

## Decisions
- Count, not style: the task converges each header to a single control,
  which is done. The straighten row keeps its gold `Undo2` revert while
  adjust headers use the grey `RotateCcw` reset — unifying the two
  designs would restyle settled UI with no mandate in this task's text,
  and gold/grey action semantics are owned by Tasks 6/9/13. Task 3
  explicitly kept `RevertButton` for straighten only.
- Content-level text actions (`Clear`, `Rescan`, `Restore denoise`)
  are out of scope: they are buttons/links, not icons, and their
  styling belongs to Tasks 9/13. Likewise the Repairs per-group
  deletes: removing them would lose per-group deletion, a different
  scope from the section-level clear-all.
- Details pinned at zero icons with a Task 12 pointer rather than
  given a reset here — Task 12 owns Details' reset.
- No README update: verification-only change, no architecture or
  feature-surface change.
