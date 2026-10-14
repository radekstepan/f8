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
9. Each subagent must add a changeset (`yarn changeset`) describing its change and include it in the same commit, so versions keep moving. See `.changeset/README.md` and the "Versioning" section in `docs/development.md` for the workflow.

## List

Not sure if it's a bad antialising but I see dark black semitransparent border around a photo. Including rounded corners. Is it just a drop shadow gone havoc? Make it beautiful and subtle. This was supposedly fixed, but it isn't. I see banding and I see rounded corner in top right background of the photo.

Changing Curves should show a toggled button just like the other controls. Same with Effects and Details possibly. No more "reset" button un the adjustments side-panel.

Curves point right click to remove doesn't work, just opens browser right click menu. Double click to remove instead.

Subject & Background have double toggles, keep the one in the header.

Remove the "Show photo browser" button from the film strip at the bottom

Move "Focus Mode" from Window to "View" as the first option in its own section. And remove "Photo Browser" from Window. Then remove the Window drom the menu at the top since it's empty.

Move the presets icon from the menu at the top in photo mode to be between compare and info.

Move the delete icon from photo canvas to be an action right to the left of the info icon.

Add an option in the context menu (...) of an album to find/generate/crop a representative thumbnail for the album to show int he sidebar.

Make sure the albums in the sidebar show sorted by name with the ones that have a thumbnail showing ahead of the ones without.

When I undo an action like Denoise, it doesn't seem to immedaitely apply on the photo.
