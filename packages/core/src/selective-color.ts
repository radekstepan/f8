// Selective Color: per-range HSL tweaks in Photomator's shape.
//
// Photomator's Selective Color picks one of eleven ranges — eight chromatic
// hues (Reds through Magentas) plus Whites, Neutrals, and Blacks — and
// adjusts Hue, Saturation, and Luminance for that range alone. Each pixel
// is scored against every touched range in HSL space: chromatic ranges
// weight by circular hue distance with a cosine falloff (overlapping, so
// every hue belongs somewhere), gated on saturation so grays stay put;
// the achromatic bands weight by lightness bells, gated on grayness so
// vivid colors stay put. Weighted tweaks accumulate and apply in one
// HSL round-trip, after the global hue rotation and before Black & White.
//
// The recipe shape is sparse like curvePoints: one entry per touched
// range, neutral entries pruned on write, so an empty list is the
// identity and length alone tells active from default.

import type { SelectiveColorEntry, SelectiveColorParams, SelectiveColorRange } from "./types.js";

/** Slider ±100 maps to ±60° of hue rotation (one adjacent-range shift). */
export const SELECTIVE_COLOR_HUE_RESPONSE = 0.6;
/** Slider ±100 maps to a ±0.5 lightness offset. */
export const SELECTIVE_COLOR_LUMINANCE_RESPONSE = 0.5;

export interface SelectiveColorRangeMeta {
  range: SelectiveColorRange;
  label: string;
  /** Inspector swatch dot color. */
  swatch: string;
  /** Chromatic hue center in degrees; absent on the achromatic bands. */
  center?: number;
  /** Cosine-falloff half-width in degrees; absent on achromatic bands. */
  halfWidth?: number;
}

/**
 * The eleven ranges in Photomator's order. Chromatic half-widths overlap
 * deliberately: neighboring bands share their boundary hues, so no hue
 * falls in a dead gap and crossfades stay smooth.
 */
export const SELECTIVE_COLOR_RANGES: readonly SelectiveColorRangeMeta[] = [
  { range: "reds", label: "Reds", swatch: "#e5484d", center: 0, halfWidth: 30 },
  { range: "oranges", label: "Oranges", swatch: "#f76b15", center: 30, halfWidth: 26 },
  { range: "yellows", label: "Yellows", swatch: "#e5c400", center: 60, halfWidth: 26 },
  { range: "greens", label: "Greens", swatch: "#46a758", center: 120, halfWidth: 38 },
  { range: "aquas", label: "Aquas", swatch: "#12a594", center: 180, halfWidth: 32 },
  { range: "blues", label: "Blues", swatch: "#0090ff", center: 240, halfWidth: 30 },
  { range: "purples", label: "Purples", swatch: "#8e4ec6", center: 270, halfWidth: 26 },
  { range: "magentas", label: "Magentas", swatch: "#d6409f", center: 305, halfWidth: 32 },
  { range: "whites", label: "Whites", swatch: "#f5f5f5" },
  { range: "neutrals", label: "Neutrals", swatch: "#8e8e93" },
  { range: "blacks", label: "Blacks", swatch: "#232326" },
];

const RANGE_ORDER = new Map<SelectiveColorRange, number>(
  SELECTIVE_COLOR_RANGES.map((meta, index) => [meta.range, index]),
);

/** Neutral params: every slider at 0. Returned copies are always fresh. */
export function neutralSelectiveColorParams(): SelectiveColorParams {
  return { hue: 0, saturation: 0, luminance: 0 };
}

/** True when every slider sits at 0 (non-finite values count as neutral). */
export function isSelectiveColorParamsNeutral(params: SelectiveColorParams): boolean {
  const clean = (value: number): number => (Number.isFinite(value) ? value : 0);
  return clean(params.hue) === 0 && clean(params.saturation) === 0 && clean(params.luminance) === 0;
}

const clampSlider = (value: number): number => Math.min(100, Math.max(-100, value));

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Circular hue distance in degrees (0..180). */
export function selectiveHueDistance(hue: number, center: number): number {
  const delta = Math.abs(((hue - center) % 360 + 360) % 360);
  return delta > 180 ? 360 - delta : delta;
}

/**
 * How strongly one pixel (hue 0..360, saturation/lightness 0..1) belongs
 * to a range, 0..1. Chromatic ranges fall off by hue and fade out on
 * near-grays; the achromatic bands fall off by lightness and fade out on
 * vivid colors — Whites/Neutrals/Blacks own the grays, the hues own the
 * colors, and the gates crossfade the middle instead of double-driving it.
 */
export function selectiveColorWeight(
  hue: number,
  saturation: number,
  lightness: number,
  range: SelectiveColorRange,
): number {
  const sat = Math.min(1, Math.max(0, saturation));
  const lit = Math.min(1, Math.max(0, lightness));
  switch (range) {
    case "whites":
      return smoothstep(0.55, 0.92, lit) * (1 - smoothstep(0.12, 0.38, sat));
    case "neutrals":
      return Math.sin(Math.PI * lit) * (1 - smoothstep(0.12, 0.38, sat));
    case "blacks":
      return (1 - smoothstep(0.08, 0.42, lit)) * (1 - smoothstep(0.12, 0.38, sat));
    default: {
      const meta = SELECTIVE_COLOR_RANGES[RANGE_ORDER.get(range) ?? -1];
      const center = meta?.center ?? 0;
      const halfWidth = meta?.halfWidth ?? 30;
      const distance = selectiveHueDistance(hue, center);
      if (distance >= halfWidth) return 0;
      const falloff = 0.5 + 0.5 * Math.cos((Math.PI * distance) / halfWidth);
      return falloff * smoothstep(0.02, 0.12, sat);
    }
  }
}

/** Standard RGB (0..255) to HSL (hue 0..360, sat/light 0..1). */
export function rgbToHsl(r: number, g: number, b: number): readonly [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const span = max - min;
  const saturation = lightness > 0.5 ? span / (2 - max - min) : span / (max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / span + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) hue = ((bn - rn) / span + 2) * 60;
  else hue = ((rn - gn) / span + 4) * 60;
  return [hue, saturation, lightness];
}

/** Standard HSL back to RGB (0..255 floats, clamped, unrounded). */
export function hslToRgb(hue: number, saturation: number, lightness: number): readonly [number, number, number] {
  const sat = Math.min(1, Math.max(0, saturation));
  const lit = Math.min(1, Math.max(0, lightness));
  if (sat === 0) {
    const gray = lit * 255;
    return [gray, gray, gray];
  }
  const h = (((hue % 360) + 360) % 360) / 360;
  const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
  const p = 2 * lit - q;
  const channel = (t: number): number => {
    const wrapped = ((t % 1) + 1) % 1;
    if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

/**
 * Sanitize a stored list to the sparse canonical shape: unknown ranges and
 * non-object entries drop, non-finite sliders become 0, values clamp to
 * ±100, last entry wins per range, neutral entries prune, and survivors
 * sort in range order. Never throws — garbage (including non-arrays)
 * normalizes to the empty identity.
 */
export function normalizeSelectiveColor(value: unknown): SelectiveColorEntry[] {
  if (!Array.isArray(value)) return [];
  const byRange = new Map<SelectiveColorRange, SelectiveColorParams>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<SelectiveColorEntry>;
    if (!RANGE_ORDER.has(candidate.range as SelectiveColorRange)) continue;
    const range = candidate.range as SelectiveColorRange;
    const clean = (slider: unknown): number =>
      typeof slider === "number" && Number.isFinite(slider) ? clampSlider(slider) : 0;
    byRange.set(range, {
      hue: clean(candidate.hue),
      saturation: clean(candidate.saturation),
      luminance: clean(candidate.luminance),
    });
  }
  const entries: SelectiveColorEntry[] = [];
  for (const [range, params] of byRange) {
    if (isSelectiveColorParamsNeutral(params)) continue;
    entries.push({ range, ...params });
  }
  entries.sort((a, b) => (RANGE_ORDER.get(a.range) ?? 0) - (RANGE_ORDER.get(b.range) ?? 0));
  return entries;
}

/** True when the stored list holds at least one non-neutral known range. */
export function isSelectiveColorActive(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<SelectiveColorEntry>;
    if (!RANGE_ORDER.has(candidate.range as SelectiveColorRange)) return false;
    return !isSelectiveColorParamsNeutral({
      hue: typeof candidate.hue === "number" ? candidate.hue : 0,
      saturation: typeof candidate.saturation === "number" ? candidate.saturation : 0,
      luminance: typeof candidate.luminance === "number" ? candidate.luminance : 0,
    });
  });
}

/** One range's stored params (a fresh neutral when the range is untouched). Last entry wins, matching normalize. */
export function selectiveColorParams(value: unknown, range: SelectiveColorRange): SelectiveColorParams {
  let found: SelectiveColorParams | null = null;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<SelectiveColorEntry>;
      if (candidate.range !== range) continue;
      const clean = (slider: unknown): number =>
        typeof slider === "number" && Number.isFinite(slider) ? clampSlider(slider) : 0;
      found = { hue: clean(candidate.hue), saturation: clean(candidate.saturation), luminance: clean(candidate.luminance) };
    }
  }
  return found ?? neutralSelectiveColorParams();
}

/**
 * Patch one range's params, returning the new canonical list (a fresh
 * array; the input is never mutated). Neutral results prune the range, so
 * dragging every slider home removes the entry entirely.
 */
export function setSelectiveColorRange(
  value: unknown,
  range: SelectiveColorRange,
  patch: Partial<SelectiveColorParams>,
): SelectiveColorEntry[] {
  if (!RANGE_ORDER.has(range)) return normalizeSelectiveColor(value);
  const current = selectiveColorParams(value, range);
  const clean = (slider: number | undefined, fallback: number): number =>
    slider === undefined ? fallback : Number.isFinite(slider) ? clampSlider(slider) : fallback;
  const next: SelectiveColorParams = {
    hue: clean(patch.hue, current.hue),
    saturation: clean(patch.saturation, current.saturation),
    luminance: clean(patch.luminance, current.luminance),
  };
  const entries = normalizeSelectiveColor(value).filter((entry) => entry.range !== range);
  if (!isSelectiveColorParamsNeutral(next)) {
    entries.push({ range, ...next });
    entries.sort((a, b) => (RANGE_ORDER.get(a.range) ?? 0) - (RANGE_ORDER.get(b.range) ?? 0));
  }
  return entries;
}

/**
 * Resolve a stored list to the render-time packed form: eleven
 * [hueDegrees, saturationDelta, luminanceDelta] triples in
 * SELECTIVE_COLOR_RANGES order (33 floats), or null while neutral so the
 * pixel loop skips the HSL round-trip entirely.
 */
export function resolveSelectiveColor(value: unknown): Float32Array | null {
  const entries = normalizeSelectiveColor(value);
  if (entries.length === 0) return null;
  const packed = new Float32Array(SELECTIVE_COLOR_RANGES.length * 3);
  for (const entry of entries) {
    const index = (RANGE_ORDER.get(entry.range) ?? 0) * 3;
    packed[index] = entry.hue * SELECTIVE_COLOR_HUE_RESPONSE;
    packed[index + 1] = entry.saturation / 100;
    packed[index + 2] = entry.luminance * SELECTIVE_COLOR_LUMINANCE_RESPONSE / 100;
  }
  return packed;
}

/**
 * Apply packed selective-color params to one pixel (0..255 floats).
 * Range weights accumulate into a single hue shift, saturation delta, and
 * lightness offset, applied in one HSL round-trip. Returns clamped
 * 0..255 floats; the pipeline's final clamp rounds to bytes.
 */
export function applySelectiveColor(
  r: number,
  g: number,
  b: number,
  packed: Float32Array,
): readonly [number, number, number] {
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
}
