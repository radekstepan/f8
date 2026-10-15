import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT, isDefaultEdit, isOriginalLook } from "./data.js";
import type { EditState } from "./types.js";
import { solidColor } from "./vision/fixtures.js";
import type { PixelImage } from "./vision/analyze.js";
import {
  SHARPNESS_RADIUS,
  clarityRadiusForSize,
  highlightWeight,
  isNeutralEdit,
  midtoneWeight,
  renderAdjustedPixels,
  shadowWeight,
  textureRadiusForSize,
} from "./adjustments.js";
import {
  SELECTIVE_CLARITY_RANGES,
  SELECTIVE_DETAIL_RESPONSE,
  isSelectiveClarityActive,
  isSelectiveClarityParamsNeutral,
  normalizeSelectiveClarity,
  resolveSelectiveClarity,
  selectiveClarityParams,
  selectiveClarityWeight,
  selectiveDetailScales,
  setSelectiveClarityRange,
} from "./selective-clarity.js";

const edit = (patch: Partial<EditState>): EditState => ({ ...DEFAULT_EDIT, ...patch });

/** Grayscale checkerboard: alternating lo/hi per pixel, alpha opaque. */
function checkerboard(width: number, height: number, lo: number, hi: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (x + y) % 2 === 0 ? lo : hi;
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Left half dark checker, right half bright checker: one fixture serves both targeting directions. */
function splitChecker(size: number): PixelImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dark = x < size / 2;
      const value = (x + y) % 2 === 0 ? (dark ? 20 : 200) : (dark ? 70 : 250);
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** True when every byte of one half (x < size/2, or x >= size/2) matches. */
function halfIdentical(a: PixelImage, b: PixelImage, left: boolean): boolean {
  const { width, height } = a;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x < width / 2) !== left) continue;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        if (a.data[i + c] !== b.data[i + c]) return false;
      }
    }
  }
  return true;
}

describe("selective clarity ranges", () => {
  it("lists Photomator's three ranges in tonal order", () => {
    expect(SELECTIVE_CLARITY_RANGES.map((meta) => meta.range)).toEqual([
      "shadows", "midtones", "highlights",
    ]);
    for (const meta of SELECTIVE_CLARITY_RANGES) {
      expect(meta.label).toBeTruthy();
      expect(meta.swatch).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("peaks each range on its tones and cuts it off outside", () => {
    expect(selectiveClarityWeight(0, "shadows")).toBe(1);
    expect(selectiveClarityWeight(0.55, "shadows")).toBe(0);
    expect(selectiveClarityWeight(1, "shadows")).toBe(0);
    expect(selectiveClarityWeight(0.5, "midtones")).toBeCloseTo(1, 10);
    expect(selectiveClarityWeight(0, "midtones")).toBe(0);
    expect(selectiveClarityWeight(0.45, "highlights")).toBe(0);
    expect(selectiveClarityWeight(1, "highlights")).toBe(1);
  });

  it("uses the same tonal bells as the global sliders", () => {
    // "Shadows" must mean the same tones in both places: the equality is
    // pinned here because the weight lives in this module (dependency-free
    // like selective-color.ts) rather than imported from adjustments.ts.
    for (let step = 0; step <= 100; step += 1) {
      const luminance = step / 100;
      expect(selectiveClarityWeight(luminance, "shadows")).toBeCloseTo(shadowWeight(luminance), 10);
      expect(selectiveClarityWeight(luminance, "midtones")).toBeCloseTo(midtoneWeight(luminance), 10);
      expect(selectiveClarityWeight(luminance, "highlights")).toBeCloseTo(highlightWeight(luminance), 10);
    }
  });

  it("owns every luminance with at least one range", () => {
    for (let step = 0; step <= 100; step += 1) {
      const luminance = step / 100;
      const total =
        selectiveClarityWeight(luminance, "shadows") +
        selectiveClarityWeight(luminance, "midtones") +
        selectiveClarityWeight(luminance, "highlights");
      expect(total, `luminance ${luminance}`).toBeGreaterThan(0);
    }
  });
});

describe("selective clarity recipe helpers", () => {
  it("normalizes garbage to the empty identity", () => {
    expect(normalizeSelectiveClarity(null)).toEqual([]);
    expect(normalizeSelectiveClarity("shadows")).toEqual([]);
    expect(normalizeSelectiveClarity([{ range: "chartreuse", texture: 50 }])).toEqual([]);
    expect(normalizeSelectiveClarity([null, 42, { range: "shadows" }])).toEqual([]);
  });

  it("clamps sliders, prunes neutrals, and sorts in range order", () => {
    expect(normalizeSelectiveClarity([
      { range: "highlights", texture: 0, clarity: 500 },
      { range: "shadows", texture: 0, clarity: 0 },
      { range: "shadows", texture: NaN, clarity: 10 },
    ])).toEqual([
      { range: "shadows", texture: 0, clarity: 10 },
      { range: "highlights", texture: 0, clarity: 100 },
    ]);
  });

  it("lets the last entry win per range", () => {
    expect(normalizeSelectiveClarity([
      { range: "midtones", texture: 10, clarity: 0 },
      { range: "midtones", texture: 20, clarity: 0 },
    ])).toEqual([{ range: "midtones", texture: 20, clarity: 0 }]);
  });

  it("detects activity without normalizing", () => {
    expect(isSelectiveClarityActive([])).toBe(false);
    expect(isSelectiveClarityActive(null)).toBe(false);
    expect(isSelectiveClarityActive([{ range: "shadows", texture: 0, clarity: 0 }])).toBe(false);
    expect(isSelectiveClarityActive([{ range: "nope", texture: 50, clarity: 0 }])).toBe(false);
    expect(isSelectiveClarityActive([{ range: "highlights", texture: -100, clarity: 0 }])).toBe(true);
  });

  it("reads one range's params with a neutral fallback", () => {
    expect(selectiveClarityParams([], "shadows")).toEqual({ texture: 0, clarity: 0 });
    expect(selectiveClarityParams([{ range: "shadows", texture: 10, clarity: 20 }], "shadows")).toEqual({
      texture: 10, clarity: 20,
    });
    expect(selectiveClarityParams([{ range: "shadows", texture: 10, clarity: 20 }], "highlights")).toEqual({
      texture: 0, clarity: 0,
    });
  });

  it("patches one range without mutating the input", () => {
    const before = [{ range: "shadows" as const, texture: 10, clarity: 0 }];
    const next = setSelectiveClarityRange(before, "highlights", { clarity: -50 });
    expect(next).toEqual([
      { range: "shadows", texture: 10, clarity: 0 },
      { range: "highlights", texture: 0, clarity: -50 },
    ]);
    expect(before).toEqual([{ range: "shadows", texture: 10, clarity: 0 }]);
  });

  it("prunes a range dragged back to neutral", () => {
    const next = setSelectiveClarityRange(
      [{ range: "shadows", texture: 10, clarity: 0 }],
      "shadows",
      { texture: 0 },
    );
    expect(next).toEqual([]);
  });

  it("resolves to null while neutral and to scaled pairs otherwise", () => {
    expect(resolveSelectiveClarity([])).toBeNull();
    const packed = resolveSelectiveClarity([{ range: "shadows", texture: 100, clarity: -50 }]);
    expect(packed).not.toBeNull();
    expect(packed!.length).toBe(SELECTIVE_CLARITY_RANGES.length * 2);
    expect(packed![0]).toBeCloseTo(1, 5);
    expect(packed![1]).toBeCloseTo(-0.5, 5);
    // Untouched ranges pack as zeros so the pixel loop skips them.
    expect(packed![2]).toBe(0);
    expect(packed![3]).toBe(0);
  });

  it("treats non-finite sliders as neutral", () => {
    expect(isSelectiveClarityParamsNeutral({ texture: NaN, clarity: 0 })).toBe(true);
    expect(isSelectiveClarityActive([{ range: "shadows", texture: NaN, clarity: 0 }])).toBe(false);
  });
});

describe("selective detail scales", () => {
  it("matches the global clarity response", () => {
    // Texture and Clarity differ only in frequency: both ride the global
    // clarity gain at full strength.
    expect(SELECTIVE_DETAIL_RESPONSE).toBe(1.5);
  });

  it("accumulates range weights into per-pixel slider scales", () => {
    const packed = resolveSelectiveClarity([
      { range: "shadows", texture: 0, clarity: 100 },
      { range: "highlights", texture: -50, clarity: 0 },
    ])!;
    // Deep shadows: full clarity scale, no texture scale.
    expect(selectiveDetailScales(0, packed)).toEqual([0, 1]);
    // Bright highlights: half texture scale, no clarity scale.
    const [texture, clarity] = selectiveDetailScales(1, packed);
    expect(texture).toBeCloseTo(-0.5, 5);
    expect(clarity).toBe(0);
  });

  it("sits the texture radius between sharpness and clarity at every size", () => {
    for (const size of [8, 64, 600, 4000]) {
      expect(textureRadiusForSize(size, size)).toBeGreaterThanOrEqual(SHARPNESS_RADIUS);
      expect(textureRadiusForSize(size, size)).toBeLessThanOrEqual(clarityRadiusForSize(size, size));
    }
    // And strictly between the two at typical photo sizes, so each
    // detail control owns its own frequency band.
    expect(textureRadiusForSize(600, 600)).toBeGreaterThan(SHARPNESS_RADIUS);
    expect(textureRadiusForSize(600, 600)).toBeLessThan(clarityRadiusForSize(600, 600));
  });
});

describe("selective clarity pipeline", () => {
  it("marks the edit non-neutral and off-default while active", () => {
    const neutral = edit({ selectiveClarity: [] });
    expect(isNeutralEdit(neutral)).toBe(true);
    expect(isDefaultEdit(neutral)).toBe(true);
    expect(isOriginalLook(neutral)).toBe(true);
    const tweaked = edit({ selectiveClarity: [{ range: "shadows", texture: 0, clarity: 100 }] });
    expect(isNeutralEdit(tweaked)).toBe(false);
    expect(isDefaultEdit(tweaked)).toBe(false);
    expect(isOriginalLook(tweaked)).toBe(false);
  });

  it("renders byte-identical pixels while the list is neutral", () => {
    const source = checkerboard(16, 16, 20, 250);
    const rendered = renderAdjustedPixels(source, edit({ selectiveClarity: [] }));
    expect(rendered.data).toEqual(source.data);
  });

  it("drives shadows clarity into dark detail only", () => {
    const source = splitChecker(16);
    const rendered = renderAdjustedPixels(
      source,
      edit({ selectiveClarity: [{ range: "shadows", texture: 0, clarity: 100 }] }),
    );
    // Bright half passes through byte-identical: the shadows bell is
    // exactly zero up there, so the loop skips those pixels.
    expect(halfIdentical(source, rendered, false)).toBe(true);
    expect(halfIdentical(source, rendered, true)).toBe(false);
    expect(rendered.data[3]).toBe(255);
  });

  it("drives highlights texture into bright detail only", () => {
    const source = splitChecker(16);
    const rendered = renderAdjustedPixels(
      source,
      edit({ selectiveClarity: [{ range: "highlights", texture: 100, clarity: 0 }] }),
    );
    expect(halfIdentical(source, rendered, true)).toBe(true);
    expect(halfIdentical(source, rendered, false)).toBe(false);
  });

  it("ignores the Details toggle while global clarity obeys it", () => {
    // Selective Clarity is its own section (the Selective Color
    // precedent): a legacy-disabled Details must not bypass it.
    const source = checkerboard(16, 16, 20, 70);
    const gated = renderAdjustedPixels(source, edit({ detailsEnabled: false, clarity: 100 }));
    expect(gated.data).toEqual(source.data);
    const selective = renderAdjustedPixels(
      source,
      edit({ detailsEnabled: false, selectiveClarity: [{ range: "shadows", texture: 0, clarity: 100 }] }),
    );
    expect(selective.data).not.toEqual(source.data);
  });

  it("stacks with global clarity on the shared wide blur", () => {
    const source = solidColor(24, 24, 128, 128, 128);
    // One bright bar gives the wide blur something to bite on.
    for (let y = 0; y < 24; y += 1) {
      for (let x = 8; x < 16; x += 1) {
        const i = (y * 24 + x) * 4;
        source.data[i] = 200;
        source.data[i + 1] = 200;
        source.data[i + 2] = 200;
      }
    }
    const global = renderAdjustedPixels(source, edit({ clarity: 100 }));
    expect(global.data).not.toEqual(source.data);
    const both = renderAdjustedPixels(
      source,
      edit({ clarity: 100, selectiveClarity: [{ range: "midtones", texture: 0, clarity: 100 }] }),
    );
    // Same-sign deltas on the same blur: the stack must exceed global alone.
    expect(both.data).not.toEqual(global.data);
  });
});
