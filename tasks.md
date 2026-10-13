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

In photo mode at the top next to show/hide presets have an action/icon to reset the image to original

The show/hide presets icon in photo mode at the top needs to match the icon in the strip at the bottom

In Adjustments the descriptions have too much padding from the header (Classify the scene, Finds faces) etc. Make it line up with where Temperature, Exposure starts

If I apply Auto adjustments and reload the UI, the button is enabled, but there is no reset button anymore

When I am in repair mode and drag around the UI, you see a bit of a lag between me drawing and the red "patch" appearing in the UI.

When we are loading a photo coming from an album it's nice to see a preview, but the preview is not sized the same way as the actual final image, so you see a resizing. I don't want to see resizing. Make the preview size the same as final.

The dropdowns in the menu at the top are not flish with the dropdown triggers.

The backling to all photos is ugly. Rethink it and make it beautiful. And make sure it works when sidebar is on/off.
