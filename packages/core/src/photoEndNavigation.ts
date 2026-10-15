/** First/last photo navigation (Home/End keys).
 *
 * While on an open photo, Home jumps to the first photo of the album and
 * End to the last one — the same collection the arrow keys walk. In the
 * library view the keys keep their native meaning (scroll the grid), so
 * the global handler only claims them in the editor.
 *
 * Focus/selection agreement: the filmstrip's own key handler moves focus
 * to the row end via `filmstripArrowIndex`, and App's global handler moves
 * the selection via `photoEndTargetId` below. Both key on `event.key`, so
 * when focus sits in the strip the two land on the same photo — exactly
 * like the arrow keys, which already compose this way. These helpers live
 * here as pure functions so the rule is unit-testable without a DOM,
 * following `shouldEscapeToLibrary`.
 */

import type { ViewMode } from "./types.js";

/** True when Home/End should navigate instead of scrolling natively. */
export function shouldNavigateToPhotoEnd(key: string, view: ViewMode): boolean {
  return (key === "Home" || key === "End") && view === "editor";
}

/** Id of the first (Home) or last (End) photo, or null when there is
 * nowhere to go: any other key, an empty collection, or the end already
 * open (a no-op, so re-pressing never resets zoom or clears state). */
export function photoEndTargetId(
  key: string,
  photos: ReadonlyArray<{ readonly id: string }>,
  selectedId: string,
): string | null {
  if (key !== "Home" && key !== "End") return null;
  const target = key === "Home" ? photos[0] : photos[photos.length - 1];
  if (!target || target.id === selectedId) return null;
  return target.id;
}
