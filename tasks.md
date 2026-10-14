# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a writeup of what changed in docs/tasks. Record any important decisions in that writeup.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.
8. Keep track of learnings from each task. Then once done with all of the tasks summarize the learnings into a markdown document so that we do not repeat the same mistakes over and over (in `docs/learnings.md`).

## List

In the PResets on a portrait photo the preset box not wide enough. All the preset names need to show and right now Golden Hour and Soft Light (and potentially others) are truncated.

Clciking "Cancel" under Denoise does nothing. Also the alignment of the actions is suspicious. Left align, some right aligned. PReview denoise is center aligned. Align (sic) across this tool and others in the app.

Zoom in view is something with a toggle (checkbox) in the dropdown, has a shortcut and show (like on Photoshop) a square in the bottom right corner and be 8x zoom.
