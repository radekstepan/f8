// Pixel-accurate color adjustments: pure functions over plain RGBA buffers.
//
// Every slider in the Color Adjustments inspector maps to a real operation
// here. Point operations (exposure through hue) run in a single pass;
// Clarity and Sharpness add luminance-plane unsharp passes. No DOM access,
// so this runs identically on the main thread, in workers, and in Node tests.
//
// Pipeline order per pixel:
//   exposure gain -> white-balance gains -> luminance-masked tonal offsets
//   (highlights / shadows / blacks) -> brightness lift -> contrast pivot ->
//   midtone curve -> vibrance / saturation chroma scale -> hue rotation ->
//   black & white. Clarity (wide radius, midtone-weighted) and Sharpness
//   (narrow radius) then add luminance-detail deltas to all channels.

import type { EditState } from "./types.js";
import type { PixelImage } from "./vision/analyze.js";
import { assertValidImage } from "./vision/analyze.js";
import type { WhiteBalanceGains } from "./vision/enhance.js";
import { applyFaceLift, applyRedEyeFix, isFaceAdjustActive } from "./vision/face-exposure.js";
import { applySelectiveAdjust, decodeSelectiveMask, isSelectiveAdjustActive } from "./vision/selective-mask.js";

export const TEMPERATURE_NEUTRAL = 5500;
export const TEMPERATURE_MIN = 2000;
export const TEMPERATURE_MAX = 10000;

/** Exposure slider (-3..3) maps to a 2^(EV * 0.6) gain; shared with auto-enhance. */
export const EXPOSURE_RESPONSE = 0.6;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampByte = (value: number): number => clamp(Math.round(value), 0, 255);

/** Rec.709 luminance in 0..255. */
export function luminanceOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 0 below the midtones, rising to 1 in the bright highlights. */
export function highlightWeight(luminance01: number): number {
  return smoothstep(0.45, 0.95, luminance01);
}

/** 1 in the deep shadows, falling to 0 above the midtones. */
export function shadowWeight(luminance01: number): number {
  return 1 - smoothstep(0.05, 0.55, luminance01);
}

/**
 * Tightly focused on near-black tones and strictly narrower than Shadows
 * everywhere except pure black, where both reach 1.
 */
export function blackWeight(luminance01: number): number {
  return 1 - smoothstep(0, 0.35, clamp(luminance01, 0, 1));
}

/** Midtone bell: 0 at black and white, 1 at middle gray. */
export function midtoneWeight(luminance01: number): number {
  return Math.sin(Math.PI * clamp(luminance01, 0, 1));
}

// Static weight tables: the pixel loop looks up quantized-luminance weights
// instead of evaluating smoothstep/sin per pixel. Table steps move a
// full-strength offset by under half a level, so no banding is visible.
const WEIGHT_TABLE_SIZE = 256;

function buildWeightTable(weight: (luminance01: number) => number): Float32Array {
  const table = new Float32Array(WEIGHT_TABLE_SIZE);
  for (let i = 0; i < WEIGHT_TABLE_SIZE; i += 1) table[i] = weight(i / (WEIGHT_TABLE_SIZE - 1));
  return table;
}

const HIGHLIGHT_TABLE = buildWeightTable(highlightWeight);
const SHADOW_TABLE = buildWeightTable(shadowWeight);
const BLACK_TABLE = buildWeightTable(blackWeight);
const MIDTONE_TABLE = buildWeightTable(midtoneWeight);

/**
 * Channel multipliers for temperature (2000..10000 K, neutral 5500) and
 * tint (-100..100). Positive tint pushes green, negative pushes magenta,
 * matching the auto-enhance convention ("green casts push tint negative").
 */
export function whiteBalanceGains(temperature: number, tint: number): WhiteBalanceGains {
  const warmth = clamp((temperature - TEMPERATURE_NEUTRAL) / 4500, -1, 1);
  const tint01 = clamp(tint, -100, 100) / 100;
  const floor = (gain: number): number => Math.max(0.05, gain);
  return {
    red: floor((1 + warmth * 0.35) * (1 - tint01 * 0.08)),
    green: floor(1 + tint01 * 0.25),
    blue: floor((1 - warmth * 0.35) * (1 - tint01 * 0.08)),
  };
}

function hueRotationMatrix(degrees: number): readonly [number, number, number, number, number, number, number, number, number] {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // YIQ hue-rotation folded into a single RGB matrix.
  return [
    0.299 + 0.701 * cos + 0.168 * sin,
    0.587 - 0.587 * cos + 0.33 * sin,
    0.114 - 0.114 * cos - 0.497 * sin,
    0.299 - 0.299 * cos - 0.328 * sin,
    0.587 + 0.413 * cos + 0.035 * sin,
    0.114 - 0.114 * cos + 0.292 * sin,
    0.299 - 0.3 * cos + 1.25 * sin,
    0.587 - 0.588 * cos - 1.05 * sin,
    0.114 + 0.886 * cos - 0.203 * sin,
  ];
}

export interface PointParameters {
  exposureGain: number;
  whiteBalance: WhiteBalanceGains;
  highlights: number;
  shadows: number;
  blacks: number;
  brightness: number;
  contrastFactor: number;
  curve: number;
  saturationFactor: number;
  vibrance: number;
  hueMatrix: readonly [number, number, number, number, number, number, number, number, number] | null;
  blackAndWhite: boolean;
}

/** Precompute per-render constants so the pixel loop stays branch-light. */
export function pointParameters(edit: EditState): PointParameters {
  const whiteBalanceEnabled = edit.whiteBalanceEnabled;
  const lightnessEnabled = edit.lightnessEnabled;
  const colorEnabled = edit.colorEnabled;
  return {
    exposureGain: lightnessEnabled ? Math.pow(2, clamp(edit.exposure, -3, 3) * EXPOSURE_RESPONSE) : 1,
    whiteBalance: whiteBalanceEnabled
      ? whiteBalanceGains(edit.temperature, edit.tint)
      : { red: 1, green: 1, blue: 1 },
    highlights: lightnessEnabled ? clamp(edit.highlights, -100, 100) : 0,
    shadows: lightnessEnabled ? clamp(edit.shadows, -100, 100) : 0,
    blacks: lightnessEnabled ? clamp(edit.blacks, -100, 100) : 0,
    brightness: lightnessEnabled ? clamp(edit.brightness, -100, 100) : 0,
    contrastFactor: lightnessEnabled ? 1 + clamp(edit.contrast, -100, 100) / 100 : 1,
    curve: clamp(edit.curve, -100, 100),
    saturationFactor: colorEnabled ? Math.max(0, 1 + clamp(edit.saturation, -100, 100) / 100) : 1,
    vibrance: colorEnabled ? clamp(edit.vibrance, -100, 100) : 0,
    hueMatrix: colorEnabled && edit.hue !== 0 ? hueRotationMatrix(edit.hue) : null,
    blackAndWhite: edit.blackAndWhite,
  };
}

/**
 * Apply every point adjustment (all but Clarity / Sharpness) to one pixel.
 * Returns clamped [r, g, b]. Alpha passes through untouched by the pipeline.
 */
export function applyPointAdjustments(
  r: number,
  g: number,
  b: number,
  params: PointParameters,
): readonly [number, number, number] {
  let red = r * params.exposureGain * params.whiteBalance.red;
  let green = g * params.exposureGain * params.whiteBalance.green;
  let blue = b * params.exposureGain * params.whiteBalance.blue;

  // Zero terms are skipped: a single-slider drag pays only for that slider.
  const hasTonal =
    params.highlights !== 0 || params.shadows !== 0 || params.blacks !== 0 || params.brightness !== 0 || params.curve !== 0;
  if (hasTonal) {
    const luminanceIndex = Math.round(clamp(luminanceOf(red, green, blue) / 255, 0, 1) * (WEIGHT_TABLE_SIZE - 1));
    let tonal = params.brightness;
    if (params.highlights !== 0) tonal += params.highlights * (HIGHLIGHT_TABLE[luminanceIndex] ?? 0);
    if (params.shadows !== 0) tonal += params.shadows * (SHADOW_TABLE[luminanceIndex] ?? 0);
    if (params.blacks !== 0) tonal += params.blacks * (BLACK_TABLE[luminanceIndex] ?? 0) * 0.9;
    if (params.curve !== 0) tonal += params.curve * (MIDTONE_TABLE[luminanceIndex] ?? 0) * 0.6;
    red += tonal;
    green += tonal;
    blue += tonal;
  }

  if (params.contrastFactor !== 1) {
    const contrast = params.contrastFactor;
    red = (red - 128) * contrast + 128;
    green = (green - 128) * contrast + 128;
    blue = (blue - 128) * contrast + 128;
  }

  if (params.saturationFactor !== 1 || params.vibrance !== 0) {
    const luma = luminanceOf(red, green, blue);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const pixelSaturation = max > 0 ? (max - min) / max : 0;
    const vibrance = params.vibrance / 100;
    // Positive vibrance favors muted colors; negative vibrance mutes the
    // already-vivid colors first. Zero leaves the saturation factor untouched.
    const vibranceFactor =
      vibrance >= 0 ? 1 + vibrance * (1 - pixelSaturation) : 1 + vibrance * (0.35 + 0.65 * pixelSaturation);
    const chroma = params.saturationFactor * Math.max(0, vibranceFactor);
    red = luma + (red - luma) * chroma;
    green = luma + (green - luma) * chroma;
    blue = luma + (blue - luma) * chroma;
  }

  if (params.hueMatrix) {
    const m = params.hueMatrix;
    const hr = (m[0] ?? 0) * red + (m[1] ?? 0) * green + (m[2] ?? 0) * blue;
    const hg = (m[3] ?? 0) * red + (m[4] ?? 0) * green + (m[5] ?? 0) * blue;
    const hb = (m[6] ?? 0) * red + (m[7] ?? 0) * green + (m[8] ?? 0) * blue;
    red = hr;
    green = hg;
    blue = hb;
  }

  if (params.blackAndWhite) {
    const gray = luminanceOf(red, green, blue);
    red = gray;
    green = gray;
    blue = gray;
  }

  return [clampByte(red), clampByte(green), clampByte(blue)];
}

/**
 * Separable box blur over a single-channel plane, clamped at the edges.
 * Radius 0 returns a copy. Runs in O(width * height) regardless of radius.
 */
export function boxBlurPlane(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const size = width * height;
  if (source.length !== size) {
    throw new RangeError(`Plane length ${source.length} does not match dimensions ${width}x${height}.`);
  }
  const r = Math.max(0, Math.round(radius));
  if (r === 0 || size === 0) return new Float32Array(source);
  const window = 2 * r + 1;
  const horizontal = new Float32Array(size);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += source[row + clamp(x, 0, width - 1)] ?? 0;
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / window;
      sum += (source[row + clamp(x + r + 1, 0, width - 1)] ?? 0) - (source[row + clamp(x - r, 0, width - 1)] ?? 0);
    }
  }
  const output = new Float32Array(size);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += horizontal[clamp(y, 0, height - 1) * width + x] ?? 0;
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / window;
      sum +=
        (horizontal[clamp(y + r + 1, 0, height - 1) * width + x] ?? 0) -
        (horizontal[clamp(y - r, 0, height - 1) * width + x] ?? 0);
    }
  }
  return output;
}

/** Wide local-contrast radius, scaled to the image's smaller dimension. */
export function clarityRadiusForSize(width: number, height: number): number {
  return clamp(Math.round(Math.min(width, height) / 160), 2, 10);
}

/** Narrow sharpening radius: a 3x3 neighborhood at any resolution. */
export const SHARPNESS_RADIUS = 1;

/** True when the pixel pipeline would leave every pixel unchanged. */
export function isNeutralEdit(edit: EditState): boolean {
  const whiteBalanced = !edit.whiteBalanceEnabled || (edit.temperature === TEMPERATURE_NEUTRAL && edit.tint === 0);
  const lightNeutral =
    !edit.lightnessEnabled ||
    (edit.exposure === 0 &&
      edit.brightness === 0 &&
      edit.contrast === 0 &&
      edit.highlights === 0 &&
      edit.shadows === 0 &&
      edit.blacks === 0);
  const colorNeutral =
    !edit.colorEnabled || (edit.saturation === 0 && edit.vibrance === 0 && edit.hue === 0);
  const detailNeutral = !edit.detailsEnabled || (edit.clarity === 0 && edit.sharpness === 0);
  const faceNeutral = !isFaceAdjustActive(edit.faceAdjust);
  const selectiveNeutral = !isSelectiveAdjustActive(edit.selectiveAdjust);
  return whiteBalanced && lightNeutral && colorNeutral && edit.curve === 0 && !edit.blackAndWhite && detailNeutral && faceNeutral && selectiveNeutral;
}

/**
 * Render the full adjustment pipeline into a new buffer. Clarity and
 * Sharpness are luminance-detail passes: each adds the difference between
 * the point-adjusted luminance and its blurred self back into all three
 * channels, so detail work never shifts hues. Alpha is preserved.
 */
export function renderAdjustedPixels(source: PixelImage, edit: EditState): PixelImage {
  assertValidImage(source);
  const { width, height, data } = source;
  const params = pointParameters(edit);
  const pixels = width * height;
  const output = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const [red, green, blue] = applyPointAdjustments(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, params);
    output[i] = red;
    output[i + 1] = green;
    output[i + 2] = blue;
    output[i + 3] = data[i + 3] ?? 255;
  }

  // ML face adjust (masked lift + red-eye discs) lands after the point
  // pass and before the detail passes, so clarity/sharpness work on the
  // lifted faces instead of amplifying the lift edge.
  if (isFaceAdjustActive(edit.faceAdjust)) {
    const face = edit.faceAdjust;
    if (face.amount > 0 && face.boxes.length > 0) applyFaceLift(output, width, height, face.boxes, face.amount);
    if (face.redEye.length > 0) applyRedEyeFix(output, width, height, face.redEye);
  }

  // ML selective adjust (masked exposure/contrast/saturation over the
  // subject or background) lands with the face pass, after the point pass
  // and before the detail passes. Corrupt masks skip silently — a damaged
  // recipe must never break the render.
  if (isSelectiveAdjustActive(edit.selectiveAdjust)) {
    const selective = edit.selectiveAdjust;
    const mask = decodeSelectiveMask(selective.maskB64, selective.maskWidth, selective.maskHeight);
    if (mask) applySelectiveAdjust(output, width, height, mask, selective);
  }

  const clarity = edit.detailsEnabled ? clamp(edit.clarity, -100, 100) : 0;
  const sharpness = edit.detailsEnabled ? clamp(edit.sharpness, -100, 100) : 0;
  if (clarity === 0 && sharpness === 0) return { width, height, data: output };
  const luma = new Float32Array(pixels);
  for (let p = 0, i = 0; p < pixels; p += 1, i += 4) {
    luma[p] = luminanceOf(output[i] ?? 0, output[i + 1] ?? 0, output[i + 2] ?? 0);
  }
  if (clarity !== 0) {
    // Two blur iterations approximate a gaussian response, hiding box edges.
    let blurred = boxBlurPlane(luma, width, height, clarityRadiusForSize(width, height));
    blurred = boxBlurPlane(blurred, width, height, clarityRadiusForSize(width, height));
    const amount = (clarity / 100) * 1.5;
    for (let p = 0, i = 0; p < pixels; p += 1, i += 4) {
      const delta = ((luma[p] ?? 0) - (blurred[p] ?? 0)) * amount * midtoneWeight((luma[p] ?? 0) / 255);
      output[i] = (output[i] ?? 0) + delta;
      output[i + 1] = (output[i + 1] ?? 0) + delta;
      output[i + 2] = (output[i + 2] ?? 0) + delta;
    }
  }
  if (sharpness !== 0) {
    const blurred = boxBlurPlane(luma, width, height, SHARPNESS_RADIUS);
    const amount = (sharpness / 100) * 1.2;
    for (let p = 0, i = 0; p < pixels; p += 1, i += 4) {
      const delta = ((luma[p] ?? 0) - (blurred[p] ?? 0)) * amount;
      output[i] = (output[i] ?? 0) + delta;
      output[i + 1] = (output[i + 1] ?? 0) + delta;
      output[i + 2] = (output[i + 2] ?? 0) + delta;
    }
  }
  return { width, height, data: output };
}
