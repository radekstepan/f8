/** Photo-backlink visibility rule.
 *
 * The toolbar carries a backlink from an open photo to its collection —
 * but only there. In the library view the grid is already home, so there
 * is nothing to go back to and the breadcrumb renders as static text
 * with no control at all: the link can never fire from the grid and
 * carry the user from All Photos into a single photo.
 *
 * Like `shouldEscapeToLibrary` (and the Task 11 view-gating lesson), the
 * correct behavior depends on the view, so the predicate lives here as a
 * pure function and App derives the Toolbar prop from it. The link itself
 * is one-directional by construction: it dispatches the `back` action,
 * which sets the view to library unconditionally — never the `grid`
 * toggle.
 */

import type { ViewMode } from "./types.js";

/** True only when the toolbar should offer the back-to-collection link. */
export function shouldShowPhotoBacklink(view: ViewMode): boolean {
  return view === "editor";
}
