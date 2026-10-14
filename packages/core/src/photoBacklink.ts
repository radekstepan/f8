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

import type { Photo, ViewMode } from "./types.js";
import { collectionForPhoto, photoInCollection } from "./collections.js";

/** True only when the toolbar should offer the back-to-collection link. */
export function shouldShowPhotoBacklink(view: ViewMode): boolean {
  return view === "editor";
}

/**
 * Collection id the photo backlink should name — or null while it is not
 * yet known.
 *
 * On a hard reload of a photo URL the collection state starts at the 'all'
 * default and the inference effect adopts the photo's album only after the
 * first paint, so naming `collection` directly flashes "All Photos" before
 * the correct category. Null means "render a pending placeholder, never a
 * guess": no photo yet, or the initial inference has not run. Once settled
 * a photo outside the current collection already names its target album
 * (exactly what the inference effect is about to set), so a filmstrip
 * switch across albums never flashes the stale name for a frame either.
 * The library grid is unaffected: its title always names the collection.
 */
export function resolveBacklinkCollection(
  view: ViewMode,
  photo: Photo | null,
  collection: string,
  collectionSettled: boolean,
): string | null {
  if (view !== "editor") return collection;
  if (!photo || !collectionSettled) return null;
  if (!photoInCollection(photo, collection)) return collectionForPhoto(photo);
  return collection;
}
