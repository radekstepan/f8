/** Escape-to-album navigation rule.
 *
 * On an open photo, Esc returns to the album grid — the collection the
 * photo was opened from (the photo still decides the collection via the
 * existing inference, so sidebar, toolbar, and grid agree). In the
 * library view there is nowhere to go back to, so Esc is a no-op there.
 *
 * Layering: dialogs and context menus consume Esc first — the Modal and
 * menu components close themselves on Esc through their own listeners,
 * and App's global handler bails out while a dialog is open or focus
 * sits inside a menu. This predicate therefore only answers the last
 * layer: given that no dialog or menu ate the key, should the view flip
 * back to the album? It lives here as a pure predicate so it is
 * unit-testable without a DOM, following `isInspectorVisible`.
 */

import type { ViewMode } from "./types.js";

/** True only when Esc should navigate from the open photo to the album. */
export function shouldEscapeToLibrary(view: ViewMode): boolean {
  return view === "editor";
}
