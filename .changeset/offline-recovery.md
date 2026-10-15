---
'@f8/core': patch
'@f8/ui': patch
'@f8/web': patch
---

Offline handling now detects outages and recovers by itself: the "This photo could not be loaded" error no longer shows a Try again button, a burst of broken thumbnails (or the browser going offline) flips to the standard offline takeover after a verifying ping instead of leaving broken images, and while offline the app pings the server every few seconds and reloads the library automatically when it answers.
