import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import { ML_CATEGORIES, ML_CATEGORY_ENABLED_KEY, ML_CATEGORY_KEYS, snapshotMlCategory } from "./mlCategories.js";
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

  it("owns each category's enabled flag so a revert restores bypass state", () => {
    for (const category of ML_CATEGORIES) {
      expect(ML_CATEGORY_KEYS[category]).toContain(ML_CATEGORY_ENABLED_KEY[category]);
    }
  });

  it("snapshots every key the ML computes write, so a revert restores all of them", () => {
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

  it("keeps categories disjoint so one revert never touches another section", () => {
    const seen = new Set<string>();
    for (const category of ML_CATEGORIES) {
      for (const key of ML_CATEGORY_KEYS[category]) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("snapshotMlCategory", () => {
  it("captures the white-balance values plus the enabled flag", () => {
    const edit = { ...DEFAULT_EDIT, temperature: 6200, tint: -8, whiteBalanceEnabled: false, exposure: 0.4 };
    expect(snapshotMlCategory(edit, "whiteBalance")).toEqual({
      temperature: 6200,
      tint: -8,
      whiteBalanceEnabled: false,
    });
  });

  it("captures the lightness values without brightness or blacks", () => {
    const edit = {
      ...DEFAULT_EDIT,
      exposure: 0.3, contrast: 10, highlights: -5, shadows: 7,
      brightness: 20, blacks: -20, lightnessEnabled: true,
    };
    expect(snapshotMlCategory(edit, "lightness")).toEqual({
      exposure: 0.3,
      contrast: 10,
      highlights: -5,
      shadows: 7,
      lightnessEnabled: true,
    });
  });

  it("captures only saturation for color, leaving vibrance and hue alone", () => {
    const edit = { ...DEFAULT_EDIT, saturation: 12, vibrance: 30, hue: -10, colorEnabled: true };
    expect(snapshotMlCategory(edit, "color")).toEqual({ saturation: 12, colorEnabled: true });
  });
});
