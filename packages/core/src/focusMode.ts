/** Focus-mode visibility rules.
 *
 * Focus mode (View → Focus Mode, Shift F) strips the shell down to the
 * open photo and the album filmstrip: the menu bar, toolbar, library
 * sidebar, adjustments panel, preset strip, and status bar all unmount,
 * while the filmstrip stays even when the user normally keeps it closed.
 * The panel preferences themselves are untouched, so leaving the mode
 * restores the exact previous layout. The rules live here as pure
 * predicates so they are unit-testable without a DOM; App applies them
 * to the shell mounts, following `isInspectorVisible`.
 */

import type { ViewMode } from "./types.js";

/** View the shell renders in focus mode: always the open photo.
 *
 * State can still name the grid while the mode is on (browser Back lands
 * a popstate, `/` parks a search), and a photo-less grid would break the
 * mode's contract — so the mode wins and the photo stays on screen.
 */
export function resolveFocusView(view: ViewMode, focusMode: boolean): ViewMode {
  return focusMode ? "editor" : view;
}

/** True when the filmstrip must render: forced on in focus mode, the
 * user's preference otherwise. */
export function isFilmstripVisible(filmstripOpen: boolean, focusMode: boolean): boolean {
  return focusMode || filmstripOpen;
}
