# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a changeset that doubles as the task writeup, hand-written at `.changeset/NN-<slug>.md` (`<slug>` = short kebab-case summary; `yarn changeset` needs an interactive TTY, so write the file directly in the CLI's exact format instead). Front-matter carries the package bump(s) (`patch` for fixes, `minor` for new capability); the body starts with a one-paragraph user-facing summary, then the full writeup: what changed, important decisions, and tests run. Numbering is one continuous running log shared by all runs: before writing, list `.changeset` AND `docs/tasks`, take the highest numeric prefix across both (changesets get consumed on release, so `.changeset` alone would restart), and use that number + 1, zero-padded to at least 2 digits (e.g. after `68-...` comes `69-...`). Never restart at `01`, never reuse a number, never leave gaps. No separate `docs/tasks/` file. See `.changeset/README.md` and the "Versioning" section in `docs/development.md` for the workflow.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.
8. Keep track of learnings from each task. Then once done with all of the tasks summarize the learnings into a markdown document so that we do not repeat the same mistakes over and over (in `docs/learnings.md`).

## List

DSC06320.ARW, I applied a preset and the preview in album view still shows the old image.

Make it easier to import photos. Drag and drop photos onto album page. Have an import button there if thre isn't one already.

Make it easier to export photos. Have an export album view button on the album page. It'll take the current view (album plus any filters, including smart albums etc.), ask you to confirm export filetype and % quality (as appropriate), no superresolution, no preview, and then show a progress dialog like during import exporting the photos, then zipping them finally giving us one zipped download file.
