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

Side-effect of trying to improve the performance of image loading - you can see some photos load stretched across the canvas only to "snap" to their correct dimensions a second later. Some photos still briefly load "stretched" on the canvas. This was not fixed in a recent commit.

"Blurry" tag in the album view should match how "RAW" shows so remove the border and match the text color. Say "Flagged as blurry...", you are missing the "as".

Implement "Selective Color" adjustment just like Photomator shows it.

"Compare with Original" shows a tool to compare side by side. If you hold clicking on the button instead, it'll show the original version while holding the button. And the button should be disabled if there were no edits on the picture.

Implement Selective Clarity adjusments like in Photomator being able to target Shadows, Midtones and Highlights adjusting their Texture and Clarity.

Remove the "Add Adjusment" button, I presume that's what Save as Preset does, showing a menu of presets (in a submenu like we show zoom options in the menu at the top) do. And make sure we don't copy denoise or heal as an adjusments, it should just do the basic adjustments.

Is it possible to learn from the adjustments I've made, have a "train" action somewhere or just do it on the fly and in Adjustments in the ... menu have an ML Auto Enhance action? Writeup if there is any benefit to this.

This photo could not be loaded should not show the "Try again" button. And be better at detecting when we ar eoffline, e.g. in the album view the thumbnails are all broken. Instead I should see the standard offline UI takeover message. ANd we should ping if we are back online and then reload.
