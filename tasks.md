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

"All Photos" flashes on hard reload of photo view before the correct category shows in a backlink. Show nothing rather than wrong category. And nicely animate the histogram when loading too.

Undo Redo and Reset to Original buttons show on album view - wrong.

Reset to Original button should be highlighted if the image has been edited. 

Remove "Double click to reset quality", it's not needed.

Export Photo Quality preview I should be able to drag the square and when I click the square shows elsewhere from where I actually clicked.

When I change Quality preset on export we should NOT close the preview. Transition to the new setting for preview.

Remove Download settings button, not needed.
