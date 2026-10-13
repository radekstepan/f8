/** Photo-view-only toolbar controls visibility rule.
 *
 * The toolbar carries controls that only make sense with a photo open —
 * the Adjust/Repair/Crop tool switcher plus the hide-presets toggle, the
 * compare-with-original toggle, and the photo-info button. In the library
 * view no photo is in focus, so those controls have nothing to act on and
 * the toolbar omits them entirely (rather than rendering them disabled:
 * a disabled Adjust button in the grid invites the question of how to
 * enable it, while an absent one reads as "not applicable here").
 *
 * Like `shouldShowPhotoBacklink`, the correct behavior depends on the
 * view, so the predicate lives here as a pure function and App derives
 * the Toolbar prop from it.
 */

import type { ViewMode } from "./types.js";

/** True only when the toolbar should offer the photo-only controls. */
export function shouldShowPhotoTools(view: ViewMode): boolean {
  return view === "editor";
}
