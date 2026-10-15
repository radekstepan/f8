// Selective Clarity: per-range texture/clarity tweaks in Photomator's shape.
//
// Photomator's Selective Clarity picks one of three tonal ranges —
// Shadows, Midtones, Highlights — and adjusts Texture and Clarity for
// that range alone. Each pixel is scored against every touched range by
// its luminance through the same tonal bells the global Highlights /
// Shadows / curve sliders use, so "Shadows" means the same tones in both
// places. Weighted tweaks accumulate into per-pixel unsharp scales:
// Texture works a medium radius (fine detail), Clarity the wide global
// radius (broad detail), both at the global clarity gain — the two
// sliders differ only in frequency. Unlike global clarity there is no
// extra midtone gate on top: the range weights already localize, and a
// midtone gate would mute the Shadows range exactly where it should bite.
//
// The recipe shape is sparse like selectiveColor and curvePoints: one
// entry per touched range, neutral entries pruned on write, so an empty
// list is the identity and length alone tells active from default.

import type { SelectiveClarityEntry, SelectiveClarityParams, SelectiveClarityRange } from "./types.js";

/**
 * Slider ±100 maps to a ±1.5 unsharp gain — the same response as the
 * global Clarity slider, so a range tweak at full strength matches the
 * global slider's strength on the tones its range owns outright.
 */
export const SELECTIVE_DETAIL_RESPONSE = 1.5;

export interface SelectiveClarityRangeMeta {
  range: SelectiveClarityRange;
  label: string;
  /** Inspector swatch dot color (a tonal chip, dark to light). */
  swatch: string;
}

/** The three ranges in Photomator's tonal order. */
export const SELECTIVE_CLARITY_RANGES: readonly SelectiveClarityRangeMeta[] = [
  { range: "shadows", label: "Shadows", swatch: "#232326" },
  { range: "midtones", label: "Midtones", swatch: "#8e8e93" },
  { range: "highlights", label: "Highlights", swatch: "#f5f5f5" },
];

const RANGE_ORDER = new Map<SelectiveClarityRange, number>(
  SELECTIVE_CLARITY_RANGES.map((meta, index) => [meta.range, index]),
);

/** Neutral params: both sliders at 0. Returned copies are always fresh. */
export function neutralSelectiveClarityParams(): SelectiveClarityParams {
  return { texture: 0, clarity: 0 };
}

/** True when both sliders sit at 0 (non-finite values count as neutral). */
export function isSelectiveClarityParamsNeutral(params: SelectiveClarityParams): boolean {
  const clean = (value: number): number => (Number.isFinite(value) ? value : 0);
  return clean(params.texture) === 0 && clean(params.clarity) === 0;
}

const clampSlider = (value: number): number => Math.min(100, Math.max(-100, value));

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How strongly one pixel (luminance 0..1) belongs to a range, 0..1. The
 * bells match the global tonal weights in adjustments.ts — shadows is
 * shadowWeight, midtones is midtoneWeight, highlights is
 * highlightWeight — so the ranges and the global sliders agree on what
 * "Shadows" means. Kept local (rather than imported) so this module
 * stays dependency-free like selective-color.ts; the equality is pinned
 * by test.
 */
export function selectiveClarityWeight(luminance01: number, range: SelectiveClarityRange): number {
  const lit = Math.min(1, Math.max(0, luminance01));
  switch (range) {
    case "shadows":
      return 1 - smoothstep(0.05, 0.55, lit);
    case "midtones":
      return Math.sin(Math.PI * lit);
    case "highlights":
      return smoothstep(0.45, 0.95, lit);
  }
}

/**
 * Sanitize a stored list to the sparse canonical shape: unknown ranges and
 * non-object entries drop, non-finite sliders become 0, values clamp to
 * ±100, last entry wins per range, neutral entries prune, and survivors
 * sort in range order. Never throws — garbage (including non-arrays)
 * normalizes to the empty identity.
 */
export function normalizeSelectiveClarity(value: unknown): SelectiveClarityEntry[] {
  if (!Array.isArray(value)) return [];
  const byRange = new Map<SelectiveClarityRange, SelectiveClarityParams>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<SelectiveClarityEntry>;
    if (!RANGE_ORDER.has(candidate.range as SelectiveClarityRange)) continue;
    const range = candidate.range as SelectiveClarityRange;
    const clean = (slider: unknown): number =>
      typeof slider === "number" && Number.isFinite(slider) ? clampSlider(slider) : 0;
    byRange.set(range, {
      texture: clean(candidate.texture),
      clarity: clean(candidate.clarity),
    });
  }
  const entries: SelectiveClarityEntry[] = [];
  for (const [range, params] of byRange) {
    if (isSelectiveClarityParamsNeutral(params)) continue;
    entries.push({ range, ...params });
  }
  entries.sort((a, b) => (RANGE_ORDER.get(a.range) ?? 0) - (RANGE_ORDER.get(b.range) ?? 0));
  return entries;
}

/** True when the stored list holds at least one non-neutral known range. */
export function isSelectiveClarityActive(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<SelectiveClarityEntry>;
    if (!RANGE_ORDER.has(candidate.range as SelectiveClarityRange)) return false;
    return !isSelectiveClarityParamsNeutral({
      texture: typeof candidate.texture === "number" ? candidate.texture : 0,
      clarity: typeof candidate.clarity === "number" ? candidate.clarity : 0,
    });
  });
}

/** One range's stored params (a fresh neutral when the range is untouched). Last entry wins, matching normalize. */
export function selectiveClarityParams(value: unknown, range: SelectiveClarityRange): SelectiveClarityParams {
  let found: SelectiveClarityParams | null = null;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<SelectiveClarityEntry>;
      if (candidate.range !== range) continue;
      const clean = (slider: unknown): number =>
        typeof slider === "number" && Number.isFinite(slider) ? clampSlider(slider) : 0;
      found = { texture: clean(candidate.texture), clarity: clean(candidate.clarity) };
    }
  }
  return found ?? neutralSelectiveClarityParams();
}

/**
 * Patch one range's params, returning the new canonical list (a fresh
 * array; the input is never mutated). Neutral results prune the range, so
 * dragging both sliders home removes the entry entirely.
 */
export function setSelectiveClarityRange(
  value: unknown,
  range: SelectiveClarityRange,
  patch: Partial<SelectiveClarityParams>,
): SelectiveClarityEntry[] {
  if (!RANGE_ORDER.has(range)) return normalizeSelectiveClarity(value);
  const current = selectiveClarityParams(value, range);
  const clean = (slider: number | undefined, fallback: number): number =>
    slider === undefined ? fallback : Number.isFinite(slider) ? clampSlider(slider) : fallback;
  const next: SelectiveClarityParams = {
    texture: clean(patch.texture, current.texture),
    clarity: clean(patch.clarity, current.clarity),
  };
  const entries = normalizeSelectiveClarity(value).filter((entry) => entry.range !== range);
  if (!isSelectiveClarityParamsNeutral(next)) {
    entries.push({ range, ...next });
    entries.sort((a, b) => (RANGE_ORDER.get(a.range) ?? 0) - (RANGE_ORDER.get(b.range) ?? 0));
  }
  return entries;
}

/**
 * Resolve a stored list to the render-time packed form: three
 * [textureDelta, clarityDelta] pairs in SELECTIVE_CLARITY_RANGES order
 * (6 floats, slider/100 units), or null while neutral so the pixel loop
 * skips the extra blur passes entirely.
 */
export function resolveSelectiveClarity(value: unknown): Float32Array | null {
  const entries = normalizeSelectiveClarity(value);
  if (entries.length === 0) return null;
  const packed = new Float32Array(SELECTIVE_CLARITY_RANGES.length * 2);
  for (const entry of entries) {
    const index = (RANGE_ORDER.get(entry.range) ?? 0) * 2;
    packed[index] = entry.texture / 100;
    packed[index + 1] = entry.clarity / 100;
  }
  return packed;
}

/**
 * Accumulate one pixel's unsharp scales from packed params: the
 * weight-sum of texture and clarity slider deltas (slider/100 units) for
 * a luminance 0..1. The pipeline multiplies these by the blur-ring
 * detail deltas and SELECTIVE_DETAIL_RESPONSE.
 */
export function selectiveDetailScales(
  luminance01: number,
  packed: Float32Array,
): readonly [number, number] {
  const lit = Math.min(1, Math.max(0, luminance01));
  let textureScale = 0;
  let clarityScale = 0;
  for (let i = 0; i < SELECTIVE_CLARITY_RANGES.length; i += 1) {
    const base = i * 2;
    const rangeTexture = packed[base] ?? 0;
    const rangeClarity = packed[base + 1] ?? 0;
    if (rangeTexture === 0 && rangeClarity === 0) continue;
    const range = SELECTIVE_CLARITY_RANGES[i]?.range;
    if (!range) continue;
    const weight = selectiveClarityWeight(lit, range);
    if (weight === 0) continue;
    textureScale += weight * rangeTexture;
    clarityScale += weight * rangeClarity;
  }
  return [textureScale, clarityScale];
}
