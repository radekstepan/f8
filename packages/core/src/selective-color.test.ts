import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import type { EditState } from "./types.js";
import { solidColor } from "./vision/fixtures.js";
import { isNeutralEdit, renderAdjustedPixels } from "./adjustments.js";
import {
  SELECTIVE_COLOR_HUE_RESPONSE,
  SELECTIVE_COLOR_LUMINANCE_RESPONSE,
  SELECTIVE_COLOR_RANGES,
  applySelectiveColor,
  hslToRgb,
  isSelectiveColorActive,
  isSelectiveColorParamsNeutral,
  normalizeSelectiveColor,
  resolveSelectiveColor,
  rgbToHsl,
  selectiveColorParams,
  selectiveColorWeight,
  selectiveHueDistance,
  setSelectiveColorRange,
} from "./selective-color.js";

const edit = (patch: Partial<EditState>): EditState => ({ ...DEFAULT_EDIT, ...patch });

describe("selective hue distance", () => {
  it("wraps around the red boundary", () => {
    expect(selectiveHueDistance(350, 0)).toBe(10);
    expect(selectiveHueDistance(10, 350)).toBe(20);
    expect(selectiveHueDistance(180, 0)).toBe(180);
  });
});

describe("selective color ranges", () => {
  it("lists Photomator's eleven ranges in order", () => {
    expect(SELECTIVE_COLOR_RANGES.map((meta) => meta.range)).toEqual([
      "reds", "oranges", "yellows", "greens",
      "aquas", "blues", "purples", "magentas",
      "whites", "neutrals", "blacks",
    ]);
    for (const meta of SELECTIVE_COLOR_RANGES) {
      expect(meta.label).toBeTruthy();
      expect(meta.swatch).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("covers every hue with at least one chromatic range", () => {
    // No dead gaps: each whole-degree hue scores > 0 on some band, and the
    // peak band owns its center fully.
    for (let hue = 0; hue < 360; hue += 1) {
      let total = 0;
      for (const meta of SELECTIVE_COLOR_RANGES) {
        if (meta.center === undefined) continue;
        total += selectiveColorWeight(hue, 1, 0.5, meta.range);
      }
      expect(total, `hue ${hue}`).toBeGreaterThan(0);
    }
    for (const meta of SELECTIVE_COLOR_RANGES) {
      if (meta.center === undefined) continue;
      expect(selectiveColorWeight(meta.center, 1, 0.5, meta.range)).toBeCloseTo(1, 10);
    }
  });

  it("peaks the achromatic bands on grays by lightness", () => {
    expect(selectiveColorWeight(0, 0, 1, "whites")).toBe(1);
    expect(selectiveColorWeight(0, 0, 0, "whites")).toBe(0);
    expect(selectiveColorWeight(0, 0, 0.5, "neutrals")).toBeCloseTo(1, 10);
    expect(selectiveColorWeight(0, 0, 0, "neutrals")).toBe(0);
    expect(selectiveColorWeight(0, 0, 1, "neutrals")).toBeCloseTo(0, 10);
    expect(selectiveColorWeight(0, 0, 0, "blacks")).toBe(1);
    expect(selectiveColorWeight(0, 0, 1, "blacks")).toBe(0);
  });

  it("keeps chromatic ranges off grays and achromatic bands off vivid colors", () => {
    for (const meta of SELECTIVE_COLOR_RANGES) {
      if (meta.center === undefined) continue;
      expect(selectiveColorWeight(meta.center, 0, 0.5, meta.range)).toBe(0);
    }
    expect(selectiveColorWeight(240, 1, 0.5, "whites")).toBe(0);
    expect(selectiveColorWeight(240, 1, 0.5, "neutrals")).toBe(0);
    expect(selectiveColorWeight(240, 1, 0.5, "blacks")).toBe(0);
  });
});

describe("rgb/hsl conversion", () => {
  it("maps the primaries to their hues", () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 1, 0.5]);
    expect(rgbToHsl(0, 255, 0)[0]).toBeCloseTo(120, 10);
    expect(rgbToHsl(0, 0, 255)[0]).toBeCloseTo(240, 10);
    expect(rgbToHsl(128, 128, 128)).toEqual([0, 0, 128 / 255]);
  });

  it("round-trips bytes within one level", () => {
    const samples: Array<[number, number, number]> = [
      [255, 0, 0], [12, 200, 90], [200, 150, 40], [33, 33, 33], [250, 240, 230],
    ];
    for (const [r, g, b] of samples) {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [rr, gg, bb] = hslToRgb(h, s, l);
      expect(Math.abs(rr - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(gg - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(bb - b)).toBeLessThanOrEqual(1);
    }
  });
});

describe("selective color recipe helpers", () => {
  it("normalizes garbage to the empty identity", () => {
    expect(normalizeSelectiveColor(null)).toEqual([]);
    expect(normalizeSelectiveColor("reds")).toEqual([]);
    expect(normalizeSelectiveColor([{ range: "chartreuse", hue: 50 }])).toEqual([]);
    expect(normalizeSelectiveColor([null, 42, { range: "reds" }])).toEqual([]);
  });

  it("clamps sliders, prunes neutrals, and sorts in range order", () => {
    expect(normalizeSelectiveColor([
      { range: "blues", hue: 0, saturation: 500, luminance: -500 },
      { range: "reds", hue: 0, saturation: 0, luminance: 0 },
      { range: "reds", hue: NaN, saturation: 10, luminance: 0 },
    ])).toEqual([
      { range: "reds", hue: 0, saturation: 10, luminance: 0 },
      { range: "blues", hue: 0, saturation: 100, luminance: -100 },
    ]);
  });

  it("lets the last entry win per range", () => {
    expect(normalizeSelectiveColor([
      { range: "greens", hue: 10, saturation: 0, luminance: 0 },
      { range: "greens", hue: 20, saturation: 0, luminance: 0 },
    ])).toEqual([{ range: "greens", hue: 20, saturation: 0, luminance: 0 }]);
  });

  it("detects activity without normalizing", () => {
    expect(isSelectiveColorActive([])).toBe(false);
    expect(isSelectiveColorActive(null)).toBe(false);
    expect(isSelectiveColorActive([{ range: "reds", hue: 0, saturation: 0, luminance: 0 }])).toBe(false);
    expect(isSelectiveColorActive([{ range: "nope", hue: 50, saturation: 0, luminance: 0 }])).toBe(false);
    expect(isSelectiveColorActive([{ range: "blues", hue: 0, saturation: -100, luminance: 0 }])).toBe(true);
  });

  it("reads one range's params with a neutral fallback", () => {
    expect(selectiveColorParams([], "reds")).toEqual({ hue: 0, saturation: 0, luminance: 0 });
    expect(selectiveColorParams([{ range: "reds", hue: 10, saturation: 20, luminance: 30 }], "reds")).toEqual({
      hue: 10, saturation: 20, luminance: 30,
    });
    expect(selectiveColorParams([{ range: "reds", hue: 10, saturation: 20, luminance: 30 }], "blues")).toEqual({
      hue: 0, saturation: 0, luminance: 0,
    });
  });

  it("patches one range without mutating the input", () => {
    const before = [{ range: "reds" as const, hue: 10, saturation: 0, luminance: 0 }];
    const next = setSelectiveColorRange(before, "blues", { saturation: -50 });
    expect(next).toEqual([
      { range: "reds", hue: 10, saturation: 0, luminance: 0 },
      { range: "blues", hue: 0, saturation: -50, luminance: 0 },
    ]);
    expect(before).toEqual([{ range: "reds", hue: 10, saturation: 0, luminance: 0 }]);
  });

  it("prunes a range dragged back to neutral", () => {
    const next = setSelectiveColorRange(
      [{ range: "reds", hue: 10, saturation: 0, luminance: 0 }],
      "reds",
      { hue: 0 },
    );
    expect(next).toEqual([]);
  });

  it("resolves to null while neutral and to scaled triples otherwise", () => {
    expect(resolveSelectiveColor([])).toBeNull();
    const packed = resolveSelectiveColor([{ range: "reds", hue: 100, saturation: -50, luminance: 40 }]);
    expect(packed).not.toBeNull();
    expect(packed!.length).toBe(SELECTIVE_COLOR_RANGES.length * 3);
    expect(packed![0]).toBeCloseTo(100 * SELECTIVE_COLOR_HUE_RESPONSE, 5);
    expect(packed![1]).toBeCloseTo(-0.5, 5);
    expect(packed![2]).toBeCloseTo(40 * SELECTIVE_COLOR_LUMINANCE_RESPONSE / 100, 5);
    // Untouched ranges pack as zeros so the pixel loop skips them.
    expect(packed![3]).toBe(0);
  });

  it("treats non-finite sliders as neutral", () => {
    expect(isSelectiveColorParamsNeutral({ hue: NaN, saturation: 0, luminance: 0 })).toBe(true);
    expect(isSelectiveColorActive([{ range: "reds", hue: NaN, saturation: 0, luminance: 0 }])).toBe(false);
  });
});

describe("applySelectiveColor", () => {
  it("desaturates only the targeted hue", () => {
    const packed = resolveSelectiveColor([{ range: "blues", hue: 0, saturation: -100, luminance: 0 }])!;
    // Mid-lightness gray (the pipeline's final clamp rounds 127.5 to 128).
    expect(applySelectiveColor(0, 0, 255, packed)).toEqual([127.5, 127.5, 127.5]);
    expect(applySelectiveColor(255, 0, 0, packed)).toEqual([255, 0, 0]);
  });

  it("shifts hue by the slider response", () => {
    // Reds +100 rotates pure red 60° onto yellow.
    const packed = resolveSelectiveColor([{ range: "reds", hue: 100, saturation: 0, luminance: 0 }])!;
    const [r, g, b] = applySelectiveColor(255, 0, 0, packed);
    expect(r).toBeCloseTo(255, 0);
    expect(g).toBeCloseTo(255, 0);
    expect(b).toBeCloseTo(0, 0);
  });

  it("lifts light grays with whites while leaving mid gray alone", () => {
    const packed = resolveSelectiveColor([{ range: "whites", hue: 0, saturation: 0, luminance: 100 }])!;
    expect(applySelectiveColor(128, 128, 128, packed)).toEqual([128, 128, 128]);
    const [r, g, b] = applySelectiveColor(204, 204, 204, packed);
    expect(r).toBeGreaterThan(204);
    expect([r, g, b]).toEqual([r, r, r]);
  });

  it("darkens mid gray with neutrals and deepens black with blacks", () => {
    const neutrals = resolveSelectiveColor([{ range: "neutrals", hue: 0, saturation: 0, luminance: -100 }])!;
    const [r] = applySelectiveColor(128, 128, 128, neutrals);
    expect(r!).toBeLessThan(20);
    const blacks = resolveSelectiveColor([{ range: "blacks", hue: 0, saturation: 0, luminance: 50 }])!;
    const [br] = applySelectiveColor(10, 10, 10, blacks);
    expect(br!).toBeGreaterThan(10);
  });

  it("leaves vivid colors alone for achromatic tweaks", () => {
    const packed = resolveSelectiveColor([{ range: "neutrals", hue: 0, saturation: 0, luminance: -100 }])!;
    expect(applySelectiveColor(0, 0, 255, packed)).toEqual([0, 0, 255]);
  });
});

describe("selective color pipeline", () => {
  it("marks the edit non-neutral and renders only matching hues", () => {
    const neutral = edit({ selectiveColor: [] });
    expect(isNeutralEdit(neutral)).toBe(true);
    const tweaked = edit({ selectiveColor: [{ range: "blues", hue: 0, saturation: -100, luminance: 0 }] });
    expect(isNeutralEdit(tweaked)).toBe(false);
    const source = solidColor(2, 1, 255, 0, 0);
    source.data[4] = 0;
    source.data[5] = 0;
    source.data[6] = 255;
    const rendered = renderAdjustedPixels(source, tweaked);
    // Untouched red pixel passes through byte-identical.
    expect([rendered.data[0], rendered.data[1], rendered.data[2]]).toEqual([255, 0, 0]);
    // Blue pixel desaturates to gray.
    expect([rendered.data[4], rendered.data[5], rendered.data[6]]).toEqual([128, 128, 128]);
    expect(rendered.data[3]).toBe(255);
    expect(rendered.data[7]).toBe(255);
  });

  it("renders byte-identical pixels while the list is neutral", () => {
    const source = solidColor(2, 2, 12, 200, 90);
    const rendered = renderAdjustedPixels(source, edit({ selectiveColor: [] }));
    expect(rendered.data).toEqual(source.data);
  });

  it("still yields to Black & White", () => {
    const tweaked = edit({
      blackAndWhite: true,
      selectiveColor: [{ range: "reds", hue: 100, saturation: 100, luminance: 0 }],
    });
    const rendered = renderAdjustedPixels(solidColor(1, 1, 255, 0, 0), tweaked);
    expect(rendered.data[0]).toBe(rendered.data[1]);
    expect(rendered.data[1]).toBe(rendered.data[2]);
  });
});
