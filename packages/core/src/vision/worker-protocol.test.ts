import { describe, expect, it } from "vitest";
import {
  createGrayscaleRequest,
  createPingRequest,
  grayscaleReference,
  isVisionWorkerRequest,
  isVisionWorkerResponse,
} from "./worker-protocol.js";
import { solidColor } from "./fixtures.js";

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

  it.each([
    ["null", null],
    ["string", "ping"],
    ["array", []],
    ["missing kind", { id: 1 }],
    ["unknown kind", { id: 1, kind: "straighten" }],
    ["missing id", { kind: "ping" }],
    ["non-integer id", { id: 1.5, kind: "ping" }],
    ["zero width", { id: 1, kind: "grayscale", width: 0, height: 4, data: new Uint8ClampedArray(0) }],
    ["negative height", { id: 1, kind: "grayscale", width: 4, height: -1, data: new Uint8ClampedArray(0) }],
    ["fractional width", { id: 1, kind: "grayscale", width: 2.5, height: 4, data: new Uint8ClampedArray(40) }],
    ["plain array pixels", { id: 1, kind: "grayscale", width: 1, height: 1, data: [0, 0, 0, 255] }],
    ["Uint8Array pixels", { id: 1, kind: "grayscale", width: 1, height: 1, data: new Uint8Array(4) }],
    ["short buffer", { id: 1, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(63) }],
    ["long buffer", { id: 1, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(65) }],
  ])("rejects %s", (_label, value) => {
    expect(isVisionWorkerRequest(value)).toBe(false);
  });
});

describe("isVisionWorkerResponse", () => {
  it("accepts pong, grayscale, and error responses", () => {
    expect(isVisionWorkerResponse({ id: 1, kind: "pong", version: "5.0.0" })).toBe(true);
    expect(
      isVisionWorkerResponse({ id: 2, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(16) }),
    ).toBe(true);
    expect(isVisionWorkerResponse({ id: 3, kind: "error", message: "boom" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["unknown kind", { id: 1, kind: "pong2", version: "5.0.0" }],
    ["missing id", { kind: "pong", version: "5.0.0" }],
    ["non-string version", { id: 1, kind: "pong", version: 500 }],
    ["missing message", { id: 1, kind: "error" }],
    ["short gray buffer", { id: 1, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(15) }],
    ["RGBA-sized gray buffer", { id: 1, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(64) }],
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
