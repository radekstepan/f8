/** Per-category automatic actions for the adjustments inspector.
 *
 * White Balance, Lightness, and Hue & Saturation each carry a header
 * toggle that computes values from the photo; toggling off resets the
 * section to its defaults (no snapshot — defaults need none). The tables
 * below are the single source of truth for which EditState keys belong to
 * a category — values plus the enabled flag, so an auto apply also
 * re-enables a legacy-disabled category, and so manual edits know which
 * whole-photo enhance highlight they break.
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

/**
 * ML categories a manual edit patch touches: any category owning at least
 * one of the patch's keys. The stack transition clears `pure` on touched
 * entries (the whole-photo enhance plus any legacy category entries).
 */
export function touchedMlCategories(patch: Partial<EditState>): MlCategory[] {
  const keys = new Set(Object.keys(patch));
  return ML_CATEGORIES.filter((category) =>
    ML_CATEGORY_KEYS[category].some((key) => keys.has(key)),
  );
}
