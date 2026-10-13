/** Per-category ML (automatic) actions for the adjustments inspector.
 *
 * White Balance, Lightness, and Hue & Saturation each carry an ML button
 * that computes values from the photo; clicking it again (or the revert
 * icon beside it) restores the pre-ML snapshot. The tables below are the
 * single source of truth for which EditState keys belong to a category —
 * values plus the enabled flag, so a revert also restores bypass state.
 */

import type { EditState } from "./types.js";

/** Adjustment categories with an automatic (ML) action. */
export type MlCategory = "whiteBalance" | "lightness" | "color";

/** All ML categories, for iterating clears and guards. */
export const ML_CATEGORIES: readonly MlCategory[] = ["whiteBalance", "lightness", "color"];

/** EditState keys a category's ML apply owns: values plus its enabled flag. */
export const ML_CATEGORY_KEYS: Record<MlCategory, readonly (keyof EditState)[]> = {
  whiteBalance: ["temperature", "tint", "whiteBalanceEnabled"],
  lightness: ["exposure", "contrast", "highlights", "shadows", "lightnessEnabled"],
  color: ["saturation", "colorEnabled"],
};

/** The enabled flag an ML apply re-asserts: an applied category is always visible. */
export const ML_CATEGORY_ENABLED_KEY: Record<MlCategory, "whiteBalanceEnabled" | "lightnessEnabled" | "colorEnabled"> = {
  whiteBalance: "whiteBalanceEnabled",
  lightness: "lightnessEnabled",
  color: "colorEnabled",
};

/** Capture a category's current values so an ML apply can be reverted. */
export function snapshotMlCategory(edit: EditState, category: MlCategory): Partial<EditState> {
  const snapshot: Partial<EditState> = {};
  const record = snapshot as Record<keyof EditState, unknown>;
  for (const key of ML_CATEGORY_KEYS[category]) {
    record[key] = edit[key];
  }
  return snapshot;
}
