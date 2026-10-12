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

Why are color adjustments (including ML adjustments) showing on a library view when no photo is in focus?

After importing photos they show in all photos but not in an album. Automatically create an album name from folder name. Use human name e.g. "2026-europe-trip" becomes "2026 Europe Trip" etc. Also watch out, do not reimport the same file 2x. Each file is unique in the whole app.

The rename from Photomator didn't take. Whole bunch of env vars keep saying PHOTOMATOR, tests say it, even the damned README. You don't need to keep this legacy stuff around, remove it. The app is inspired by Photomator, yes, but it's called "f/8".

The photos in the footer below the main photo should always be a single row, not multiple rows. Make sure when we navigate to a photo in a row we try to "center" it in the middle of the viewport so we see older and newer photos.

Why do we keep saying "Keeper ML"? I only care to know if a photo is blurry. Do not report on "positive" state.

When I switch to the repair tool, the message that shows at the bottom shifts the picture itself. Then when the message disappears it shifts the picture again. Fix it, picture should stay fixed and not move just because a message showed up.

Right click on a footer photo in the context menu should let me remove the photo. In the album view the delete buttom should be in bottom right corner just like favorite is in top right. Right now it spills out of the photo "card".

I should be able to drag and select multiple photos in album view (or Ctrl click individual ones) to move to an album (right click or drag onto an album itself).

In the sidebar listing albums when I click on the ... the menu is cutoff instead of showing on "top" of the UI.

The + and down arrow on Add Adjustment is too far to the sides.

The Repair tool sidebar should have diffrent sections like the Adjust tool so things are grouped together. Then fix the "Remove x selected" on One-click removal, the button is too chionky. Same with Find dust spots. Don't we have a nicer looking buttons for this? Then on the person removal it shows me say "2 people", but I don't know which is which. Show me onhover in red just like we show healed areas. Or in a bounding box. Same with dust spots.

Download of person removal object failed. The error emssage is just 2 links, it should show as a little "message" with the 2 options. And the install script for this app should download all the assets ahead of time rather than on demand.
@f8/server:dev: [object-detect] Downloading YOLOv8n weights (~12MB, AGPL-3.0) from https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
@f8/server:dev: POST /api/object-detect/warmup -> 200 (0ms)
@f8/server:dev: GET /api/object-detect/health -> 200 (0ms)
@f8/server:dev: [object-detect] Background readiness failed: Model download failed: HTTP 404.

For dust spots found, don't you have a confident score? Show them sorted by the score and show the score.

The Adjust sidebar looks nice for White Balance, histogram, Curves etc. But then you lost the plot with Auto Enhance, Scene Enhance, Enhance Faces, Brghten. It's a mix of toggles non-buttons and buttons. Clean it the fuck up! Make a toggleable section for ML enhance and use nice looking buttons fot the actions.

I click ML face enhance and maybe it does something but I don't see it. No progress bar. No way to toggle it on/off etc. Does it even work?

Brighten subject only seems like a better version of Enhance Faces? Can I then apply enhance to subject AND background at the same time? How to do I preserve the changes? Clicking Cancel goes away. And why do I have to click apply? Why don't I see the changes live when I use the sliders? Fucking fix the UX on this.

If I am on a photo pressing Esc takes me back to the album.

Semantic Search ML. How do I retrain it? Do I retrain the model after importing more photos?

The Denoise ML should be with the other ML functions in Adjust. And the Preview... the pictures Before and After are so small that they are useless. Show me a closeup of an area or something. And when I apply it if I then use the Compare tool I can't tell any difference. Is it even working?

Superresolution on export shows "ML weights unavailable — 2x serves the classical upscale (no ML)." WTF? The install script should fetch them. I don't get why it's not a hard fail if some of the ML functionality doesn't work. Get it working. No fallbacks. No "that's ok, we'll just not use ML", fucking show the error message and make it a hard fail.
