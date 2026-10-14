import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import { ML_CATEGORIES, ML_CATEGORY_ENABLED_KEY, ML_CATEGORY_KEYS, touchedMlCategories } from "./mlCategories.js";
import type { MlCategory } from "./mlCategories.js";
import { computeColorAuto, computeLightnessAuto, computeWhiteBalanceAuto } from "./vision/enhance.js";
import { solidColor } from "./vision/fixtures.js";

describe("ML categories", () => {
  it("covers the three sections with an automatic action", () => {
    expect([...ML_CATEGORIES]).toEqual(["whiteBalance", "lightness", "color"]);
  });

  it("keys every category onto real EditState fields", () => {
    const recipeKeys = new Set(Object.keys(DEFAULT_EDIT));
    for (const category of ML_CATEGORIES) {
      expect(ML_CATEGORY_KEYS[category].length).toBeGreaterThan(0);
      for (const key of ML_CATEGORY_KEYS[category]) {
        expect(recipeKeys.has(key)).toBe(true);
      }
    }
  });

  it("owns each category's enabled flag so an auto apply re-enables a legacy-disabled section", () => {
    for (const category of ML_CATEGORIES) {
      expect(ML_CATEGORY_KEYS[category]).toContain(ML_CATEGORY_ENABLED_KEY[category]);
    }
  });

  it("covers every key the auto computes write, so purity tracking sees the whole apply", () => {
    const image = solidColor(8, 8, 100, 100, 100);
    const writes: Record<MlCategory, object> = {
      whiteBalance: computeWhiteBalanceAuto(image),
      lightness: computeLightnessAuto(image),
      color: computeColorAuto(image),
    };
    for (const category of ML_CATEGORIES) {
      for (const key of Object.keys(writes[category])) {
        expect(ML_CATEGORY_KEYS[category]).toContain(key);
      }
    }
  });

  it("keeps categories disjoint so a slider patch maps to exactly its section", () => {
    const seen = new Set<string>();
    for (const category of ML_CATEGORIES) {
      for (const key of ML_CATEGORY_KEYS[category]) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("touchedMlCategories", () => {
  it("maps a slider patch to its owning category", () => {
    expect(touchedMlCategories({ temperature: 6000 })).toEqual(["whiteBalance"]);
    expect(touchedMlCategories({ tint: 4 })).toEqual(["whiteBalance"]);
    expect(touchedMlCategories({ exposure: 0.5 })).toEqual(["lightness"]);
    expect(touchedMlCategories({ highlights: -10, shadows: 10 })).toEqual(["lightness"]);
    expect(touchedMlCategories({ saturation: 12 })).toEqual(["color"]);
  });

  it("treats the enabled flag as a touch of its category", () => {
    expect(touchedMlCategories({ whiteBalanceEnabled: true })).toEqual(["whiteBalance"]);
    expect(touchedMlCategories({ lightnessEnabled: true })).toEqual(["lightness"]);
    expect(touchedMlCategories({ colorEnabled: true })).toEqual(["color"]);
  });

  it("ignores keys no automatic action owns", () => {
    // Brightness, blacks, vibrance, and hue have sliders in auto
    // sections but are never auto-computed.
    expect(touchedMlCategories({ brightness: 10 })).toEqual([]);
    expect(touchedMlCategories({ blacks: -10 })).toEqual([]);
    expect(touchedMlCategories({ vibrance: 10 })).toEqual([]);
    expect(touchedMlCategories({ hue: 10 })).toEqual([]);
    expect(touchedMlCategories({ rotation: 90, straighten: 2, curve: 10 })).toEqual([]);
    expect(touchedMlCategories({})).toEqual([]);
  });

  it("reports every category a mixed patch touches", () => {
    expect(touchedMlCategories({ temperature: 6000, saturation: 5 })).toEqual(["whiteBalance", "color"]);
  });
});
