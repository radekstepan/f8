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

Fix failing playwright - @f8/web:e2e:   1) [chromium] › tests/e2e/heal-brush-types.spec.ts:46:1 › heal, smooth, and detail each reconstruct differently 
@f8/web:e2e: 
@f8/web:e2e:     Error: page.evaluate: TypeError: Cannot read properties of undefined (reading 'pendingRepairIds')
@f8/web:e2e:         at eval (eval at evaluate (:370:30), <anonymous>:1:17)
@f8/web:e2e:         at eval (<anonymous>)
@f8/web:e2e:         at UtilityScript.evaluate (<anonymous>:370:30)
@f8/web:e2e:         at UtilityScript.<anonymous> (<anonymous>:1:44)
@f8/web:e2e:         at eval (eval at evaluate (:370:30), <anonymous>:1:17)
@f8/web:e2e:         at UtilityScript.evaluate (<anonymous>:370:30)
@f8/web:e2e:         at UtilityScript.<anonymous> (<anonymous>:1:44)
@f8/web:e2e:         at hook (/Users/radekstepan/dev/photomator/apps/web/tests/e2e/helpers.ts:58:15)
@f8/web:e2e:         at getPendingIds (/Users/radekstepan/dev/photomator/apps/web/tests/e2e/helpers.ts:77:46)
@f8/web:e2e:         at expect.poll.timeout.timeout (/Users/radekstepan/dev/photomator/apps/web/tests/e2e/helpers.ts:250:53)
@f8/web:e2e:         at waitForHealingDone (/Users/radekstepan/dev/photomator/apps/web/tests/e2e/helpers.ts:247:3)
@f8/web:e2e:         at healStroke (/Users/radekstepan/dev/photomator/apps/web/tests/e2e/helpers.ts:237:3)
@f8/web:e2e:         at healCenterWith (/Users/radekstepan/dev/photomator/apps/web/tests/e2e/heal-brush-types.spec.ts:42:3)
@f8/web:e2e:         at /Users/radekstepan/dev/photomator/apps/web/tests/e2e/heal-brush-types.spec.ts:47:18
@f8/web:e2e: 
@f8/web:e2e:     Error Context: test-results/heal-brush-types-heal-smoo-aa5b8-ach-reconstruct-differently-chromium/error-context.md
@f8/web:e2e: 
@f8/web:e2e:   1 failed
@f8/web:e2e:     [chromium] › tests/e2e/heal-brush-types.spec.ts:46:1 › heal, smooth, and detail each reconstruct differently 

have a subtle drop shadow around the photo canvas, right now it still looks like a semi-transparent oval with a rigid border

Double click on a point on a curve doesn't remove it. Try with right click overriding the browser right click menu. If it doesn't work then let's go with Shift click to remove.

In the filmstrip at the bottom name of the album and count of photos is not horizontally centered, count shows higher.

Focus mode should remove all but the photo and the film strip at the bottom of the album.

The generate thumbnail action keeps picking the same photo. Not sure how we decide which photo to pick but randomize it. If we pick the most "interesting", we still should have an order and pick from these.
