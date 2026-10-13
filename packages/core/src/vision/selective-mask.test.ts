import { describe, expect, it } from "vitest";
import {
  applySelectiveAdjust,
  decodeSelectiveMask,
  downsampleSelectiveMask,
  editHasSelectiveAdjust,
  encodeSelectiveMask,
  isSelectiveAdjustActive,
  isSelectiveAdjustParamsNeutral,
  normalizeSelectiveAdjust,
  packSelectiveMaskInput,
  parseSelectiveMaskOutput,
  proposeClassicSubjectMask,
  resizeSelectiveMask,
  selectiveAdjustForMask,
  selectiveMaskCoverage,
  SELECTIVE_MASK_DEFAULT_EXPOSURE,
  SELECTIVE_MASK_NORM_MEAN,
  SELECTIVE_MASK_NORM_STD,
  SELECTIVE_MASK_SIZE,
  type SelectiveMask,
} from "./selective-mask.js";
import { isNeutralEdit, renderAdjustedPixels } from "../adjustments.js";
import { DEFAULT_EDIT, isOriginalLook } from "../data.js";
import type { PixelImage } from "./analyze.js";
import type { DetectedFace } from "./face-exposure.js";

function solid(width: number, height: number, r: number, g: number, b: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function paintRect(image: PixelImage, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * image.width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
    }
  }
}

/** Skin-tone per the shared isSkinPixel rule (r-g=50, r-b=80). */
const SKIN: [number, number, number] = [210, 160, 130];

function mockFace(box = { x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.4 }): DetectedFace {
  return {
    box: { ...box },
    score: 0.9,
    leftEye: { x: 0.46, y: 0.28 },
    rightEye: { x: 0.54, y: 0.28 },
  };
}

function halfMask(width: number, height: number, leftIsSubject: boolean): SelectiveMask {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const subject = leftIsSubject ? x < width / 2 : x >= width / 2;
      data[y * width + x] = subject ? 1 : 0;
    }
  }
  return { width, height, data };
}

describe("packSelectiveMaskInput", () => {
  it("packs to 1x3x320x320 NCHW with ImageNet normalization", () => {
    const { data, geometry } = packSelectiveMaskInput(solid(64, 48, 255, 0, 0));
    expect(data.length).toBe(3 * SELECTIVE_MASK_SIZE * SELECTIVE_MASK_SIZE);
    expect(geometry).toEqual({ srcWidth: 64, srcHeight: 48 });
    const plane = SELECTIVE_MASK_SIZE * SELECTIVE_MASK_SIZE;
    const center = Math.floor(SELECTIVE_MASK_SIZE / 2) * SELECTIVE_MASK_SIZE + Math.floor(SELECTIVE_MASK_SIZE / 2);
    // Solid red: R normalizes (1-mean)/std, G/B normalize (0-mean)/std.
    expect(data[center] ?? 0).toBeCloseTo((1 - SELECTIVE_MASK_NORM_MEAN[0]) / SELECTIVE_MASK_NORM_STD[0], 4);
    expect(data[plane + center] ?? 0).toBeCloseTo((0 - SELECTIVE_MASK_NORM_MEAN[1]) / SELECTIVE_MASK_NORM_STD[1], 4);
    expect(data[2 * plane + center] ?? 0).toBeCloseTo((0 - SELECTIVE_MASK_NORM_MEAN[2]) / SELECTIVE_MASK_NORM_STD[2], 4);
  });

  it("maps quadrants through the stretch resize", () => {
    const image = solid(100, 100, 0, 0, 0);
    paintRect(image, 50, 50, 100, 100, 255, 255, 255);
    const { data } = packSelectiveMaskInput(image);
    const at = (gx: number, gy: number): number => data[gy * SELECTIVE_MASK_SIZE + gx] ?? 0;
    // Bottom-right grid cells see white (bright), top-left see black (dark).
    expect(at(300, 300)).toBeGreaterThan(at(20, 20) + 1);
  });
});

describe("parseSelectiveMaskOutput", () => {
  it("resamples probability outputs directly (no min-max stretch)", () => {
    // 4x4 rising 0..1 ramp: min at top-left, max at bottom-right. The 2x2
    // resample center-samples each quadrant: (0+1+4+5)/4/15=2.5/15 and
    // (10+11+14+15)/4/15=12.5/15 — used as-is, never stretched.
    const output = new Float32Array(16);
    for (let i = 0; i < 16; i += 1) output[i] = i / 15;
    const mask = parseSelectiveMaskOutput(output, 2, 2);
    expect(mask.width).toBe(2);
    expect(mask.height).toBe(2);
    expect(mask.data[0] ?? -1).toBeCloseTo(2.5 / 15, 5);
    expect(mask.data[3] ?? -1).toBeCloseTo(12.5 / 15, 5);
    for (const v of mask.data) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of mask.data) expect(v).toBeLessThanOrEqual(1);
  });

  it("accepts the real 320x320 single-channel shape", () => {
    const output = new Float32Array(320 * 320);
    for (let y = 150; y < 170; y += 1) {
      for (let x = 150; x < 170; x += 1) output[y * 320 + x] = 1;
    }
    const mask = parseSelectiveMaskOutput(output, 160, 160);
    expect(mask.data.length).toBe(160 * 160);
    expect(Math.max(...mask.data)).toBeCloseTo(1, 5);
    expect(mask.data[0] ?? -1).toBe(0);
  });

  it("preserves flat low-confidence outputs instead of stretching them", () => {
    // Subject-free photos yield all-low outputs; stretching would invent a
    // subject, so flat stays flat (the coverage gates report "no subject").
    const mask = parseSelectiveMaskOutput(new Float32Array([0.2, 0.2, 0.2, 0.2]), 2, 2);
    for (const v of mask.data) expect(v).toBeCloseTo(0.2, 5);
  });

  it("clamps out-of-range values and treats non-finite as background", () => {
    // Same-size resample center-samples each cell exactly.
    const mask = parseSelectiveMaskOutput([-5, 0.5, Number.NaN, 9], 2, 2);
    expect(mask.data[0] ?? -1).toBe(0);
    // Edge cells center-sample just inside the grid (edge clamp), and the
    // NaN neighbor must not poison the blend.
    expect(mask.data[1] ?? -1).toBeCloseTo(0.5, 1);
    expect(mask.data[1] ?? -1).toBeGreaterThan(0.4);
    expect(mask.data[2] ?? -1).toBe(0);
    expect(mask.data[3] ?? -1).toBe(1);
  });

  it("throws RangeError on misshaped outputs", () => {
    expect(() => parseSelectiveMaskOutput(new Float32Array(10), 2, 2)).toThrow(RangeError);
    expect(() => parseSelectiveMaskOutput(new Float32Array(0), 2, 2)).toThrow(RangeError);
    expect(() => parseSelectiveMaskOutput(new Float32Array(4), 0, 2)).toThrow(RangeError);
  });
});

describe("selectiveMaskCoverage", () => {
  it("reports the subject fraction", () => {
    expect(selectiveMaskCoverage(halfMask(10, 10, true))).toBeCloseTo(0.5, 5);
    expect(selectiveMaskCoverage({ width: 2, height: 2, data: new Float32Array(4) })).toBe(0);
  });
});

describe("resize/downsample", () => {
  it("upsamples a mask bilinearly", () => {
    const mask = resizeSelectiveMask({ width: 1, height: 1, data: new Float32Array([1]) }, 4, 4);
    expect([...mask.data].every((v) => v === 1)).toBe(true);
  });

  it("caps the long edge at the recipe width", () => {
    const data = new Float32Array(320 * 200).fill(0.7);
    const small = downsampleSelectiveMask({ width: 320, height: 200, data });
    expect(Math.max(small.width, small.height)).toBeLessThanOrEqual(96);
    expect(small.width).toBe(96);
    expect(small.height).toBe(60);
    expect(small.data[Math.floor(small.data.length / 2)] ?? 0).toBeCloseTo(0.7, 2);
  });

  it("leaves small masks untouched (copy)", () => {
    const data = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const same = downsampleSelectiveMask({ width: 2, height: 2, data });
    expect(same.width).toBe(2);
    expect(same.height).toBe(2);
    for (let i = 0; i < 4; i += 1) expect(same.data[i] ?? -1).toBeCloseTo(data[i] ?? -2, 6);
    expect(same.data).not.toBe(data);
  });
});

describe("mask encode/decode", () => {
  it("round-trips a mask through base64", () => {
    const mask = halfMask(16, 12, true);
    const decoded = decodeSelectiveMask(encodeSelectiveMask(mask), 16, 12);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(16);
    expect(decoded!.height).toBe(12);
    for (let i = 0; i < mask.data.length; i += 1) {
      expect(decoded!.data[i] ?? -1).toBeCloseTo(mask.data[i] ?? -2, 2);
    }
  });

  it("returns null on corrupt payloads instead of throwing", () => {
    expect(decodeSelectiveMask("!!!not-base64!!!", 4, 4)).toBeNull();
    expect(decodeSelectiveMask(encodeSelectiveMask(halfMask(4, 4, true)), 4, 3)).toBeNull();
    expect(decodeSelectiveMask("", 0, 4)).toBeNull();
    expect(decodeSelectiveMask("eA==", 2048, 2048)).toBeNull();
  });
});

describe("proposeClassicSubjectMask", () => {
  it("derives a head-and-shoulders mask from face boxes", () => {
    const image = solid(160, 160, 90, 140, 200);
    const mask = proposeClassicSubjectMask(image, [mockFace()]);
    expect(mask).not.toBeNull();
    const coverage = selectiveMaskCoverage(mask!);
    expect(coverage).toBeGreaterThan(0.01);
    expect(coverage).toBeLessThan(0.98);
    // Mask peaks over the face and extends below it (shoulders), not above.
    const at = (x: number, y: number): number =>
      mask!.data[Math.floor(y * mask!.height) * mask!.width + Math.floor(x * mask!.width)] ?? 0;
    expect(at(0.5, 0.3)).toBeGreaterThan(0.5);
    expect(at(0.5, 0.55)).toBeGreaterThan(0.3);
    expect(at(0.5, 0.05)).toBe(0);
    expect(at(0.05, 0.9)).toBe(0);
  });

  it("falls back to center-prior skin saliency without faces", () => {
    const image = solid(160, 160, 90, 140, 200);
    paintRect(image, 60, 60, 100, 100, ...SKIN);
    const mask = proposeClassicSubjectMask(image, []);
    expect(mask).not.toBeNull();
    const at = (x: number, y: number): number =>
      mask!.data[Math.floor(y * mask!.height) * mask!.width + Math.floor(x * mask!.width)] ?? 0;
    expect(at(0.5, 0.5)).toBeGreaterThan(at(0.05, 0.05));
  });

  it("returns null when there is no usable subject", () => {
    // Flat sky: saliency never concentrates, so no subject.
    expect(proposeClassicSubjectMask(solid(160, 160, 90, 140, 200), [])).toBeNull();
  });
});

describe("applySelectiveAdjust", () => {
  it("brightens the subject and leaves the background bit-identical", () => {
    const image = solid(8, 4, 100, 100, 100);
    const before = new Uint8ClampedArray(image.data);
    applySelectiveAdjust(image.data, 8, 4, halfMask(8, 4, true), {
      subject: { exposure: 1, contrast: 0, saturation: 0 },
      background: { exposure: 0, contrast: 0, saturation: 0 },
    });
    const gain = Math.pow(2, 0.6);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const i = (y * 8 + x) * 4;
        if (x < 4) {
          expect(image.data[i] ?? 0).toBe(Math.min(255, Math.round(100 * gain)));
        } else {
          expect(image.data[i] ?? -1).toBe(before[i]);
          expect(image.data[i + 1] ?? -1).toBe(before[i + 1]);
          expect(image.data[i + 2] ?? -1).toBe(before[i + 2]);
        }
      }
    }
  });

  it("applies the inverse mask for the background side", () => {
    const image = solid(8, 4, 100, 100, 100);
    const before = new Uint8ClampedArray(image.data);
    applySelectiveAdjust(image.data, 8, 4, halfMask(8, 4, true), {
      subject: { exposure: 0, contrast: 0, saturation: 0 },
      background: { exposure: 1, contrast: 0, saturation: 0 },
    });
    const gain = Math.pow(2, 0.6);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const i = (y * 8 + x) * 4;
        if (x >= 4) {
          expect(image.data[i] ?? 0).toBe(Math.min(255, Math.round(100 * gain)));
        } else {
          expect(image.data[i] ?? -1).toBe(before[i]);
        }
      }
    }
  });

  it("adjusts both sides at once without cross-talk on hard masks", () => {
    const image = solid(8, 4, 100, 100, 100);
    applySelectiveAdjust(image.data, 8, 4, halfMask(8, 4, true), {
      subject: { exposure: 1, contrast: 0, saturation: 0 },
      background: { exposure: -1, contrast: 0, saturation: 0 },
    });
    const up = Math.min(255, Math.round(100 * Math.pow(2, 0.6)));
    const down = Math.round(100 * Math.pow(2, -0.6));
    expect(image.data[0] ?? 0).toBe(up);
    const right = (0 * 8 + 7) * 4;
    expect(image.data[right] ?? 0).toBe(down);
  });

  it("renders legacy single-target adjusts onto their side", () => {
    const image = solid(8, 4, 100, 100, 100);
    applySelectiveAdjust(image.data, 8, 4, halfMask(8, 4, true), {
      target: "background",
      exposure: 1,
      contrast: 0,
      saturation: 0,
    });
    const gain = Math.pow(2, 0.6);
    expect(image.data[0] ?? 0).toBe(100);
    const right = (0 * 8 + 7) * 4;
    expect(image.data[right] ?? 0).toBe(Math.min(255, Math.round(100 * gain)));
  });

  it("blends softly at mid mask values", () => {
    const image = solid(2, 1, 100, 100, 100);
    applySelectiveAdjust(image.data, 2, 1, { width: 2, height: 1, data: new Float32Array([0.5, 0]) }, {
      subject: { exposure: 1, contrast: 0, saturation: 0 },
      background: { exposure: 0, contrast: 0, saturation: 0 },
    });
    const full = 100 * Math.pow(2, 0.6);
    expect(image.data[0] ?? 0).toBe(Math.round(100 + (full - 100) * 0.5));
    expect(image.data[4] ?? 0).toBe(100);
  });

  it("applies contrast and saturation through the mask", () => {
    const image = solid(4, 1, 100, 140, 180);
    applySelectiveAdjust(image.data, 4, 1, halfMask(4, 1, true), {
      subject: { exposure: 0, contrast: 50, saturation: -100 },
      background: { exposure: 0, contrast: 0, saturation: 0 },
    });
    // Left half: contrast pivots around 128, then full desaturation grays.
    const luma = Math.round(0.2126 * ((100 - 128) * 1.5 + 128) + 0.7152 * ((140 - 128) * 1.5 + 128) + 0.0722 * ((180 - 128) * 1.5 + 128));
    expect(image.data[0] ?? -1).toBe(luma);
    expect(image.data[1] ?? -1).toBe(luma);
    expect(image.data[2] ?? -1).toBe(luma);
    // Right half untouched.
    expect(image.data[8] ?? 0).toBe(100);
    expect(image.data[9] ?? 0).toBe(140);
    expect(image.data[10] ?? 0).toBe(180);
  });

  it("resamples recipe masks onto the render size", () => {
    const image = solid(8, 8, 100, 100, 100);
    applySelectiveAdjust(image.data, 8, 8, { width: 2, height: 2, data: new Float32Array([1, 1, 1, 1]) }, {
      subject: { exposure: 1, contrast: 0, saturation: 0 },
      background: { exposure: 0, contrast: 0, saturation: 0 },
    });
    const gain = Math.pow(2, 0.6);
    expect(image.data[0] ?? 0).toBe(Math.min(255, Math.round(100 * gain)));
  });

  it("is a no-op for neutral params and rejects mismatched buffers", () => {
    const image = solid(4, 4, 100, 100, 100);
    const before = new Uint8ClampedArray(image.data);
    const neutral = { exposure: 0, contrast: 0, saturation: 0 };
    applySelectiveAdjust(image.data, 4, 4, halfMask(4, 4, true), { subject: neutral, background: neutral });
    expect([...image.data]).toEqual([...before]);
    expect(() => applySelectiveAdjust(new Uint8ClampedArray(4), 4, 4, halfMask(4, 4, true), {
      subject: { exposure: 1, contrast: 0, saturation: 0 },
      background: neutral,
    })).toThrow(RangeError);
  });
});

describe("selectiveAdjustForMask", () => {
  it("builds the default brighten-subject suggestion with a neutral background", () => {
    const state = selectiveAdjustForMask(halfMask(160, 120, true), "onnx");
    expect(state).not.toBeNull();
    expect(state!.subject).toEqual({ exposure: SELECTIVE_MASK_DEFAULT_EXPOSURE, contrast: 0, saturation: 0 });
    expect(state!.background).toEqual({ exposure: 0, contrast: 0, saturation: 0 });
    expect(state!.source).toBe("onnx");
    expect(state!.maskWidth).toBe(96);
    expect(state!.maskHeight).toBe(72);
    expect(decodeSelectiveMask(state!.maskB64, state!.maskWidth, state!.maskHeight)).not.toBeNull();
  });

  it("returns null for empty or full-frame masks", () => {
    expect(selectiveAdjustForMask({ width: 4, height: 4, data: new Float32Array(16) }, "onnx")).toBeNull();
    expect(selectiveAdjustForMask({ width: 4, height: 4, data: new Float32Array(16).fill(1) }, "onnx")).toBeNull();
  });
});

describe("normalizeSelectiveAdjust", () => {
  it("maps legacy single-target recipes onto their side", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "onnx")!;
    const legacy = {
      maskB64: base.maskB64,
      maskWidth: base.maskWidth,
      maskHeight: base.maskHeight,
      target: "background" as const,
      exposure: 0,
      contrast: 0,
      saturation: -20,
      source: "classic" as const,
    };
    expect(normalizeSelectiveAdjust(legacy)).toEqual({
      maskB64: base.maskB64,
      maskWidth: base.maskWidth,
      maskHeight: base.maskHeight,
      subject: { exposure: 0, contrast: 0, saturation: 0 },
      background: { exposure: 0, contrast: 0, saturation: -20 },
      source: "classic",
    });
  });

  it("returns null for null, absent, and garbage input", () => {
    expect(normalizeSelectiveAdjust(null)).toBeNull();
    expect(normalizeSelectiveAdjust(undefined)).toBeNull();
    expect(normalizeSelectiveAdjust({} as never)).toBeNull();
    expect(normalizeSelectiveAdjust({ target: "nobody", maskB64: "eA==", maskWidth: 2, maskHeight: 2 } as never)).toBeNull();
  });

  it("preserves the bypass toggle and defaults legacy recipes to enabled", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "onnx")!;
    expect(normalizeSelectiveAdjust({ ...base, enabled: false })?.enabled).toBe(false);
    expect(normalizeSelectiveAdjust(base)?.enabled).toBeUndefined();
    const legacy = {
      maskB64: base.maskB64,
      maskWidth: base.maskWidth,
      maskHeight: base.maskHeight,
      target: "subject" as const,
      exposure: 0.5,
      contrast: 0,
      saturation: 0,
      source: "onnx" as const,
    };
    expect(normalizeSelectiveAdjust(legacy)?.enabled).toBeUndefined();
  });
});

describe("active-state contract", () => {
  it("is neutral only when every param is zero", () => {
    expect(isSelectiveAdjustParamsNeutral({ exposure: 0, contrast: 0, saturation: 0 })).toBe(true);
    expect(isSelectiveAdjustParamsNeutral({ exposure: 0.1, contrast: 0, saturation: 0 })).toBe(false);
    expect(isSelectiveAdjustParamsNeutral({ exposure: 0, contrast: -5, saturation: 0 })).toBe(false);
    expect(isSelectiveAdjustParamsNeutral({ exposure: 0, contrast: 0, saturation: 10 })).toBe(false);
  });

  it("activates when either side is non-neutral", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "classic")!;
    expect(isSelectiveAdjustActive(base)).toBe(true);
    expect(isSelectiveAdjustActive({ ...base, subject: { exposure: 0, contrast: 0, saturation: 0 } })).toBe(false);
    expect(
      isSelectiveAdjustActive({
        ...base,
        subject: { exposure: 0, contrast: 0, saturation: 0 },
        background: { exposure: 0, contrast: 0, saturation: 5 },
      }),
    ).toBe(true);
    expect(isSelectiveAdjustActive(null)).toBe(false);
    expect(isSelectiveAdjustActive(undefined)).toBe(false);
    expect(editHasSelectiveAdjust({ ...DEFAULT_EDIT, selectiveAdjust: base })).toBe(true);
    expect(editHasSelectiveAdjust({ ...DEFAULT_EDIT })).toBe(false);
  });

  it("stays inactive while toggled off, even when non-neutral", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "onnx")!;
    expect(isSelectiveAdjustActive(base)).toBe(true);
    expect(isSelectiveAdjustActive({ ...base, enabled: false })).toBe(false);
    expect(isSelectiveAdjustActive({ ...base, enabled: true })).toBe(true);
    expect(editHasSelectiveAdjust({ ...DEFAULT_EDIT, selectiveAdjust: { ...base, enabled: false } })).toBe(false);
  });

  it("activates on legacy single-target recipes", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "classic")!;
    const legacy = {
      maskB64: base.maskB64,
      maskWidth: base.maskWidth,
      maskHeight: base.maskHeight,
      target: "subject" as const,
      exposure: 0.5,
      contrast: 0,
      saturation: 0,
      source: "classic" as const,
    };
    expect(isSelectiveAdjustActive(legacy)).toBe(true);
    expect(isSelectiveAdjustActive({ ...legacy, exposure: 0 })).toBe(false);
    expect(isSelectiveAdjustActive({ ...legacy, target: "nobody" as never })).toBe(false);
  });
});

describe("pipeline integration", () => {
  it("renders the selective pass and counts it in neutrality", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "onnx")!;
    const edit = { ...DEFAULT_EDIT, selectiveAdjust: base };
    expect(isNeutralEdit(edit)).toBe(false);
    expect(
      isNeutralEdit({ ...DEFAULT_EDIT, selectiveAdjust: { ...base, subject: { exposure: 0, contrast: 0, saturation: 0 } } }),
    ).toBe(true);
    const rendered = renderAdjustedPixels(solid(16, 16, 100, 100, 100), edit);
    const gain = Math.pow(2, SELECTIVE_MASK_DEFAULT_EXPOSURE * 0.6);
    // Left half lifted, right half untouched.
    expect(rendered.data[0] ?? 0).toBe(Math.min(255, Math.round(100 * gain)));
    const right = (8 * 4);
    expect(rendered.data[right] ?? 0).toBe(100);
  });

  it("bypasses the selective pass while toggled off", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "onnx")!;
    const edit = { ...DEFAULT_EDIT, selectiveAdjust: { ...base, enabled: false } };
    expect(isNeutralEdit(edit)).toBe(true);
    const rendered = renderAdjustedPixels(solid(16, 16, 100, 100, 100), edit);
    expect([...rendered.data].every((v, i) => (i % 4 === 3 ? v === 255 : v === 100))).toBe(true);
  });

  it("skips corrupt masks instead of breaking the render", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "onnx")!;
    const rendered = renderAdjustedPixels(solid(8, 8, 100, 100, 100), {
      ...DEFAULT_EDIT,
      selectiveAdjust: { ...base, maskB64: "!!!corrupt!!!" },
    });
    expect([...rendered.data].every((v, i) => (i % 4 === 3 ? v === 255 : v === 100))).toBe(true);
  });

  it("marks the look non-original", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "onnx")!;
    expect(isOriginalLook({ ...DEFAULT_EDIT, selectiveAdjust: base })).toBe(false);
  });

  it("renders legacy single-target recipes through the pipeline", () => {
    const base = selectiveAdjustForMask(halfMask(16, 16, true), "onnx")!;
    const legacy = {
      maskB64: base.maskB64,
      maskWidth: base.maskWidth,
      maskHeight: base.maskHeight,
      target: "subject" as const,
      exposure: SELECTIVE_MASK_DEFAULT_EXPOSURE,
      contrast: 0,
      saturation: 0,
      source: "onnx" as const,
    };
    // Legacy shape persisted on disk; cast rides the real untyped JSON path.
    const edit = { ...DEFAULT_EDIT, selectiveAdjust: legacy as unknown as typeof base };
    expect(isNeutralEdit(edit)).toBe(false);
    const rendered = renderAdjustedPixels(solid(16, 16, 100, 100, 100), edit);
    const gain = Math.pow(2, SELECTIVE_MASK_DEFAULT_EXPOSURE * 0.6);
    expect(rendered.data[0] ?? 0).toBe(Math.min(255, Math.round(100 * gain)));
    expect(rendered.data[8 * 4] ?? 0).toBe(100);
  });
});
