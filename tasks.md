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

Which version of the app are we showing in the top right corner? Is it any one being moved by changesets? I want to make sure we keep updating this version number.

Clicking on "Zoom in view" in the dropdown (not one of the 4x 8x 16x) is how you clear the zoom in view.

Not sure if it's a bad antialising but I see dark black semitransparent border around a photo. Including rounded corners. Is it just a drop shadow gone havoc? Make it beautiful and subtle.

I am noticing with some tools (like Vignette, Fade, but possibly others), that we make calls to DELETE /api/photos/7c4ab7f0-5e85-4dae-9ca2-36d2c9aef3c3/heal-overlays/1 -> while dragging sliders in Vignette tool etc? First of all, we should have a debounce I believe. And second, why is it calling a delete on a heal overlay? Seems odd. Explain or fix.

Curves shouldn't use "double click to reset", but instzead have a reset button like other tools. Also, the curve line with one dot - how useful is it? The slider does the same thing. Are we supposed to be able to add a new dot as well?

The algo for White balance and Lightness (possibly others), would they benefit from ML functions? Do a writeup.

For subject and background, find an icon for each subtitle (avatar plus a picture? up to you to decide), so that each subsection is easier to see.

If "Enhance Faces" finds no faces, why is the Reset button showing and "ML" highlighted. It should only do that if we actually apply any change.

Scene Enhance and Subject & Background. Are they actually ML driven? If not they should have an "Auto" icon and not "ML" icon. Be consistent throughout the tools.

There is a bug where on a photo if I click the global Auto button next to Color Adjustments, adjustments like White Balance, Lightness etc show a reset icon (correct), but the "Auto" button is not highlighted. We turned these on, so show them highlighted.

Switch the Auto and ML icons in Color Adjustments to a toggle (we should have it in history or still use it somewhere, it's pretty). Turning the toggle on will apply suggested changes, toggling off will reset to defaults. This means we can remove the reset button. Manually tweaking sliders will turn the toggle on as well. For ML derived tools, just add a little ML icon/label next to the name of the tool to say it's an "ML" tool.
