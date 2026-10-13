import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import {
  actionEntry,
  clearCategoryActions,
  clearEnhanceAction,
  clearPureOnPatch,
  enhanceFromStack,
  mlAppliedFromStack,
  mlRevertFromStack,
  pushAction,
  revertAction,
  sanitizeActionStack,
  snapshotForEnhance,
} from "./actionStack.js";
import type { ActionStack, ActionStackEntry } from "./actionStack.js";

function entry(overrides: Partial<ActionStackEntry> & { kind: ActionStackEntry["kind"] }): ActionStackEntry {
  return {
    pure: true,
    snapshot: { exposure: 0 },
    appliedAt: "2026-10-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("action stack", () => {
  it("pushes new kinds and refreshes repeats while keeping the earliest snapshot", () => {
    const first = entry({ kind: "whiteBalance", snapshot: { temperature: 5500, tint: 0 } });
    let stack = pushAction([], first);
    expect(stack).toHaveLength(1);

    stack = pushAction(stack, entry({ kind: "lightness", snapshot: { exposure: 0 } }));
    expect(stack.map((item) => item.kind)).toEqual(["whiteBalance", "lightness"]);

    // A re-apply refreshes flags in place (stable order) but the revert
    // still returns to the pre-auto recipe, never the intermediate values.
    const reapplied = pushAction(
      stack,
      entry({ kind: "whiteBalance", pure: true, snapshot: { temperature: 6500, tint: 4 }, appliedAt: "2026-10-13T01:00:00.000Z" }),
    );
    expect(reapplied.map((item) => item.kind)).toEqual(["whiteBalance", "lightness"]);
    expect(actionEntry(reapplied, "whiteBalance")?.snapshot).toEqual({ temperature: 5500, tint: 0 });
    expect(actionEntry(reapplied, "whiteBalance")?.appliedAt).toBe("2026-10-13T01:00:00.000Z");
  });

  it("reverts one action, returning its snapshot and dropping only that entry", () => {
    const stack: ActionStack = [
      entry({ kind: "enhance", mode: "scene", snapshot: { exposure: 0.1 } }),
      entry({ kind: "color", snapshot: { saturation: 0 } }),
    ];
    const reverted = revertAction(stack, "enhance");
    expect(reverted?.snapshot).toEqual({ exposure: 0.1 });
    expect(reverted?.stack.map((item) => item.kind)).toEqual(["color"]);
    expect(revertAction(stack, "whiteBalance")).toBeNull();
  });

  it("clears enhance and category entries independently", () => {
    const stack: ActionStack = [
      entry({ kind: "enhance", snapshot: { exposure: 0 } }),
      entry({ kind: "whiteBalance", snapshot: { temperature: 5500 } }),
      entry({ kind: "lightness", snapshot: { exposure: 0 } }),
    ];
    expect(clearEnhanceAction(stack).map((item) => item.kind)).toEqual(["whiteBalance", "lightness"]);
    expect(clearCategoryActions(stack).map((item) => item.kind)).toEqual(["enhance"]);
    expect(clearEnhanceAction([])).toEqual([]);
  });

  it("clears pure for touched entries on manual edits, keeping every snapshot", () => {
    const stack: ActionStack = [
      entry({ kind: "enhance", snapshot: { exposure: 0 } }),
      entry({ kind: "whiteBalance", snapshot: { temperature: 5500 } }),
      entry({ kind: "lightness", snapshot: { exposure: 0 } }),
    ];
    // A white-balance slider move drops the white-balance highlight and the
    // enhance highlight (any look change breaks enhance purity) but keeps
    // the lightness highlight and every snapshot.
    const next = clearPureOnPatch(stack, { temperature: 6000 });
    expect(next).not.toBe(stack);
    expect(actionEntry(next, "enhance")?.pure).toBe(false);
    expect(actionEntry(next, "whiteBalance")?.pure).toBe(false);
    expect(actionEntry(next, "lightness")?.pure).toBe(true);
    expect(next.map((item) => item.kind)).toEqual(["enhance", "whiteBalance", "lightness"]);

    // Geometry-only patches leave every highlight alone (same input back).
    expect(clearPureOnPatch(stack, { rotation: 90, cropRatio: "1:1" })).toBe(stack);
    expect(clearPureOnPatch([], { exposure: 1 })).toEqual([]);
  });

  it("snapshots the enhanceable look without geometry, retouches, or ML states", () => {
    const snapshot = snapshotForEnhance({
      ...DEFAULT_EDIT,
      exposure: 0.5,
      rotation: 90,
      retouches: [{ x: 1, y: 2, size: 3, strength: 4, kind: "repair" }],
      faceAdjust: { boxes: [], amount: 0.5, redEye: [], source: "onnx" },
      selectiveAdjust: null,
      denoise: { strength: 10, auto: false, source: "classic" },
    });
    expect(snapshot.exposure).toBe(0.5);
    expect(snapshot.preset).toBe("Original");
    for (const key of ["rotation", "flipH", "flipV", "straighten", "cropRatio", "retouches", "faceAdjust", "selectiveAdjust", "denoise"] as const) {
      expect(snapshot).not.toHaveProperty(key);
    }
  });

  it("derives the enhance and per-category UI state from the stack", () => {
    expect(enhanceFromStack([])).toBeNull();
    expect(mlAppliedFromStack([])).toEqual({});
    expect(mlRevertFromStack([])).toEqual({});

    const stack: ActionStack = [
      entry({ kind: "enhance", mode: "scene", pure: false, snapshot: { exposure: 0 } }),
      entry({ kind: "whiteBalance", pure: true, snapshot: { temperature: 5500 } }),
    ];
    expect(enhanceFromStack(stack)).toEqual({ mode: "scene", pure: false });
    expect(mlAppliedFromStack(stack)).toEqual({ whiteBalance: true });
    expect(mlRevertFromStack(stack)).toEqual({ whiteBalance: true });
    // A manually-touched category keeps its revert without its highlight.
    const touched = clearPureOnPatch(stack, { temperature: 6000 });
    expect(mlAppliedFromStack(touched)).toEqual({});
    expect(mlRevertFromStack(touched)).toEqual({ whiteBalance: true });
  });
});

describe("sanitizeActionStack", () => {
  it("passes a well-formed stack through", () => {
    const stack: ActionStack = [
      entry({ kind: "enhance", mode: "scene", snapshot: { exposure: 0.1, preset: "Original" } }),
      entry({ kind: "color", pure: false, snapshot: { saturation: 0, colorEnabled: true } }),
    ];
    expect(sanitizeActionStack(JSON.parse(JSON.stringify(stack)))).toEqual(stack);
  });

  it("drops unknown kinds, duplicates, and entries without a snapshot or timestamp", () => {
    expect(
      sanitizeActionStack([
        entry({ kind: "whiteBalance", snapshot: { temperature: 5500 } }),
        { kind: "straighten", pure: true, snapshot: { straighten: 0 }, appliedAt: "2026-10-13T00:00:00.000Z" },
        entry({ kind: "whiteBalance", snapshot: { temperature: 6000 } }),
        { kind: "color", pure: true, snapshot: {}, appliedAt: "2026-10-13T00:00:00.000Z" },
        { kind: "lightness", pure: true, snapshot: { exposure: 0 } },
        { kind: "lightness", pure: true, snapshot: null, appliedAt: "2026-10-13T00:00:00.000Z" },
      ]),
    ).toEqual([entry({ kind: "whiteBalance", snapshot: { temperature: 5500 } })]);
  });

  it("strips unknown snapshot keys and defaults the enhance mode", () => {
    expect(
      sanitizeActionStack([
        { kind: "enhance", pure: true, snapshot: { exposure: 0, bogus: 1 }, appliedAt: "2026-10-13T00:00:00.000Z" },
      ]),
    ).toEqual([entry({ kind: "enhance", mode: "classic", snapshot: { exposure: 0 } })]);
  });

  it("never throws on garbage", () => {
    for (const value of [null, undefined, {}, "stack", 42, [null, 42, "x", []]]) {
      expect(sanitizeActionStack(value)).toEqual([]);
    }
  });
});
