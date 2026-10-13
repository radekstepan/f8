# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a writeup of what changed in docs/tasks. Record any important decisions in that writeup.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.

## List

For adjustments, on each category, I like to have a "ML" button which applies the change automatically and next to it (when applied) has a revert little icon. Do it that way rather than having toggles. Toggles toggle visibility of the category. You can also click the ML "button" again to revert.

Auto straighten should jsut be a button and if no hprizon detected flash a message over the photo just like when we say how to use the Repair tool. If we do apply a rotation then toggle the auto straighten button to "on". Clicking it again reverts the change. In fact, I want more actions to work this way. A single button. A toast. A way to revert by clicking again. If I manually rotate a photo after, the Auto straighten button should not show as toggled because I edited the photo manually after the initial ML rotation.

Be able to import a whole folder, extract the album name from the folder name

Remove the "Move the current photo into this album" checkbox, not useful

Are labels and blurry photos automatically labeled on import? If so then remove the explicit actions from album "..." dropdown.

Scene Enhance, Enhance Faces from film strip should be removed, not useful. And make sure the popover shows such that it's not cutoff. Right now it shows below and is cutoff by the browser viewport.

Why does "Add Adjustment" have two icons? + and downward chevron? Maybe keep the chevron and move it to the right but not extreme right?

Repair sidebar "Less distraction", "Rebuild small" etc should be removed including the icon in yellow above it. Just taking up space.

When you collapse and expand "Dust Spots", "One-Click Removal" the text shifts by a 1px or so, fix it. We should be resuing the same component for this collapse/expand panel across the app.

There is an ugly horizontal line above "Enhance Faces". Same with "Enhance Subject..."

The Denoise Before/After 2x is not zoomed in enough. I can't see a fucking thing.

When I click "Enhance Subject and Background the button goes away. It's hard for me to see which sliders and settings belong together. Figure it out. And then when I edit Subject and Background it repeats my settings in a single golden line? Why do we need it? I can see the sliders. Make it easy to toggle this off and again, make sure I can still see the title of that action. Maybe explode the indiviual ML actions into their own sections just like we do Lightness, White Balance ETC.

White Balance and other actions. Why is there a toggle AND an Auto button? And if I click Auto, we should highlight we are on auto settings (toggle it). And show the revert button. And if I adjust the sliders some more then do not highlight Auto because we are not on auto anymore. Still have the revert button though. Apply this approach throughout the app.

