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

The zoom in View should show under "Show", not at the bottom of the dropdown. And it should respect if we have the compare with original on. If we have Repair on, we should see the circle inthe zoom in view IF it's the same size or smaller than the preview. The zoom in view in the dropdown should also be a submenu where the 8x is the default but we also have 4x and 16x. Only the 8x, the default, has the keyboard shortcut.

If we star some photos, create "smart albums" in the sidebar library group for the star "counts" we have saved. 

Instead of "Local-first edition", show the app's overall version in its place. Use changesets and start bumping versions of the packages and the app overall.
