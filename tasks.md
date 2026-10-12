# Tasks

System instruction: Work on these tasks, make sure to add tests, but do not run playwright. Commit each result you work on with a writeup of what you changed in docs/tasks. Work on these sequentially. If you made some important decisions, add them in the writeup. If you changed architecture, make sure to update the documentation of this app.

## List

DSC06308.ARW is a portrait photo but shows landscape in album and in presents and film strip below the photo. Make sure that making the photo portrait will look seamless in album with landscape photos.

The film strip should have a vertical scrollbar if we have more photos

Hints disappear after 2.5s + 0.5, increase it to 5s so we have a chance to read them

Remove from library button should be bottom right, and make sure we have this action on the photo view as well
Be able to remove a whole album and not just a photo. Perhaps onhover show ... and a menu in the sidebar and top of the album view somewhere

Sort album by filename or time imported or datetime captured

When we open a photo and scroll to it in the footer, try to place the photo in the middle of the footer, meaning right now we scroll to it and it's always to the right, but I'd like to make it easy to see if there are other photos after it.

