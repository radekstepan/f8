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

Review all the components we use throughout the app and make sure we use common ones and not copying code for the same UI.

The "Subject & Background" toggle (is it?) is this wide weird bar. Ugly as sin.

ML Denoise I should be able to click "Auto" but then be able to fine-grain adjust it as well. When I try it it says previews on small downsample. Where exactly???  When I move the Strength slider, is it supposed to immediately apply? Am I supposed to see something? What's the "Compare" text below? What does "Try another strength" mean? Document what this fuckign thing does and fix the UX of this. It's ugly.

Why do Scene Enhance and Enhance Faces have buttons that repeat the same fucking thing? Have an "ML" button with revert just like White Balance and Lightness

If Enhance Faces no face found, save that info.


ML button in WHite Balance, Lightness and other should be right aligned with revert to the left of it. Why is there revert and reset lightness both? One fucking button to reset. The "ML" button also can't tell when it's on vs off, fix that.

Histogram in Adjustments comes first ahead of everyhting

Not fan of the massive "Auto Enhance" button both in the header and sidebar. Pick one. Be consistent. Make it UX/pretty, not a massive ugly button.

Applying Auto straighten pushes the Auto button text lower by a 1px or 2px or so.

Clicking "Export 2x" in the filmstrip does nothing, remove it. OK maybe it does something. When I click it and then switch to Adjust or Repair, the export dialog shows. Bloody fucking hell.
