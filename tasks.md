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

If I apply Auto adjustments and reload the UI, the button is enabled, but there is no reset button anymore. We need to be remembering a stack of actions and have a way to revert for all of them, even after a hard reload.

The dropdowns in the menu at the top are flush with the dropdown triggers, but we shouldn't have rounded borders on the button or dropdown where they meet (meaning bottom of the button onhover and top of the dropdown when opened).

The backling to all photos when the sidebar is collapsed is not flush with the library sidebar button (that expands it).

We need to use custom tooltips throughout the app, always showing such that they are not cutoff but the viewport. Use a custom lib for this. Make it match the theme.

Why is the hide presets button showing on library view? Same for compare with original and info button at the top. Adjust, Repair, Crop are the same. These only show on the photo view.

When i try to superresolution export the UI says "ML weights are missing — run yarn setup, or export once to download them (~64MB).". I ran "yarn setup" already and there were no errors.

When exporting, show estimated file size when we select a preset and before exporting. If this is not possible/not accurate, don't do it.

When exporting JPEG (lossy formats), show a zoom in preview of a picture showing 16x zoom of an area like we do on the preview denoise view. I also want to see a full view with a box of where we focus and then next to it a 16x zoom of the area I am looking at. If I switch the preset, still remember where I was focused at.
