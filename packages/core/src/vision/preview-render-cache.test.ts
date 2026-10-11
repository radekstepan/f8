import { describe, expect, it } from "vitest";
import { loadPreviewRender, previewRenderKey, savePreviewRender, stableStringify } from "./preview-render-cache.js";
import { DEFAULT_EDIT } from "../data.js";

describe("previewRenderKey", () => {
  it("is stable for identical inputs", () => {
    expect(previewRenderKey("p1", "src", DEFAULT_EDIT)).toBe(previewRenderKey("p1", "src", DEFAULT_EDIT));
  });

  it("ignores field construction order (state vs server round-trip)", () => {
    const reordered = Object.fromEntries(Object.entries(DEFAULT_EDIT).reverse());
    expect(previewRenderKey("p1", "src", reordered as typeof DEFAULT_EDIT)).toBe(
      previewRenderKey("p1", "src", DEFAULT_EDIT),
    );
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it("changes when any pixel-affecting state changes", () => {
    const base = previewRenderKey("p1", "src", DEFAULT_EDIT);
    expect(previewRenderKey("p2", "src", DEFAULT_EDIT)).not.toBe(base);
    expect(previewRenderKey("p1", "other-src", DEFAULT_EDIT)).not.toBe(base);
    expect(previewRenderKey("p1", "src", { ...DEFAULT_EDIT, exposure: 1 })).not.toBe(base);
    expect(previewRenderKey("p1", "src", { ...DEFAULT_EDIT, rotation: 90 })).not.toBe(base);
    expect(
      previewRenderKey("p1", "src", {
        ...DEFAULT_EDIT,
        retouches: [{ x: 0.2, y: 0.2, size: 0.1, strength: 100, kind: "repair" as const, stroke: 1 }],
      }),
    ).not.toBe(base);
  });
});

describe("preview render storage", () => {
  it("no-ops without IndexedDB (node) instead of throwing", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await expect(savePreviewRender("p1", "key", new Blob(["x"]))).resolves.toBeUndefined();
    await expect(loadPreviewRender("p1", "key")).resolves.toBeNull();
  });
});
