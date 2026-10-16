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
  applySelectiveColorPlan,
  hslToRgb,
  isSelectiveColorActive,
  isSelectiveColorParamsNeutral,
  normalizeSelectiveColor,
  planSelectiveColor,
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

  it("matches the exported-primitive reference bit-for-bit", () => {
    // The per-pixel fast path inlines rgbToHsl / selectiveColorWeight /
    // hslToRgb and shares the saturation gates; this differential sweep
    // recomputes the same pixel through those exported primitives (the
    // pre-optimization algorithm, verbatim) and requires exact equality —
    // any drift in the hot loop fails here, not as a subtle render shift.
    const reference = (r: number, g: number, b: number, packed: Float32Array): readonly [number, number, number] => {
      const [hue, saturation, lightness] = rgbToHsl(r, g, b);
      let hueShift = 0;
      let saturationDelta = 0;
      let luminanceDelta = 0;
      for (let i = 0; i < SELECTIVE_COLOR_RANGES.length; i += 1) {
        const base = i * 3;
        const rangeHue = packed[base] ?? 0;
        const rangeSat = packed[base + 1] ?? 0;
        const rangeLum = packed[base + 2] ?? 0;
        if (rangeHue === 0 && rangeSat === 0 && rangeLum === 0) continue;
        const range = SELECTIVE_COLOR_RANGES[i]?.range;
        if (!range) continue;
        const weight = selectiveColorWeight(hue, saturation, lightness, range);
        if (weight === 0) continue;
        hueShift += weight * rangeHue;
        saturationDelta += weight * rangeSat;
        luminanceDelta += weight * rangeLum;
      }
      if (hueShift === 0 && saturationDelta === 0 && luminanceDelta === 0) return [r, g, b];
      const nextHue = (((hue + hueShift) % 360) + 360) % 360;
      const nextSaturation = saturation * Math.max(0, 1 + saturationDelta);
      const nextLightness = lightness + luminanceDelta;
      const [red, green, blue] = hslToRgb(nextHue, nextSaturation, nextLightness);
      return [
        Math.min(255, Math.max(0, red)),
        Math.min(255, Math.max(0, green)),
        Math.min(255, Math.max(0, blue)),
      ];
    };
    // Corners, edges, and mid-tones per channel, plus near-gray ramps that
    // exercise the gate boundaries and the exact-gray skips.
    const levels = [0, 1, 2, 5, 16, 64, 127, 128, 129, 200, 240, 253, 254, 255];
    const colors: Array<readonly [number, number, number]> = [];
    for (const r of levels) for (const g of levels) for (const b of levels) colors.push([r, g, b]);
    for (let v = 0; v <= 255; v += 7) {
      colors.push([v, v, v]);
      colors.push([v, Math.min(255, v + 1), Math.max(0, v - 1)]);
    }
    const recipes = [
      [{ range: "reds", hue: 100, saturation: 0, luminance: 0 }],
      [{ range: "blues", hue: 0, saturation: -100, luminance: 0 }],
      [{ range: "greens", hue: -45, saturation: 60, luminance: -25 }],
      [{ range: "whites", hue: 30, saturation: 40, luminance: 100 }],
      [{ range: "neutrals", hue: -100, saturation: 100, luminance: -100 }],
      [{ range: "blacks", hue: 0, saturation: 0, luminance: 50 }],
      [
        { range: "reds", hue: 20, saturation: 10, luminance: 0 },
        { range: "blues", hue: 0, saturation: -40, luminance: 0 },
        { range: "neutrals", hue: 0, saturation: 0, luminance: -30 },
      ],
      SELECTIVE_COLOR_RANGES.map((meta, i) => ({
        range: meta.range,
        hue: ((i * 37) % 201) - 100,
        saturation: ((i * 53) % 201) - 100,
        luminance: ((i * 29) % 201) - 100,
      })),
    ] as const;
    for (const recipe of recipes) {
      const packed = resolveSelectiveColor(recipe)!;
      expect(packed).not.toBeNull();
      // The hot plan path must agree with the packed path on every pixel.
      const plan = planSelectiveColor(packed)!;
      expect(plan).not.toBeNull();
      for (const [r, g, b] of colors) {
        const expected = reference(r, g, b, packed);
        expect(applySelectiveColor(r, g, b, packed)).toEqual(expected);
        expect(applySelectiveColorPlan(r, g, b, plan)).toEqual(expected);
      }
    }
  });

  it("plans only the active slots in range order with gate flags", () => {
    expect(planSelectiveColor(null)).toBeNull();
    expect(planSelectiveColor(resolveSelectiveColor([]))).toBeNull();
    expect(planSelectiveColor(new Float32Array(33))).toBeNull();
    const plan = planSelectiveColor(
      resolveSelectiveColor([
        // Listed out of order on purpose: the plan sorts into slot order.
        { range: "neutrals", hue: 0, saturation: 0, luminance: -30 },
        { range: "blues", hue: 0, saturation: -40, luminance: 0 },
      ]),
    )!;
    expect(plan.slots.map((slot) => slot.kind)).toEqual([0, 2]);
    expect(plan.slots[0]?.saturation).toBeCloseTo(-0.4, 5);
    expect(plan.slots[1]?.luminance).toBeCloseTo(-0.15, 5);
    expect(plan.hasChromatic).toBe(true);
    expect(plan.hasAchromatic).toBe(true);
    const chromaticOnly = planSelectiveColor(resolveSelectiveColor([{ range: "reds", hue: 10, saturation: 0, luminance: 0 }]))!;
    expect(chromaticOnly.hasChromatic).toBe(true);
    expect(chromaticOnly.hasAchromatic).toBe(false);
    const grayOnly = planSelectiveColor(resolveSelectiveColor([{ range: "blacks", hue: 0, saturation: 0, luminance: 50 }]))!;
    expect(grayOnly.hasChromatic).toBe(false);
    expect(grayOnly.hasAchromatic).toBe(true);
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
