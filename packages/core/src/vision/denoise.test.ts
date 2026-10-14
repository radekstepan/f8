import { describe, expect, it } from "vitest";
import {
  DENOISE_AUTO_ISO_THRESHOLD,
  blendDenoised,
  denoiseClassic,
  denoiseStrengthForIso,
  dismissDenoiseStatus,
  effectiveDenoiseStrength,
  isDenoiseActive,
  nextDenoiseRecipeSync,
  packDenoiseInput,
  parseDenoiseOutput,
  separateOriginalSrc,
  shouldAutoDenoise,
} from "./denoise.js";
import type { PixelImage } from "./analyze.js";
import type { DenoiseState } from "../types.js";

function flatImage(width: number, height: number, r: number, g: number, b: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function noisyImage(width: number, height: number): PixelImage {
  const image = flatImage(width, height, 128, 128, 128);
  for (let i = 0; i < width * height; i += 1) {
    // Deterministic alternating grain ±24.
    const delta = i % 2 === 0 ? 24 : -24;
    image.data[i * 4] = 128 + delta;
    image.data[i * 4 + 1] = 128 - delta;
    image.data[i * 4 + 2] = 128 + delta;
  }
  return image;
}

function lumaVariance(image: PixelImage): number {
  const plane = image.width * image.height;
  let mean = 0;
  for (let p = 0; p < plane; p += 1) {
    mean += 0.2126 * (image.data[p * 4] ?? 0) + 0.7152 * (image.data[p * 4 + 1] ?? 0) + 0.0722 * (image.data[p * 4 + 2] ?? 0);
  }
  mean /= plane;
  let variance = 0;
  for (let p = 0; p < plane; p += 1) {
    const luma = 0.2126 * (image.data[p * 4] ?? 0) + 0.7152 * (image.data[p * 4 + 1] ?? 0) + 0.0722 * (image.data[p * 4 + 2] ?? 0);
    variance += (luma - mean) * (luma - mean);
  }
  return variance / plane;
}

describe("denoiseStrengthForIso", () => {
  it("stays off at low ISO and caps at 65 for extreme ISO", () => {
    expect(denoiseStrengthForIso(100)).toBe(0);
    expect(denoiseStrengthForIso(400)).toBe(10);
    expect(denoiseStrengthForIso(800)).toBe(20);
    expect(denoiseStrengthForIso(1600)).toBe(35);
    expect(denoiseStrengthForIso(3200)).toBe(50);
    expect(denoiseStrengthForIso(6400)).toBe(65);
    expect(denoiseStrengthForIso(51200)).toBe(65);
  });

  it("treats missing or invalid ISOs as clean (no denoise)", () => {
    expect(denoiseStrengthForIso(0)).toBe(0);
    expect(denoiseStrengthForIso(-100)).toBe(0);
    expect(denoiseStrengthForIso(Number.NaN)).toBe(0);
    expect(denoiseStrengthForIso(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("shouldAutoDenoise", () => {
  it("engages at the 1600 threshold, never below", () => {
    expect(DENOISE_AUTO_ISO_THRESHOLD).toBe(1600);
    expect(shouldAutoDenoise(1599)).toBe(false);
    expect(shouldAutoDenoise(1600)).toBe(true);
    expect(shouldAutoDenoise(6400)).toBe(true);
    expect(shouldAutoDenoise(Number.NaN)).toBe(false);
  });
});

describe("effectiveDenoiseStrength", () => {
  it("follows the ISO ladder on auto, the slider when manual", () => {
    expect(effectiveDenoiseStrength(true, 90, 3200)).toBe(50);
    expect(effectiveDenoiseStrength(true, 90, 100)).toBe(0);
    expect(effectiveDenoiseStrength(false, 72.4, 3200)).toBe(72);
    expect(effectiveDenoiseStrength(false, 150, 100)).toBe(100);
    expect(effectiveDenoiseStrength(false, -5, 100)).toBe(0);
    expect(effectiveDenoiseStrength(false, Number.NaN, 100)).toBe(0);
  });
});

describe("isDenoiseActive", () => {
  it("is active only for positive strengths", () => {
    expect(isDenoiseActive(null)).toBe(false);
    expect(isDenoiseActive(undefined)).toBe(false);
    expect(isDenoiseActive({ strength: 0, auto: true, source: "onnx" })).toBe(false);
    expect(isDenoiseActive({ strength: 45, auto: true, source: "onnx" })).toBe(true);
  });
});

describe("separateOriginalSrc", () => {
  it("returns the true original while a derived base is on screen", () => {
    expect(separateOriginalSrc("blob:denoised", "http://localhost/photo.jpg")).toBe("http://localhost/photo.jpg");
  });

  it("returns null when the display src already is the original", () => {
    expect(separateOriginalSrc("http://localhost/photo.jpg", "http://localhost/photo.jpg")).toBeNull();
    expect(separateOriginalSrc("http://localhost/photo.jpg", undefined)).toBeNull();
    expect(separateOriginalSrc("http://localhost/photo.jpg", null)).toBeNull();
    expect(separateOriginalSrc("http://localhost/photo.jpg", "")).toBeNull();
  });
});

describe("packDenoiseInput", () => {
  it("packs RGB float32 NCHW 0..1", () => {
    const packed = packDenoiseInput(flatImage(2, 1, 255, 0, 128));
    expect(packed).toHaveLength(6);
    for (const [index, expected] of [1, 1, 0, 0, 128 / 255, 128 / 255].entries()) {
      expect(packed[index]).toBeCloseTo(expected, 5);
    }
  });
});

describe("parseDenoiseOutput", () => {
  const original = flatImage(2, 1, 100, 150, 200);

  it("blends the model output with the original by strength", () => {
    const plane = 2;
    const output = new Float32Array(3 * plane).fill(0.5);
    const full = parseDenoiseOutput(output, original, 100);
    expect(Array.from(full.data.slice(0, 4))).toEqual([128, 128, 128, 255]);
    const half = parseDenoiseOutput(output, original, 50);
    expect(Array.from(half.data.slice(0, 4))).toEqual([
      Math.round((100 + 128) / 2),
      Math.round((150 + 128) / 2),
      Math.round((200 + 128) / 2),
      255,
    ]);
    const off = parseDenoiseOutput(output, original, 0);
    expect(Array.from(off.data)).toEqual(Array.from(original.data));
  });

  it("clamps out-of-range outputs and sanitizes non-finite cells to the original", () => {
    const output = new Float32Array([-1, 2, Number.NaN, 0.5, Number.POSITIVE_INFINITY, 0.5]);
    const parsed = parseDenoiseOutput(output, flatImage(2, 1, 100, 150, 200), 100);
    // Pixel 0: red clamps to 0, green NaN keeps 150, blue +inf keeps 200.
    expect(Array.from(parsed.data.slice(0, 4))).toEqual([0, 150, 200, 255]);
    // Pixel 1: red clamps to 255, green/blue take 0.5.
    expect(Array.from(parsed.data.slice(4, 8))).toEqual([255, 128, 128, 255]);
  });

  it("rejects non-3-plane outputs", () => {
    expect(() => parseDenoiseOutput(new Float32Array(4), original, 50)).toThrow(RangeError);
  });
});

describe("blendDenoised", () => {
  it("mixes by strength and rejects size mismatches", () => {
    const original = flatImage(2, 1, 0, 0, 0);
    const clean = flatImage(2, 1, 200, 200, 200);
    expect(Array.from(blendDenoised(original, clean, 25).data.slice(0, 3))).toEqual([50, 50, 50]);
    expect(Array.from(blendDenoised(original, clean, 0).data)).toEqual(Array.from(original.data));
    expect(() => blendDenoised(original, flatImage(3, 1, 0, 0, 0), 50)).toThrow(RangeError);
  });
});

describe("denoiseClassic", () => {
  it("returns an equal copy at strength 0", () => {
    const noisy = noisyImage(16, 16);
    const out = denoiseClassic(noisy, 0);
    expect(Array.from(out.data)).toEqual(Array.from(noisy.data));
    expect(out.data).not.toBe(noisy.data);
  });

  it("reduces grain variance while leaving flat frames untouched", () => {
    const noisy = noisyImage(32, 32);
    const before = lumaVariance(noisy);
    const after = lumaVariance(denoiseClassic(noisy, 100));
    expect(after).toBeLessThan(before / 2);
    const flat = flatImage(16, 16, 90, 140, 200);
    expect(Array.from(denoiseClassic(flat, 100).data)).toEqual(Array.from(flat.data));
  });

  it("preserves strong edges better than it smooths grain", () => {
    // Left half black, right half white: the bilateral must keep the step.
    const image = flatImage(32, 16, 0, 0, 0);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 16; x < 32; x += 1) {
        const i = (y * 32 + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
      }
    }
    // Grain the mid-tones far from the edge.
    image.data[7 * 32 * 4 + 4 * 4] = 40;
    const out = denoiseClassic(image, 100);
    const leftOf = out.data[(8 * 32 + 13) * 4] ?? -1;
    const rightOf = out.data[(8 * 32 + 18) * 4] ?? -1;
    expect(leftOf).toBeLessThan(32);
    expect(rightOf).toBeGreaterThan(223);
  });

  it("scales smoothing with strength", () => {
    const noisy = noisyImage(32, 32);
    const base = lumaVariance(noisy);
    const low = lumaVariance(denoiseClassic(noisy, 25));
    const high = lumaVariance(denoiseClassic(noisy, 100));
    expect(low).toBeLessThan(base);
    expect(high).toBeLessThan(low);
  });
});

describe("nextDenoiseRecipeSync", () => {
  const base = (strength: number): DenoiseState => ({ strength, auto: false, source: "onnx" });

  it("writes the recipe once for a fresh base, then stays quiet on re-sightings", () => {
    const fresh = base(45);
    const first = nextDenoiseRecipeSync(null, fresh, null);
    expect(first).toEqual({ syncedBase: fresh, writeRecipe: true });
    // The recipe now matches (and any later render re-sights the same base).
    const second = nextDenoiseRecipeSync(first.syncedBase, fresh, base(45));
    expect(second).toEqual({ syncedBase: fresh, writeRecipe: false });
  });

  it("does not re-store the strength after undo clears the recipe (the reported bug)", () => {
    const applied = base(45);
    // Apply lands: recipe written.
    let synced = nextDenoiseRecipeSync(null, applied, null);
    expect(synced.writeRecipe).toBe(true);
    // Undo clears the recipe while the pixels stay live: no rewrite, so the
    // photo flips back to the original and the redo stack survives.
    synced = nextDenoiseRecipeSync(synced.syncedBase, applied, null);
    expect(synced).toEqual({ syncedBase: applied, writeRecipe: false });
    // Redo restores the recipe from history: nothing to write either.
    synced = nextDenoiseRecipeSync(synced.syncedBase, applied, base(45));
    expect(synced).toEqual({ syncedBase: applied, writeRecipe: false });
  });

  it("syncs a second apply at a new strength exactly once", () => {
    const first = base(45);
    let synced = nextDenoiseRecipeSync(null, first, null);
    expect(synced.writeRecipe).toBe(true);
    const second = base(60);
    synced = nextDenoiseRecipeSync(synced.syncedBase, second, base(45));
    expect(synced).toEqual({ syncedBase: second, writeRecipe: true });
    synced = nextDenoiseRecipeSync(synced.syncedBase, second, base(60));
    expect(synced.writeRecipe).toBe(false);
  });

  it("treats a restore at the stored strength as a pixels-only no-op that still records", () => {
    const restored = base(45);
    // Recipe already holds 45 (e.g. Reload → Restore): no history entry.
    let synced = nextDenoiseRecipeSync(null, restored, base(45));
    expect(synced).toEqual({ syncedBase: restored, writeRecipe: false });
    // But the sighting is recorded: a later undo past it must not resurrect the write.
    synced = nextDenoiseRecipeSync(synced.syncedBase, restored, null);
    expect(synced).toEqual({ syncedBase: restored, writeRecipe: false });
  });

  it("resets on a null base so the next apply after clear syncs fresh", () => {
    const applied = base(45);
    let synced = nextDenoiseRecipeSync(null, applied, null);
    expect(synced.writeRecipe).toBe(true);
    // Clear drops the pixels: record resets, nothing to write.
    synced = nextDenoiseRecipeSync(synced.syncedBase, null, null);
    expect(synced).toEqual({ syncedBase: null, writeRecipe: false });
    // A fresh apply afterwards writes again.
    const reapplied = base(45);
    synced = nextDenoiseRecipeSync(synced.syncedBase, reapplied, null);
    expect(synced).toEqual({ syncedBase: reapplied, writeRecipe: true });
  });

  it("compares auto and source too, not just the strength", () => {
    const autoBase: DenoiseState = { strength: 50, auto: true, source: "onnx" };
    // Same strength but manual in the recipe: still a mismatch, write it.
    expect(nextDenoiseRecipeSync(null, autoBase, base(50)).writeRecipe).toBe(true);
    const classicBase: DenoiseState = { strength: 50, auto: true, source: "classic" };
    expect(nextDenoiseRecipeSync(null, classicBase, autoBase).writeRecipe).toBe(true);
  });
});

describe("dismissDenoiseStatus", () => {
  it("drops every transient phase back to idle without an applied base", () => {
    // The reported bug: preview-ready used to fall through unchanged, so
    // its Cancel did nothing.
    for (const state of ["previewing", "preview-ready", "applying", "error"] as const) {
      expect(dismissDenoiseStatus(state, false), state).toBe("idle");
    }
  });

  it("drops every transient phase back to applied while pixels are applied", () => {
    // Before the fix, cancelling a re-preview of an applied photo landed
    // on idle with a stored recipe and a live base — a combination the
    // control renders with no actions at all (a dead end).
    for (const state of ["previewing", "preview-ready", "applying", "error"] as const) {
      expect(dismissDenoiseStatus(state, true), state).toBe("applied");
    }
  });

  it("leaves settled phases untouched so Cancel never hides applied pixels", () => {
    expect(dismissDenoiseStatus("idle", false)).toBeNull();
    expect(dismissDenoiseStatus("idle", true)).toBeNull();
    expect(dismissDenoiseStatus("applied", true)).toBeNull();
  });
});
