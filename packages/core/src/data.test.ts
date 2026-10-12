import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT, PRESETS, isDefaultEdit, presetForPatch } from "./data.js";
import type { EditState } from "./types.js";

const stroke = { x: 0.5, y: 0.5, size: 0.05, strength: 100, kind: "repair" } as const;

describe("presetForPatch", () => {
  it("keeps the active preset for retouch-only patches", () => {
    expect(presetForPatch("Original", { retouches: [{ ...stroke }] })).toBe("Original");
    expect(presetForPatch("Vivid", { retouches: [] })).toBe("Vivid");
  });

  it("keeps the active preset for geometry patches", () => {
    expect(presetForPatch("Original", { rotation: -90 })).toBe("Original");
    expect(presetForPatch("Original", { flipH: true })).toBe("Original");
    expect(presetForPatch("Original", { flipV: true })).toBe("Original");
    expect(presetForPatch("Original", { straighten: 1.2 })).toBe("Original");
    expect(presetForPatch("Original", { cropRatio: "1:1" })).toBe("Original");
    expect(presetForPatch("Vivid", { cropRatio: "Original", rotation: 0, flipH: false, flipV: false, straighten: 0 })).toBe("Vivid");
  });

  it("marks color adjustments as Custom", () => {
    expect(presetForPatch("Original", { exposure: 1 })).toBe("Custom");
    expect(presetForPatch("Vivid", { saturation: 10 })).toBe("Custom");
    expect(presetForPatch("Original", { blackAndWhite: true })).toBe("Custom");
    expect(presetForPatch("Original", { whiteBalanceEnabled: false })).toBe("Custom");
  });

  it("lets an explicit preset in the patch win", () => {
    expect(presetForPatch("Custom", { ...DEFAULT_EDIT, preset: "Original" })).toBe("Original");
    expect(presetForPatch("Original", { preset: "My Look" })).toBe("My Look");
  });

  it("marks mixed color + geometry patches as Custom", () => {
    expect(presetForPatch("Original", { exposure: 1, rotation: 90 })).toBe("Custom");
  });
});

describe("isDefaultEdit", () => {
  it("recognizes the default recipe", () => {
    expect(isDefaultEdit({ ...DEFAULT_EDIT })).toBe(true);
  });

  it("rejects color, geometry, and retouch changes", () => {
    const changed: Partial<EditState>[] = [
      { exposure: 1 },
      { rotation: 90 },
      { cropRatio: "1:1" },
      { retouches: [{ ...stroke }] },
      { preset: "Custom" },
    ];
    for (const patch of changed) {
      expect(isDefaultEdit({ ...DEFAULT_EDIT, ...patch })).toBe(false);
    }
  });
});

describe("preset categories", () => {
  it("never uses the orientation-confusable Landscape category", () => {
    const categories = PRESETS.map((preset) => preset.category as string);
    expect(categories).not.toContain("Landscape");
  });

  it("keeps Original in the default Essentials category", () => {
    const original = PRESETS.find((preset) => preset.id === "original");
    expect(original?.category).toBe("Essentials");
  });
});
