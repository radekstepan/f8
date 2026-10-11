import { describe, expect, it } from "vitest";
import {
  createGrayscaleRequest,
  createInpaintRequest,
  createMlWarmupRequest,
  createPingRequest,
  createStraightenRequest,
  grayscaleReference,
  isVisionWorkerRequest,
  isVisionWorkerResponse,
} from "./worker-protocol.js";
import { solidColor } from "./fixtures.js";
import type { RepairMask } from "./inpaint.js";

function testMask(width: number, height: number): RepairMask {
  return { width, height, data: new Uint8ClampedArray(width * height) };
}

describe("createPingRequest", () => {
  it("builds a ping with the given id", () => {
    expect(createPingRequest(7)).toEqual({ id: 7, kind: "ping" });
  });
});

describe("createGrayscaleRequest", () => {
  it("carries dimensions and pixels", () => {
    const image = solidColor(4, 4, 10, 20, 30);
    expect(createGrayscaleRequest(3, image)).toEqual({
      id: 3,
      kind: "grayscale",
      width: 4,
      height: 4,
      data: image.data,
    });
  });

  it("rejects images with mismatched buffers", () => {
    expect(() =>
      createGrayscaleRequest(1, { width: 4, height: 4, data: new Uint8ClampedArray(8) }),
    ).toThrow(RangeError);
  });
});

describe("createStraightenRequest", () => {
  it("carries dimensions and pixels", () => {
    const image = solidColor(8, 6, 10, 20, 30);
    expect(createStraightenRequest(5, image)).toEqual({
      id: 5,
      kind: "straighten",
      width: 8,
      height: 6,
      data: image.data,
    });
  });

  it("rejects images with mismatched buffers", () => {
    expect(() =>
      createStraightenRequest(1, { width: 8, height: 6, data: new Uint8ClampedArray(8) }),
    ).toThrow(RangeError);
  });
});

describe("createInpaintRequest", () => {
  it("carries dimensions, pixels, mask, radius, and method", () => {
    const image = solidColor(8, 6, 10, 20, 30);
    const mask = testMask(8, 6);
    expect(createInpaintRequest(9, image, mask, 5, "ns")).toEqual({
      id: 9,
      kind: "inpaint",
      width: 8,
      height: 6,
      data: image.data,
      mask: mask.data,
      radius: 5,
      method: "ns",
    });
  });

  it("rejects mismatched image and mask dimensions", () => {
    expect(() =>
      createInpaintRequest(1, solidColor(8, 6, 0, 0, 0), testMask(4, 6), 3, "telea"),
    ).toThrow(RangeError);
  });

  it("rejects non-positive and non-finite radii", () => {
    const image = solidColor(4, 4, 0, 0, 0);
    const mask = testMask(4, 4);
    expect(() => createInpaintRequest(1, image, mask, 0, "telea")).toThrow(RangeError);
    expect(() => createInpaintRequest(1, image, mask, -2, "telea")).toThrow(RangeError);
    expect(() => createInpaintRequest(1, image, mask, NaN, "telea")).toThrow(RangeError);
  });

  it("accepts the heal method", () => {
    const image = solidColor(4, 4, 0, 0, 0);
    expect(createInpaintRequest(2, image, testMask(4, 4), 3, "heal").method).toBe("heal");
  });

  it("carries an explicit heal quality and omits the key otherwise", () => {
    const image = solidColor(4, 4, 0, 0, 0);
    const mask = testMask(4, 4);
    expect(createInpaintRequest(2, image, mask, 3, "heal", "best")).toMatchObject({ quality: "best" });
    expect("quality" in createInpaintRequest(2, image, mask, 3, "heal")).toBe(false);
  });

  it("carries an explicit seamlessLight flag and omits the key otherwise", () => {
    const image = solidColor(4, 4, 0, 0, 0);
    const mask = testMask(4, 4);
    expect(createInpaintRequest(2, image, mask, 3, "heal", "balanced", true)).toMatchObject({
      seamlessLight: true,
    });
    expect("seamlessLight" in createInpaintRequest(2, image, mask, 3, "heal")).toBe(false);
  });

  it("rejects a non-boolean seamlessLight flag", () => {
    const image = solidColor(4, 4, 0, 0, 0);
    expect(() =>
      createInpaintRequest(1, image, testMask(4, 4), 3, "heal", "balanced", "yes" as never),
    ).toThrow(RangeError);
  });

  it("rejects unknown methods", () => {
    expect(() =>
      createInpaintRequest(1, solidColor(4, 4, 0, 0, 0), testMask(4, 4), 3, "patchmatch" as never),
    ).toThrow(RangeError);
  });

  it("rejects unknown qualities", () => {
    const image = solidColor(4, 4, 0, 0, 0);
    expect(() => createInpaintRequest(1, image, testMask(4, 4), 3, "heal", "ultra" as never)).toThrow(
      RangeError,
    );
  });
});

describe("isVisionWorkerRequest", () => {
  it("accepts a ping", () => {
    expect(isVisionWorkerRequest({ id: 1, kind: "ping" })).toBe(true);
  });

  it("accepts a grayscale request with an exact RGBA buffer", () => {
    expect(
      isVisionWorkerRequest({
        id: 2,
        kind: "grayscale",
        width: 4,
        height: 4,
        data: new Uint8ClampedArray(64),
      }),
    ).toBe(true);
  });

  it("accepts a straighten request with an exact RGBA buffer", () => {
    expect(
      isVisionWorkerRequest({
        id: 3,
        kind: "straighten",
        width: 8,
        height: 6,
        data: new Uint8ClampedArray(8 * 6 * 4),
      }),
    ).toBe(true);
  });

  it("accepts an inpaint request with exact RGBA and mask buffers", () => {
    expect(
      isVisionWorkerRequest({
        id: 4,
        kind: "inpaint",
        width: 8,
        height: 6,
        data: new Uint8ClampedArray(8 * 6 * 4),
        mask: new Uint8ClampedArray(8 * 6),
        radius: 3,
        method: "telea",
      }),
    ).toBe(true);
  });

  it.each(["telea", "ns", "heal", "ml-heal"] as const)("accepts the %s inpaint method", (method) => {
    expect(
      isVisionWorkerRequest({
        id: 4,
        kind: "inpaint",
        width: 8,
        height: 6,
        data: new Uint8ClampedArray(8 * 6 * 4),
        mask: new Uint8ClampedArray(8 * 6),
        radius: 3,
        method,
      }),
    ).toBe(true);
  });

  it.each(["fast", "balanced", "best"] as const)("accepts the %s heal quality", (quality) => {
    expect(
      isVisionWorkerRequest({
        id: 4,
        kind: "inpaint",
        width: 8,
        height: 6,
        data: new Uint8ClampedArray(8 * 6 * 4),
        mask: new Uint8ClampedArray(8 * 6),
        radius: 3,
        method: "heal",
        quality,
      }),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["string", "ping"],
    ["array", []],
    ["missing kind", { id: 1 }],
    ["unknown kind", { id: 1, kind: "sharpen" }],
    ["missing id", { kind: "ping" }],
    ["non-integer id", { id: 1.5, kind: "ping" }],
    ["zero width", { id: 1, kind: "grayscale", width: 0, height: 4, data: new Uint8ClampedArray(0) }],
    ["negative height", { id: 1, kind: "grayscale", width: 4, height: -1, data: new Uint8ClampedArray(0) }],
    ["fractional width", { id: 1, kind: "grayscale", width: 2.5, height: 4, data: new Uint8ClampedArray(40) }],
    ["plain array pixels", { id: 1, kind: "grayscale", width: 1, height: 1, data: [0, 0, 0, 255] }],
    ["Uint8Array pixels", { id: 1, kind: "grayscale", width: 1, height: 1, data: new Uint8Array(4) }],
    ["short buffer", { id: 1, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(63) }],
    ["long buffer", { id: 1, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(65) }],
    ["inpaint without mask", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64), radius: 3, method: "telea" }],
    ["inpaint with RGBA-sized mask", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64), mask: new Uint8ClampedArray(64), radius: 3, method: "telea" }],
    ["inpaint with plain-array mask", { id: 1, kind: "inpaint", width: 1, height: 1, data: new Uint8ClampedArray(4), mask: [255], radius: 3, method: "telea" }],
    ["inpaint without radius", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64), mask: new Uint8ClampedArray(16), method: "telea" }],
    ["inpaint with zero radius", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64), mask: new Uint8ClampedArray(16), radius: 0, method: "telea" }],
    ["inpaint with NaN radius", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64), mask: new Uint8ClampedArray(16), radius: NaN, method: "telea" }],
    ["inpaint without method", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64), mask: new Uint8ClampedArray(16), radius: 3 }],
    ["inpaint with unknown method", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64), mask: new Uint8ClampedArray(16), radius: 3, method: "patchmatch" }],
    ["inpaint with unknown quality", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64), mask: new Uint8ClampedArray(16), radius: 3, method: "heal", quality: "ultra" }],
  ])("rejects %s", (_label, value) => {
    expect(isVisionWorkerRequest(value)).toBe(false);
  });
});

describe("isVisionWorkerResponse", () => {
  it("accepts pong, grayscale, straighten, inpaint, progress, and error responses", () => {
    expect(isVisionWorkerResponse({ id: 1, kind: "pong", version: "5.0.0" })).toBe(true);
    expect(
      isVisionWorkerResponse({ id: 2, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(16) }),
    ).toBe(true);
    expect(isVisionWorkerResponse({ id: 3, kind: "straighten", angle: -2.5, confidence: 0.8 })).toBe(true);
    expect(
      isVisionWorkerResponse({ id: 4, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64) }),
    ).toBe(true);
    expect(
      isVisionWorkerResponse({ id: 4, kind: "inpaint-progress", fraction: 0.5, stage: "Healing 1/2" }),
    ).toBe(true);
    expect(isVisionWorkerResponse({ id: 5, kind: "error", message: "boom" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["unknown kind", { id: 1, kind: "pong2", version: "5.0.0" }],
    ["missing id", { kind: "pong", version: "5.0.0" }],
    ["non-string version", { id: 1, kind: "pong", version: 500 }],
    ["missing message", { id: 1, kind: "error" }],
    ["short gray buffer", { id: 1, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(15) }],
    ["RGBA-sized gray buffer", { id: 1, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(64) }],
    ["straighten without angle", { id: 1, kind: "straighten", confidence: 0.8 }],
    ["straighten with NaN angle", { id: 1, kind: "straighten", angle: NaN, confidence: 0.8 }],
    ["straighten without confidence", { id: 1, kind: "straighten", angle: 1 }],
    ["straighten with negative confidence", { id: 1, kind: "straighten", angle: 1, confidence: -0.1 }],
    ["straighten with oversized confidence", { id: 1, kind: "straighten", angle: 1, confidence: 1.5 }],
    ["short inpaint buffer", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(63) }],
    ["single-channel inpaint buffer", { id: 1, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(16) }],
    ["progress without fraction", { id: 1, kind: "inpaint-progress", stage: "Healing" }],
    ["progress with NaN fraction", { id: 1, kind: "inpaint-progress", fraction: NaN, stage: "Healing" }],
    ["progress with negative fraction", { id: 1, kind: "inpaint-progress", fraction: -0.1, stage: "Healing" }],
    ["progress with oversized fraction", { id: 1, kind: "inpaint-progress", fraction: 1.5, stage: "Healing" }],
    ["progress without stage", { id: 1, kind: "inpaint-progress", fraction: 0.5 }],
  ])("rejects %s", (_label, value) => {
    expect(isVisionWorkerResponse(value)).toBe(false);
  });
});

describe("grayscaleReference", () => {
  it("matches OpenCV BT.601 luma on primary colors", () => {
    // 2x2: red, green / blue, white. Values verified against real
    // cv.cvtColor(..., COLOR_RGBA2GRAY): [76, 150, 29, 255].
    const image = solidColor(2, 2, 0, 0, 0);
    image.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    expect(Array.from(grayscaleReference(image))).toEqual([76, 150, 29, 255]);
  });

  it("ignores alpha and keeps mid-gray stable", () => {
    const image = solidColor(3, 2, 128, 128, 128, 0);
    expect(Array.from(grayscaleReference(image))).toEqual([128, 128, 128, 128, 128, 128]);
  });
});

describe("ml-warmup", () => {
  it.each(["classic", "lama", "moebius"] as const)("accepts the %s warmup engine", (engine) => {
    expect(isVisionWorkerRequest(createMlWarmupRequest(9, engine))).toBe(true);
  });

  it("rejects unknown engines", () => {
    expect(() => createMlWarmupRequest(9, "gan" as never)).toThrow(RangeError);
    expect(isVisionWorkerRequest({ id: 9, kind: "ml-warmup", engine: "gan" })).toBe(false);
  });

  it("accepts ml-ready with a cached flag", () => {
    expect(isVisionWorkerResponse({ id: 9, kind: "ml-ready", engine: "moebius", cached: true })).toBe(true);
    expect(isVisionWorkerResponse({ id: 9, kind: "ml-ready", engine: "moebius" })).toBe(false);
  });
});
