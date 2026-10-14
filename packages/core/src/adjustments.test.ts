import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import type { EditState } from "./types.js";
import type { PixelImage } from "./vision/analyze.js";
import { solidColor } from "./vision/fixtures.js";
import {
  blackWeight,
  boxBlurPlane,
  clarityRadiusForSize,
  highlightWeight,
  isNeutralEdit,
  midtoneWeight,
  pointParameters,
  renderAdjustedPixels,
  shadowWeight,
  whiteBalanceGains,
} from "./adjustments.js";

const edit = (patch: Partial<EditState>): EditState => ({ ...DEFAULT_EDIT, ...patch });

const channel = (image: PixelImage, x: number, y: number): readonly [number, number, number] => {
  const i = (y * image.width + x) * 4;
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0];
};

/** Left half `dark`, right half `light`: a midtone step edge for detail tests. */
function midtoneStep(width: number, height: number, dark: number, light: number): PixelImage {
  const image = solidColor(width, height, dark, dark, dark);
  for (let y = 0; y < height; y += 1) {
    for (let x = Math.floor(width / 2); x < width; x += 1) {
      const i = (y * width + x) * 4;
      image.data[i] = light;
      image.data[i + 1] = light;
      image.data[i + 2] = light;
    }
  }
  return image;
}

describe("tonal masks", () => {
  it("focuses highlights on bright tones only", () => {
    expect(highlightWeight(0)).toBe(0);
    expect(highlightWeight(0.2)).toBe(0);
    expect(highlightWeight(1)).toBe(1);
    expect(highlightWeight(0.86)).toBeGreaterThan(0.8);
  });

  it("focuses shadows on dark tones only", () => {
    expect(shadowWeight(1)).toBe(0);
    expect(shadowWeight(0.8)).toBe(0);
    expect(shadowWeight(0)).toBe(1);
    expect(shadowWeight(0.12)).toBeGreaterThan(0.9);
  });

  it("focuses blacks tighter than shadows", () => {
    expect(blackWeight(0)).toBe(1);
    expect(blackWeight(1)).toBe(0);
    expect(blackWeight(0.5)).toBeLessThan(shadowWeight(0.5));
  });

  it("peaks the midtone weight at middle gray and zeroes at the extremes", () => {
    expect(midtoneWeight(0)).toBe(0);
    expect(midtoneWeight(0.5)).toBeCloseTo(1, 10);
    expect(midtoneWeight(1)).toBeCloseTo(0, 10);
  });
});

describe("whiteBalanceGains", () => {
  it("is neutral at 5500 K with zero tint", () => {
    expect(whiteBalanceGains(5500, 0)).toEqual({ red: 1, green: 1, blue: 1 });
  });

  it("warms high temperatures and cools low ones", () => {
    const warm = whiteBalanceGains(8000, 0);
    expect(warm.red).toBeGreaterThan(1);
    expect(warm.blue).toBeLessThan(1);
    const cool = whiteBalanceGains(3000, 0);
    expect(cool.red).toBeLessThan(1);
    expect(cool.blue).toBeGreaterThan(1);
  });

  it("pushes green for positive tint and magenta for negative tint", () => {
    const green = whiteBalanceGains(5500, 100);
    expect(green.green).toBeGreaterThan(green.red);
    expect(green.green).toBeGreaterThan(1);
    const magenta = whiteBalanceGains(5500, -100);
    expect(magenta.green).toBeLessThan(1);
    expect(magenta.red).toBeGreaterThan(1);
  });
});

describe("isNeutralEdit", () => {
  it("treats the default edit as neutral", () => {
    expect(isNeutralEdit(DEFAULT_EDIT)).toBe(true);
  });

  it("detects every adjustment family", () => {
    expect(isNeutralEdit(edit({ highlights: 10 }))).toBe(false);
    expect(isNeutralEdit(edit({ temperature: 6000 }))).toBe(false);
    expect(isNeutralEdit(edit({ saturation: 10 }))).toBe(false);
    expect(isNeutralEdit(edit({ curve: 10 }))).toBe(false);
    expect(isNeutralEdit(edit({ curvePoints: [{ x: 0.5, y: 0.6 }] }))).toBe(false);
    expect(isNeutralEdit(edit({ clarity: 10 }))).toBe(false);
    expect(isNeutralEdit(edit({ blackAndWhite: true }))).toBe(false);
  });

  it("ignores values behind a disabled toggle", () => {
    expect(isNeutralEdit(edit({ highlights: 100, lightnessEnabled: false }))).toBe(true);
    expect(isNeutralEdit(edit({ temperature: 9000, whiteBalanceEnabled: false }))).toBe(true);
    expect(isNeutralEdit(edit({ saturation: 100, colorEnabled: false }))).toBe(true);
    expect(isNeutralEdit(edit({ clarity: 100, detailsEnabled: false }))).toBe(true);
  });
});

describe("renderAdjustedPixels", () => {
  it("leaves every pixel untouched for a neutral edit", () => {
    const source = solidColor(8, 8, 200, 100, 50);
    const rendered = renderAdjustedPixels(source, DEFAULT_EDIT);
    expect(rendered.width).toBe(8);
    expect(rendered.height).toBe(8);
    expect(Array.from(rendered.data)).toEqual(Array.from(source.data));
  });

  it("preserves alpha and never mutates the source buffer", () => {
    const source = solidColor(4, 4, 120, 130, 140, 37);
    const before = Array.from(source.data);
    const rendered = renderAdjustedPixels(source, edit({ exposure: 1, saturation: 50 }));
    for (let i = 3; i < rendered.data.length; i += 4) expect(rendered.data[i]).toBe(37);
    expect(Array.from(source.data)).toEqual(before);
    expect(rendered.data).not.toBe(source.data);
  });

  it("rejects buffers that do not match their dimensions", () => {
    expect(() => renderAdjustedPixels({ width: 2, height: 2, data: new Uint8ClampedArray(4) }, DEFAULT_EDIT)).toThrow(RangeError);
  });

  it("scales exposure as 2^(EV * 0.6)", () => {
    const [r] = channel(renderAdjustedPixels(solidColor(2, 2, 128, 128, 128), edit({ exposure: 1 })), 0, 0);
    expect(r).toBe(194);
    const [dark] = channel(renderAdjustedPixels(solidColor(2, 2, 128, 128, 128), edit({ exposure: -1 })), 0, 0);
    expect(dark).toBeLessThan(128);
  });

  it("moves highlights without touching deep shadows", () => {
    const rendered = renderAdjustedPixels(solidColor(2, 1, 220, 220, 220), edit({ highlights: -100 }));
    const [bright] = channel(rendered, 0, 0);
    expect(bright).toBeGreaterThan(100);
    expect(bright).toBeLessThan(160);
    const dark = renderAdjustedPixels(solidColor(2, 2, 20, 20, 20), edit({ highlights: -100 }));
    expect(channel(dark, 0, 0)).toEqual([20, 20, 20]);
  });

  it("lifts shadows without touching bright highlights", () => {
    const rendered = renderAdjustedPixels(solidColor(2, 2, 30, 30, 30), edit({ shadows: 100 }));
    const [lifted] = channel(rendered, 0, 0);
    expect(lifted).toBeGreaterThan(100);
    expect(lifted).toBeLessThan(150);
    const bright = renderAdjustedPixels(solidColor(2, 2, 250, 250, 250), edit({ shadows: 100 }));
    expect(channel(bright, 0, 0)).toEqual([250, 250, 250]);
  });

  it("weighs blacks toward the deepest tones", () => {
    const deep = renderAdjustedPixels(solidColor(2, 2, 10, 10, 10), edit({ blacks: -50 }));
    const mid = renderAdjustedPixels(solidColor(2, 2, 128, 128, 128), edit({ blacks: -50 }));
    const [deepValue] = channel(deep, 0, 0);
    const [midValue] = channel(mid, 0, 0);
    expect(deepValue).toBeLessThanOrEqual(2);
    expect(128 - midValue).toBeLessThan(20);
    expect(10 - deepValue).toBeGreaterThan(128 - midValue);
  });

  it("lifts brightness uniformly", () => {
    const rendered = renderAdjustedPixels(solidColor(2, 2, 100, 100, 100), edit({ brightness: 40 }));
    expect(channel(rendered, 0, 0)).toEqual([140, 140, 140]);
  });

  it("pivots contrast around middle gray", () => {
    const flat = renderAdjustedPixels(solidColor(2, 2, 200, 100, 50), edit({ contrast: -100 }));
    expect(channel(flat, 0, 0)).toEqual([128, 128, 128]);
    const punchy = renderAdjustedPixels(solidColor(2, 2, 180, 180, 180), edit({ contrast: 50 }));
    const [value] = channel(punchy, 0, 0);
    expect(value).toBeGreaterThan(180);
  });

  it("bends the curve through the midtones while pinning black and white", () => {
    const mid = renderAdjustedPixels(solidColor(2, 2, 128, 128, 128), edit({ curve: 100 }));
    const [midValue] = channel(mid, 0, 0);
    expect(midValue).toBeGreaterThan(168);
    const black = renderAdjustedPixels(solidColor(2, 2, 0, 0, 0), edit({ curve: 100 }));
    expect(channel(black, 0, 0)).toEqual([0, 0, 0]);
    const white = renderAdjustedPixels(solidColor(2, 2, 255, 255, 255), edit({ curve: 100 }));
    expect(channel(white, 0, 0)).toEqual([255, 255, 255]);
  });

  it("remaps every channel through the anchor curve while pinning black and white", () => {
    const anchors = [{ x: 0.5, y: 0.75 }];
    const mid = renderAdjustedPixels(solidColor(2, 2, 128, 128, 128), edit({ curvePoints: anchors }));
    const [midValue] = channel(mid, 0, 0);
    expect(midValue).toBeGreaterThan(160);
    // The remap hits each channel, not just luminance: a colored pixel
    // keeps its hue direction while its levels move with the curve.
    const color = renderAdjustedPixels(solidColor(2, 2, 200, 100, 50), edit({ curvePoints: anchors }));
    const [r, g, b] = channel(color, 0, 0);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(50);
    const black = renderAdjustedPixels(solidColor(2, 2, 0, 0, 0), edit({ curvePoints: anchors }));
    expect(channel(black, 0, 0)).toEqual([0, 0, 0]);
    const white = renderAdjustedPixels(solidColor(2, 2, 255, 255, 255), edit({ curvePoints: anchors }));
    expect(channel(white, 0, 0)).toEqual([255, 255, 255]);
  });

  it("skips the anchor lookup while the curve is identity", () => {
    expect(pointParameters(DEFAULT_EDIT).curveTable).toBeNull();
    expect(pointParameters(edit({ curvePoints: [{ x: 0.5, y: 0.6 }] })).curveTable).toHaveLength(256);
  });

  it("renders temperature and tint as opposing channel gains", () => {
    const warm = renderAdjustedPixels(solidColor(2, 2, 128, 128, 128), edit({ temperature: 8000 }));
    const [wr, wg, wb] = channel(warm, 0, 0);
    expect(wr).toBeGreaterThan(128);
    expect(wb).toBeLessThan(128);
    expect(wg).toBe(128);
    const green = renderAdjustedPixels(solidColor(2, 2, 128, 128, 128), edit({ tint: 100 }));
    const [gr, gg, gb] = channel(green, 0, 0);
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
  });

  it("desaturates fully at -100 and boosts chroma above zero", () => {
    const gray = renderAdjustedPixels(solidColor(2, 2, 200, 100, 50), edit({ saturation: -100 }));
    expect(channel(gray, 0, 0)).toEqual([118, 118, 118]);
    const vivid = renderAdjustedPixels(solidColor(2, 2, 200, 100, 50), edit({ saturation: 50 }));
    const [r, g, b] = channel(vivid, 0, 0);
    expect(r - b).toBeGreaterThan(200 - 50);
    expect(g).toBeLessThan(100);
  });

  it("aims positive vibrance at muted colors first", () => {
    const muted = renderAdjustedPixels(solidColor(2, 2, 150, 130, 120), edit({ vibrance: 80 }));
    const vivid = renderAdjustedPixels(solidColor(2, 2, 220, 40, 40), edit({ vibrance: 80 }));
    const [mr] = channel(muted, 0, 0);
    const [vr] = channel(vivid, 0, 0);
    const mutedLuma = 0.2126 * 150 + 0.7152 * 130 + 0.0722 * 120;
    const vividLuma = 0.2126 * 220 + 0.7152 * 40 + 0.0722 * 40;
    const mutedGain = (mr - mutedLuma) / (150 - mutedLuma);
    const vividGain = (vr - vividLuma) / (220 - vividLuma);
    expect(mutedGain).toBeGreaterThan(vividGain);
    expect(vividGain).toBeGreaterThan(1);
  });

  it("rotates hue around the color wheel", () => {
    const rotated = renderAdjustedPixels(solidColor(2, 2, 255, 0, 0), edit({ hue: 180 }));
    const [r, g, b] = channel(rotated, 0, 0);
    expect(r).toBeLessThan(50);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
  });

  it("maps black & white to luminance", () => {
    const rendered = renderAdjustedPixels(solidColor(2, 2, 200, 100, 50), edit({ blackAndWhite: true }));
    expect(channel(rendered, 0, 0)).toEqual([118, 118, 118]);
  });

  it("skips every family behind a disabled toggle", () => {
    const source = solidColor(4, 4, 200, 100, 50);
    const identity = (patch: Partial<EditState>) =>
      Array.from(renderAdjustedPixels(source, edit(patch)).data);
    const original = Array.from(source.data);
    expect(identity({ exposure: 2, highlights: -100, shadows: 100, blacks: 50, brightness: 50, contrast: 50, lightnessEnabled: false })).toEqual(original);
    expect(identity({ temperature: 9000, tint: -80, whiteBalanceEnabled: false })).toEqual(original);
    expect(identity({ saturation: 80, vibrance: 80, hue: 90, colorEnabled: false })).toEqual(original);
    // Detail runs on an edge image, where enabled clarity/sharpness would move pixels.
    const edge = midtoneStep(32, 32, 100, 156);
    const skipped = renderAdjustedPixels(edge, edit({ clarity: 100, sharpness: 100, detailsEnabled: false }));
    expect(Array.from(skipped.data)).toEqual(Array.from(edge.data));
  });

  it("leaves flat fields unchanged under clarity and sharpness", () => {
    const source = solidColor(32, 32, 140, 140, 140);
    expect(Array.from(renderAdjustedPixels(source, edit({ clarity: 100 })).data)).toEqual(Array.from(source.data));
    expect(Array.from(renderAdjustedPixels(source, edit({ sharpness: 100 })).data)).toEqual(Array.from(source.data));
  });

  it("widens a midtone edge with clarity", () => {
    const edge = midtoneStep(64, 64, 100, 156);
    const rendered = renderAdjustedPixels(edge, edit({ clarity: 100 }));
    const [dark] = channel(rendered, 31, 32);
    const [light] = channel(rendered, 32, 32);
    expect(dark).toBeLessThan(100);
    expect(light).toBeGreaterThan(156);
    // Far from the edge the blur matches the pixel, so nothing moves.
    expect(channel(rendered, 0, 32)[0]).toBe(100);
    expect(channel(rendered, 63, 32)[0]).toBe(156);
  });

  it("tightens a midtone edge with sharpness", () => {
    const edge = midtoneStep(32, 32, 100, 156);
    const rendered = renderAdjustedPixels(edge, edit({ sharpness: 100 }));
    const [dark] = channel(rendered, 15, 16);
    const [light] = channel(rendered, 16, 16);
    expect(dark).toBeLessThan(95);
    expect(light).toBeGreaterThan(161);
    expect(channel(rendered, 0, 16)[0]).toBe(100);
  });

  it("exposes precomputed point constants without DOM access", () => {
    const params = pointParameters(edit({ exposure: 1, hue: 0 }));
    expect(params.exposureGain).toBeCloseTo(Math.pow(2, 0.6), 10);
    expect(params.hueMatrix).toBeNull();
    expect(pointParameters(edit({ hue: 90 })).hueMatrix).not.toBeNull();
  });
});

describe("boxBlurPlane", () => {
  it("copies the plane for radius zero", () => {
    const source = new Float32Array([1, 2, 3, 4]);
    const blurred = boxBlurPlane(source, 2, 2, 0);
    expect(Array.from(blurred)).toEqual([1, 2, 3, 4]);
    expect(blurred).not.toBe(source);
  });

  it("leaves a uniform plane unchanged", () => {
    const blurred = boxBlurPlane(new Float32Array(100).fill(140), 10, 10, 3);
    for (const value of blurred) expect(value).toBeCloseTo(140, 5);
  });

  it("spreads an impulse while preserving total mass", () => {
    const source = new Float32Array(81);
    source[40] = 81;
    const blurred = boxBlurPlane(source, 9, 9, 1);
    expect(blurred[40] ?? 0).toBeLessThan(81);
    expect(blurred[39] ?? 0).toBeGreaterThan(0);
    const total = blurred.reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(81, 4);
  });

  it("rejects planes that do not match their dimensions", () => {
    expect(() => boxBlurPlane(new Float32Array(3), 2, 2, 1)).toThrow(RangeError);
  });
});

describe("clarityRadiusForSize", () => {
  it("scales with the smaller dimension inside fixed bounds", () => {
    expect(clarityRadiusForSize(64, 64)).toBe(2);
    expect(clarityRadiusForSize(1600, 1200)).toBeGreaterThan(clarityRadiusForSize(320, 240));
    expect(clarityRadiusForSize(8000, 6000)).toBe(10);
  });
});
