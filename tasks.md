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

Remove the "Updating preview" text from the Export modal. I don't want the modal to resize at all.

The histogram animation on initial load is weird. It animates from individual bars (10 or so) to the beautiful histogram. Start histogram as "flat" (no lines/areas) and then when we have the data animate them in to rise from the horizontal 0.

Clicking filename in photo view should copy the filename.

DSC06323.ARW the Reset to orginal button is highlighted even after I click it. The image should be reset now no? Why keep highlighting the reset button.

Export button keeps showing on album view, remove it, only shows on photo view.

Switch URL structure to use / and not query strings.

When animating the photo backlink don't show this weird horizontal "bar", show nothing and fade in the backlink with album name.
