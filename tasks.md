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

The styling of adjustments is inconsistent. Too much padding around descriptions like "Automatically enhance exposure". ML button when ML is not used. Collapsing a category hdies ML button. Unclear if something is "On" or reset to defaults. Reset to default button not showing consistently. Why is there a toggle in some of the options.

The Auto Enhance should just be an "Auto" button with an icon in the "Color Adjustments" header (and under ... as well) and not its own standalone category.

Switching to Repair shows a loading something and a "Cancel repair" button. How can repair run when I didn't click anywhere??? "Checking photo server" is the culprit. Not sure I need to know that. If I run the acutal repair then sure, otherwise don't distract me.

When we run ML repair on top of (edge) of an ML repair. Is it taking the px from the full repaired image so far or the original? It should be the former. Sometimes I need to "touch up" a section of the image that was already fixed but it has a blemish.

Repair brush size - why does it have a vertical line 20% of the way through?

Compe up with a better "Color Presets" icon. Right now it looks the same as the "Presets" tool/actions.

Photo Information modal doesn't need to show another preview. The Add button is too large and ugly and there is no whitespace around the horizontal bar at the bottom.

When a photo is loading navigating from an album there's a noticeable flash of content (or lack thereof). We should ideally animate from the preview in the album to the full image. Or if hard just don't flash the empty content.

The dropdowns in the menu at the top are not flish with the dropdown triggers.  And the f/8 should not be a trigger. That's what the Help is about. Also I am not convinced about the rounded style of the toolbar buttons. they need margin at the top and bottom so they don't fill vertical space of the menu toolbar so much.

The icon in the album view to resize the preview is in reverse order. If I slide it left, the previews should get smaller, not larger

Clicking on a selected album in the sidebar should deselect it and take us to all photos.

The backlink saying "All photos" sometimes takes me from all photos to a single photo. Rethink it and rethink how it looks. I want a backlink from a photo. make it beautiful though. And make it work when the sidebar on the left is open/not on photo view.
