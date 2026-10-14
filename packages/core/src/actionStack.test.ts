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
  pushEnhanceAction,
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

describe("pushEnhanceAction", () => {
  const APPLIED_AT = "2026-10-14T00:00:00.000Z";
  const edit = {
    ...DEFAULT_EDIT,
    temperature: 6000,
    tint: 4,
    exposure: 0.5,
    contrast: 10,
    highlights: -10,
    shadows: 12,
    saturation: 6,
  };

  it("pushes the enhance entry plus one pure entry per category it turns on", () => {
    const stack = pushEnhanceAction([], "classic", edit, APPLIED_AT);
    expect(stack.map((item) => item.kind)).toEqual(["enhance", "whiteBalance", "lightness", "color"]);
    expect(stack.every((item) => item.pure)).toBe(true);
    expect(stack.every((item) => item.appliedAt === APPLIED_AT)).toBe(true);
    expect(actionEntry(stack, "enhance")).toMatchObject({ mode: "classic" });
    // Every entry snapshots the same pre-enhance recipe: the full look for
    // the whole-photo revert, the category keys for the per-section reverts.
    expect(actionEntry(stack, "whiteBalance")?.snapshot).toEqual({ temperature: 6000, tint: 4, whiteBalanceEnabled: true });
    expect(actionEntry(stack, "lightness")?.snapshot).toEqual({ exposure: 0.5, contrast: 10, highlights: -10, shadows: 12, lightnessEnabled: true });
    expect(actionEntry(stack, "color")?.snapshot).toEqual({ saturation: 6, colorEnabled: true });
    expect(actionEntry(stack, "enhance")?.snapshot).toMatchObject({ temperature: 6000, exposure: 0.5, saturation: 6 });
    // ...so the global Auto and all three per-section Autos highlight, each
    // with its own revert.
    expect(enhanceFromStack(stack)).toEqual({ mode: "classic", pure: true });
    expect(mlAppliedFromStack(stack)).toEqual({ whiteBalance: true, lightness: true, color: true });
    expect(mlRevertFromStack(stack)).toEqual({ whiteBalance: true, lightness: true, color: true });
  });

  it("drops stale category entries so reverts return to the pre-enhance recipe", () => {
    // A white-balance auto from before the enhance: its snapshot predates
    // the enhance, so the enhance replaces it with the pre-enhance values.
    const before = pushAction([], entry({ kind: "whiteBalance", pure: false, snapshot: { temperature: 5500, tint: 0 } }));
    const stack = pushEnhanceAction(before, "classic", edit, APPLIED_AT);
    expect(stack.map((item) => item.kind)).toEqual(["enhance", "whiteBalance", "lightness", "color"]);
    expect(actionEntry(stack, "whiteBalance")?.snapshot).toEqual({ temperature: 6000, tint: 4, whiteBalanceEnabled: true });
    expect(actionEntry(stack, "whiteBalance")?.pure).toBe(true);
  });

  it("keeps the earliest enhance snapshot on re-apply while refreshing the categories", () => {
    const first = pushEnhanceAction([], "classic", edit, APPLIED_AT);
    const tweaked = { ...edit, temperature: 6200 };
    const second = pushEnhanceAction(first, "classic", tweaked, "2026-10-14T01:00:00.000Z");
    // The whole-photo revert still returns to the un-enhanced recipe...
    expect(actionEntry(second, "enhance")?.snapshot).toMatchObject({ temperature: 6000 });
    // ...while the per-section reverts undo the latest enhance only.
    expect(actionEntry(second, "whiteBalance")?.snapshot).toEqual({ temperature: 6200, tint: 4, whiteBalanceEnabled: true });
    expect(second.map((item) => item.kind)).toEqual(["enhance", "whiteBalance", "lightness", "color"]);
  });

  it("lets one section revert without dropping the others", () => {
    const stack = pushEnhanceAction([], "scene", edit, APPLIED_AT);
    const reverted = revertAction(stack, "whiteBalance");
    expect(reverted?.snapshot).toEqual({ temperature: 6000, tint: 4, whiteBalanceEnabled: true });
    expect(reverted?.stack.map((item) => item.kind)).toEqual(["enhance", "lightness", "color"]);
    // Restoring the snapshot is a look change (the hook reverts unguarded),
    // so the enhance highlight drops with the reverted section while the
    // untouched sections stay lit.
    const settled = clearPureOnPatch(reverted!.stack, reverted!.snapshot);
    expect(enhanceFromStack(settled)).toEqual({ mode: "scene", pure: false });
    expect(mlAppliedFromStack(settled)).toEqual({ lightness: true, color: true });
    expect(mlRevertFromStack(settled)).toEqual({ lightness: true, color: true });
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
