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

In the PResets on a portrait photo the preset box is too wide. Should be smaller to be just big enough to show the preview (of course) and the name of the preset. That's it. Right now it's about 3x the width.

"The library server is not running" is weird to say. Say that the application or server is not running. It's not a library server only anymore.

DSC06322.ARW why is the Denoise "Auto" button turned on?

Under View be able to toggle a "zoom in view" when in photo view so wherever the cursor goes we see a 16x magnification.

Rewrite the README.md by extracting learnings/architecture into relevant separate md files, then keep the readme light, using ASD-STE100 lanbguage saying what all the functions of the app are and that the original design is GPT 6 Astra with followup work by Muse Spark 1.3 (both in italics). It nees to have init instructions and of couese include a screenshot as well.

