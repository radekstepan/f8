# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a writeup of what changed in docs/tasks. Record any important decisions in that writeup.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.
8. Keep track of learnings from each task. Then once done with all of the tasks summarize the learnings into a markdown document so that we do not repeat the same mistakes over and over.

## List

Why is the "enabled" ML button so different from enabled "Auto" button like in "Denoise"? I like the style of the "Auto" button when enabled.

Denoise preview do a 16x and show just "After" int he first row, don't need the "Before". Then "Before - 16x" and "After - 16x". ANd show in the After a little rectangle/square that shows where are looking at/focusing.

Each adjustment should have a "reset" button when we are not default. Right now it only shows onhover in the header. And remove the "Revert" button. Reset does the same thing.

Denoise move "Auto" into "ML" in the header like elsewehre. And make sure ML shows to the right.

"Subject & Background" still has a fucking weird gold slider with wider.

"No faces found - ML". Say just "No faces found" and don't show it in golden text. That's for links/actions ONLY. Same for Scene Enhance text.

Scene Enhance when I apply it and reload the UI the "ML" label is not "enabled".

Make sure adjustments have just one icon for revert/reset. Not two. Just one.

Denoise "Restore denoise" is a button. Should be a yellow link. Make sure all the actions should be a golden link and not a weird grey button.

Why is the reset button showing onhover in Curves when the curve hasn't been changed??? Same with Effects.

Why does "Details" have a toggle button? Every other control just expands/collapses without the little checkbox?

Why does adjust Details not have a reset button???

Remove people and Find dust spots should be a yellow "link" not a button. Same with "Repair 57 selected" etc. Do a review and fix all the buttons to be links like this.

Why is ML in One-Click Removal and Dust Spots not aligned to the right???

Cancel, Cancel repair, Dismiss. The padding and alignment around these is fucking inconsistent. Review and align them all!!!!

When repair is running and I click to star or favorite, nothing happens until the repair is finished.
