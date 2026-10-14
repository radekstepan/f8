import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import {
  actionEntry,
  clearCategoryActions,
  clearEnhanceAction,
  clearPureOnPatch,
  enhanceFromStack,
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

  it("derives the enhance UI state from the stack, ignoring legacy category entries", () => {
    expect(enhanceFromStack([])).toBeNull();

    const stack: ActionStack = [
      entry({ kind: "enhance", mode: "scene", pure: false, snapshot: { exposure: 0 } }),
      entry({ kind: "whiteBalance", pure: true, snapshot: { temperature: 5500 } }),
    ];
    expect(enhanceFromStack(stack)).toEqual({ mode: "scene", pure: false });
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

  it("pushes the enhance entry alone: section toggles light from the dirty values", () => {
    const stack = pushEnhanceAction([], "classic", edit, APPLIED_AT);
    expect(stack.map((item) => item.kind)).toEqual(["enhance"]);
    expect(stack.every((item) => item.pure)).toBe(true);
    expect(stack.every((item) => item.appliedAt === APPLIED_AT)).toBe(true);
    expect(actionEntry(stack, "enhance")).toMatchObject({ mode: "classic" });
    expect(actionEntry(stack, "enhance")?.snapshot).toMatchObject({ temperature: 6000, exposure: 0.5, saturation: 6 });
    expect(enhanceFromStack(stack)).toEqual({ mode: "classic", pure: true });
  });

  it("drops legacy category entries instead of refreshing them", () => {
    // A pre-toggle white-balance entry: the enhance sheds it rather than
    // replacing it, since nothing reads category entries anymore.
    const before = pushAction([], entry({ kind: "whiteBalance", pure: false, snapshot: { temperature: 5500, tint: 0 } }));
    const stack = pushEnhanceAction(before, "classic", edit, APPLIED_AT);
    expect(stack.map((item) => item.kind)).toEqual(["enhance"]);
    expect(actionEntry(stack, "whiteBalance")).toBeUndefined();
  });

  it("keeps the earliest enhance snapshot on re-apply", () => {
    const first = pushEnhanceAction([], "classic", edit, APPLIED_AT);
    const tweaked = { ...edit, temperature: 6200 };
    const second = pushEnhanceAction(first, "classic", tweaked, "2026-10-14T01:00:00.000Z");
    // The whole-photo revert still returns to the un-enhanced recipe.
    expect(actionEntry(second, "enhance")?.snapshot).toMatchObject({ temperature: 6000 });
    expect(second.map((item) => item.kind)).toEqual(["enhance"]);
  });

  it("drops the enhance highlight on the next look change, keeping the revert", () => {
    const stack = pushEnhanceAction([], "scene", edit, APPLIED_AT);
    // Toggling a section off is a look change through the normal
    // manual-edit path, so the enhance highlight drops with it while the
    // whole-photo revert stays available.
    const settled = clearPureOnPatch(stack, { exposure: 0, contrast: 0 });
    expect(enhanceFromStack(settled)).toEqual({ mode: "scene", pure: false });
    expect(actionEntry(settled, "enhance")?.snapshot).toMatchObject({ temperature: 6000 });
  });
});

describe("sanitizeActionStack", () => {
  it("passes a well-formed stack through", () => {
    const stack: ActionStack = [
      entry({ kind: "enhance", mode: "scene", snapshot: { exposure: 0.1, preset: "Original" } }),
    ];
    expect(sanitizeActionStack(JSON.parse(JSON.stringify(stack)))).toEqual(stack);
  });

  it("drops legacy category entries, unknown kinds, duplicates, and entries without a snapshot or timestamp", () => {
    expect(
      sanitizeActionStack([
        entry({ kind: "enhance", mode: "scene", snapshot: { exposure: 0.1 } }),
        entry({ kind: "whiteBalance", snapshot: { temperature: 5500 } }),
        { kind: "straighten", pure: true, snapshot: { straighten: 0 }, appliedAt: "2026-10-13T00:00:00.000Z" },
        entry({ kind: "enhance", mode: "classic", snapshot: { exposure: 0.2 } }),
        { kind: "color", pure: true, snapshot: {}, appliedAt: "2026-10-13T00:00:00.000Z" },
        { kind: "enhance", pure: true, snapshot: { exposure: 0 } },
        { kind: "lightness", pure: true, snapshot: null, appliedAt: "2026-10-13T00:00:00.000Z" },
      ]),
    ).toEqual([entry({ kind: "enhance", mode: "scene", snapshot: { exposure: 0.1 } })]);
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
