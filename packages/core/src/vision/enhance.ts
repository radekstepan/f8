// Histogram-based automatic adjustments: pure functions mapping pixel data
// to EditState patches. No DOM access; safe in Node tests, workers, and UI.
//
// computeAutoEnhance carries exposure, contrast, temperature, tint, and
// saturation; the per-section helpers carry their section's fields only.
// Geometry and retouch fields are owned by the caller.

import type { EditState } from "../types.js";
import { assertValidImage, channelMeans, type PixelImage } from "./analyze.js";

export type AutoEnhancePatch = Pick<
  EditState,
  "exposure" | "contrast" | "temperature" | "tint" | "saturation"
>;

export const AUTO_ENHANCE_KEYS = ["exposure", "contrast", "temperature", "tint", "saturation"] as const;

/** 256-bin histograms, one count per 8-bit value. Luminance uses Rec.709. */
export interface ChannelHistograms {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  luminance: Uint32Array;
}

export function channelHistograms(image: PixelImage): ChannelHistograms {
  assertValidImage(image);
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  const luminance = new Uint32Array(256);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    red[r] = (red[r] ?? 0) + 1;
    green[g] = (green[g] ?? 0) + 1;
    blue[b] = (blue[b] ?? 0) + 1;
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    luminance[lum] = (luminance[lum] ?? 0) + 1;
  }
  return { red, green, blue, luminance };
}

/**
 * Smallest bin whose cumulative count reaches `percentile` of `total`.
 * `percentile` is 0..1; values outside are clamped. Empty histograms
 * (total <= 0) yield 0.
 */
export function percentileValue(histogram: Uint32Array, total: number, percentile: number): number {
  if (total <= 0 || histogram.length === 0) return 0;
  const p = Math.min(1, Math.max(0, percentile));
  const target = Math.max(1, Math.ceil(p * total));
  let cumulative = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    cumulative += histogram[bin] ?? 0;
    if (cumulative >= target) return bin;
  }
  return histogram.length - 1;
}

export interface BlackWhitePoints {
  black: number;
  white: number;
}

/**
 * Robust tonal endpoints: the 1st and 99th luminance percentiles, so a few
 * clipped or noisy pixels cannot collapse the range the way min/max would.
 */
export function blackWhitePoints(image: PixelImage): BlackWhitePoints {
  const { luminance } = channelHistograms(image);
  const total = image.width * image.height;
  return {
    black: percentileValue(luminance, total, 0.01),
    white: percentileValue(luminance, total, 0.99),
  };
}

/** Target mean luminance (0..255) the exposure estimate aims for. */
export const EXPOSURE_TARGET_LUMINANCE = 128;

/**
 * Exposure shift in EV that would move the image's mean luminance toward
 * the target, given the preview pipeline maps exposure EV to a
 * 2^(EV * 0.6) brightness factor (see EXPOSURE_RESPONSE in adjustments.ts). Positive for dark
 * images, negative for bright ones, 0 within a small dead zone.
 * Gains are capped to protect already-bright highlights from clipping.
 */
export function estimateExposureShift(image: PixelImage): number {
  assertValidImage(image);
  const { r, g, b } = channelMeans(image);
  const mean = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (mean <= 1) return 1.5;
  let shift = Math.log2(EXPOSURE_TARGET_LUMINANCE / mean) / 0.6;
  const { white } = blackWhitePoints(image);
  if (shift > 0 && white > 240) shift = Math.min(shift, 0.5);
  if (Math.abs(shift) < 0.06) return 0;
  return Math.round(Math.min(1.5, Math.max(-1.5, shift)) * 100) / 100;
}

export interface WhiteBalanceGains {
  red: number;
  green: number;
  blue: number;
}

/**
 * Gray-world white-balance gains: per-channel factors that would equalize
 * the channel means. A channel stronger than gray gets a gain below 1.
 * Uniformly black images yield neutral gains of 1.
 */
export function grayWorldGains(image: PixelImage): WhiteBalanceGains {
  const { r, g, b } = channelMeans(image);
  const gray = (r + g + b) / 3;
  if (gray <= 0.5) return { red: 1, green: 1, blue: 1 };
  const clamp = (gain: number) => Math.min(4, Math.max(0.25, gain));
  return {
    red: clamp(gray / Math.max(1, r)),
    green: clamp(gray / Math.max(1, g)),
    blue: clamp(gray / Math.max(1, b)),
  };
}

/** Mean per-pixel saturation in 0..1, as (max-min)/max averaged. */
export function meanSaturation(image: PixelImage): number {
  assertValidImage(image);
  let sum = 0;
  const pixels = image.width * image.height;
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const bl = data[i + 2] ?? 0;
    const max = Math.max(r, g, bl);
    if (max > 0) sum += (max - Math.min(r, g, bl)) / max;
  }
  return sum / pixels;
}

const TEMPERATURE_NEUTRAL = 5500;

export type WhiteBalanceAutoPatch = Pick<EditState, "temperature" | "tint">;
export type LightnessAutoPatch = Pick<EditState, "exposure" | "contrast" | "highlights" | "shadows">;

/**
 * Derive the White Balance section's Auto values from pixel data. Warm
 * casts cool the temperature, green casts push tint negative (toward
 * magenta). Near-neutral images stay at the neutral defaults.
 */
export function computeWhiteBalanceAuto(image: PixelImage): WhiteBalanceAutoPatch {
  assertValidImage(image);
  const { r, g, b } = channelMeans(image);
  const gray = (r + g + b) / 3;

  let temperature = TEMPERATURE_NEUTRAL;
  let tint = 0;
  if (gray > 1) {
    const warmCast = (r - b) / gray;
    if (Math.abs(warmCast) >= 0.03) {
      temperature = Math.round(Math.min(10000, Math.max(2000, TEMPERATURE_NEUTRAL - warmCast * 2000)) / 50) * 50;
    }
    const greenCast = (g - (r + b) / 2) / gray;
    if (Math.abs(greenCast) >= 0.03) {
      tint = Math.round(Math.min(100, Math.max(-100, -greenCast * 80)));
    }
  }
  return { temperature, tint };
}

/**
 * Derive the Lightness section's Auto values from pixel data. Exposure
 * aims mean luminance at mid-gray, flat tonal ranges gain contrast,
 * clipped whites (over 2% of pixels at luminance 252+) are recovered
 * with negative highlights, and crushed blacks (over 2% at luminance
 * 3 or below) are lifted with positive shadows. Balanced images stay
 * near zero.
 */
export function computeLightnessAuto(image: PixelImage): LightnessAutoPatch {
  assertValidImage(image);
  const { black, white } = blackWhitePoints(image);
  const spread = white - black;
  let contrast = Math.round(Math.min(1, Math.max(0, (190 - spread) / 190)) * 45);
  if (contrast < 3) contrast = 0;

  const { luminance } = channelHistograms(image);
  const total = image.width * image.height;
  let atWhite = 0;
  let atBlack = 0;
  for (let bin = 252; bin < 256; bin += 1) atWhite += luminance[bin] ?? 0;
  for (let bin = 0; bin <= 3; bin += 1) atBlack += luminance[bin] ?? 0;
  const whiteFraction = atWhite / total;
  const blackFraction = atBlack / total;
  const highlights = whiteFraction > 0.02 ? -Math.round(Math.min(1, whiteFraction / 0.25) * 40) : 0;
  const shadows = blackFraction > 0.02 ? Math.round(Math.min(1, blackFraction / 0.25) * 30) : 0;

  return { exposure: estimateExposureShift(image), contrast, highlights, shadows };
}

/**
 * Derive the auto-enhance patch from pixel data. Warm casts cool the
 * temperature, green casts push tint negative (toward magenta), flat
 * tonal ranges gain contrast, and muted colors gain saturation.
 */
export function computeAutoEnhance(image: PixelImage): AutoEnhancePatch {
  assertValidImage(image);
  const { temperature, tint } = computeWhiteBalanceAuto(image);
  const { exposure, contrast } = computeLightnessAuto(image);

  const saturationRaw = meanSaturation(image);
  let saturation = 0;
  if (saturationRaw >= 0.05) {
    saturation = Math.round(Math.min(30, Math.max(0, (0.35 - saturationRaw) * 60)));
    if (saturation < 3) saturation = 0;
  }

  return { exposure, contrast, temperature, tint, saturation };
}
