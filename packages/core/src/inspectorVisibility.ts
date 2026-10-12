/** Inspector (adjustments panel) visibility rule.
 *
 * The Inspector edits exactly one photo — the open photo — so it only makes
 * sense in the editor view. In the library view no photo is in focus, yet the
 * shell kept rendering the panel (bound to a stale selected id), showing
 * color and ML adjustments next to a grid they cannot act on. The rule lives
 * here as a pure predicate so it is unit-testable without a DOM; App applies
 * the verdict both to the Inspector mount and to the `has-inspector` shell
 * class, so the grid reclaims the full width.
 */

import type { ViewMode } from "./types.js";

/** True only when the adjustments panel should be mounted and laid out. */
export function isInspectorVisible(view: ViewMode, inspectorOpen: boolean): boolean {
  return inspectorOpen && view === "editor";
}
