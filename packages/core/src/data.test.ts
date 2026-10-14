import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT, INITIAL_EDIT, PRESETS, RESET_PATCH, isDefaultEdit, isOriginalLook, patchBreaksEnhancePure, presetForPatch } from "./data.js";
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

describe("patchBreaksEnhancePure", () => {
  it("breaks on any slider or look change", () => {
    expect(patchBreaksEnhancePure({ exposure: 0.5 })).toBe(true);
    expect(patchBreaksEnhancePure({ temperature: 6000 })).toBe(true);
    expect(patchBreaksEnhancePure({ brightness: 10 })).toBe(true);
    expect(patchBreaksEnhancePure({ curve: 10 })).toBe(true);
    expect(patchBreaksEnhancePure({ blackAndWhite: true })).toBe(true);
    expect(patchBreaksEnhancePure({ faceAdjust: null })).toBe(true);
    expect(patchBreaksEnhancePure({ selectiveAdjust: null })).toBe(true);
    expect(patchBreaksEnhancePure({ denoise: null })).toBe(true);
  });

  it("holds for geometry, retouch, and label-only patches", () => {
    expect(patchBreaksEnhancePure({ rotation: 90 })).toBe(false);
    expect(patchBreaksEnhancePure({ straighten: 1.2 })).toBe(false);
    expect(patchBreaksEnhancePure({ cropRatio: "1:1" })).toBe(false);
    expect(patchBreaksEnhancePure({ flipH: true, flipV: true })).toBe(false);
    expect(patchBreaksEnhancePure({ retouches: [{ ...stroke }] })).toBe(false);
    expect(patchBreaksEnhancePure({ preset: "Custom" })).toBe(false);
    expect(patchBreaksEnhancePure({ autoEnhanced: false, sceneEnhance: null })).toBe(false);
    expect(patchBreaksEnhancePure({})).toBe(false);
  });

  it("breaks on mixed look + geometry patches", () => {
    expect(patchBreaksEnhancePure({ exposure: 1, rotation: 90 })).toBe(true);
  });
});

describe("isOriginalLook", () => {
  it("matches the default recipe regardless of the preset label", () => {
    expect(isOriginalLook({ ...DEFAULT_EDIT })).toBe(true);
    expect(isOriginalLook({ ...DEFAULT_EDIT, preset: "Custom" })).toBe(true);
    // Server recipes deserialize a fresh empty anchors list: still Original.
    expect(isOriginalLook({ ...DEFAULT_EDIT, curvePoints: [] })).toBe(true);
  });

  it("ignores geometry and retouches, which presets never touch", () => {
    expect(isOriginalLook({ ...DEFAULT_EDIT, rotation: 90, cropRatio: "1:1", straighten: 1.5 })).toBe(true);
    expect(isOriginalLook({ ...DEFAULT_EDIT, retouches: [{ ...stroke }] })).toBe(true);
  });

  it("rejects any color, flag, or enhance change", () => {
    expect(isOriginalLook({ ...INITIAL_EDIT })).toBe(false);
    const changed: Partial<EditState>[] = [
      { exposure: 0.1 },
      { temperature: 5800 },
      { curvePoints: [{ x: 0.5, y: 0.6 }] },
      { blackAndWhite: true },
      { whiteBalanceEnabled: false },
      { autoEnhanced: true },
      { faceAdjust: { boxes: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], amount: 0.5, redEye: [], source: "onnx" } },
    ];
    for (const patch of changed) {
      expect(isOriginalLook({ ...DEFAULT_EDIT, ...patch })).toBe(false);
    }
  });
});

describe("isDefaultEdit", () => {
  it("recognizes the default recipe", () => {
    expect(isDefaultEdit({ ...DEFAULT_EDIT })).toBe(true);
    // Server recipes deserialize a fresh empty anchors list: still default.
    expect(isDefaultEdit({ ...DEFAULT_EDIT, curvePoints: [] })).toBe(true);
  });

  it("rejects color, geometry, and retouch changes", () => {
    const changed: Partial<EditState>[] = [
      { exposure: 1 },
      { rotation: 90 },
      { cropRatio: "1:1" },
      { retouches: [{ ...stroke }] },
      { curvePoints: [{ x: 0.5, y: 0.6 }] },
      { preset: "Custom" },
    ];
    for (const patch of changed) {
      expect(isDefaultEdit({ ...DEFAULT_EDIT, ...patch })).toBe(false);
    }
  });

  it("accepts the exact recipe reset() produces (defaults + nulled ML fields)", () => {
    expect(
      isDefaultEdit({ ...DEFAULT_EDIT, sceneEnhance: null, faceAdjust: null, selectiveAdjust: null, denoise: null }),
    ).toBe(true);
  });

  it("ignores key order", () => {
    const reordered = Object.fromEntries(Object.entries({ ...DEFAULT_EDIT }).reverse()) as unknown as EditState;
    expect(isDefaultEdit(reordered)).toBe(true);
  });

  it("rejects set ML look fields", () => {
    const changed: Partial<EditState>[] = [
      { sceneEnhance: { scene: "portrait", confidence: 0.9 } },
      { faceAdjust: { boxes: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], amount: 0.5, redEye: [], source: "onnx" } },
      {
        selectiveAdjust: {
          maskB64: "AA==", maskWidth: 1, maskHeight: 1,
          subject: { exposure: 0.5, contrast: 0, saturation: 0 },
          background: { exposure: 0, contrast: 0, saturation: 0 },
          source: "onnx",
        },
      },
      { denoise: { strength: 40, auto: true, source: "onnx" } },
    ];
    for (const patch of changed) {
      expect(isDefaultEdit({ ...DEFAULT_EDIT, ...patch })).toBe(false);
    }
  });

  it("treats nulled and zero-strength denoise as default, like isOriginalLook", () => {
    expect(isDefaultEdit({ ...DEFAULT_EDIT })).toBe(true);
    expect(isDefaultEdit({ ...DEFAULT_EDIT, denoise: null })).toBe(true);
    expect(isDefaultEdit({ ...DEFAULT_EDIT, denoise: { strength: 0, auto: false, source: "onnx" } })).toBe(true);
  });
});

describe("RESET_PATCH", () => {
  it("merges over a fully dirty edit back to the factory default", () => {
    const dirty: EditState = {
      ...DEFAULT_EDIT,
      exposure: 1,
      rotation: 90,
      retouches: [{ ...stroke }],
      preset: "Custom",
      sceneEnhance: { scene: "night", confidence: 0.8 },
      faceAdjust: { boxes: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], amount: 0.5, redEye: [], source: "onnx" },
      selectiveAdjust: {
        maskB64: "AA==", maskWidth: 1, maskHeight: 1,
        subject: { exposure: 0.5, contrast: 0, saturation: 0 },
        background: { exposure: 0, contrast: 0, saturation: 0 },
        source: "onnx",
      },
      denoise: { strength: 40, auto: true, source: "onnx" },
    };
    expect(isDefaultEdit(dirty)).toBe(false);
    // Same merge useEditor.change() performs: spread the patch, then resolve
    // the preset label with the real presetForPatch.
    const next = { ...dirty, ...RESET_PATCH };
    const present = { ...next, preset: presetForPatch(dirty.preset, RESET_PATCH) };
    expect(present.denoise).toBeNull();
    expect(isDefaultEdit(present)).toBe(true);
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
