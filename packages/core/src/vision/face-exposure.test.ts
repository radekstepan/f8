import { describe, expect, it } from "vitest";
import {
  applyFaceLift,
  applyRedEyeFix,
  computeFaceWhiteBalance,
  editHasFaceAdjust,
  estimateEyesForBox,
  faceAdjustForFaces,
  faceLiftAmount,
  faceLiftMask,
  faceMeanLuminance,
  faceSkinMeans,
  findRedEyeSpots,
  isFaceAdjustActive,
  isFaceAdjustStored,
  packFaceDetectInput,
  parseYuNetFaces,
  proposeFaceCandidates,
  FACE_DETECT_CLASSIC_SCORE,
  FACE_DETECT_MAX_FACES,
  FACE_DETECT_SIZE,
  type DetectedFace,
  type YuNetOutputs,
} from "./face-exposure.js";
import { isNeutralEdit, renderAdjustedPixels } from "../adjustments.js";
import { DEFAULT_EDIT } from "../data.js";
import { whiteBalancePatchFromMeans } from "./enhance.js";
import type { PixelImage } from "./analyze.js";

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
/** Dark skin-tone (r-g=30, r-b=50, luminance ≈ 95). */
const DARK_SKIN: [number, number, number] = [120, 90, 70];

function mockFace(box = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }): DetectedFace {
  return {
    box: { ...box },
    score: 0.9,
    leftEye: { x: 0.4, y: 0.44 },
    rightEye: { x: 0.6, y: 0.44 },
  };
}

function emptyYuNet(): YuNetOutputs {
  const cells = (stride: number): number => (FACE_DETECT_SIZE / stride) ** 2;
  return {
    cls: [8, 16, 32].map((s) => new Float32Array(cells(s))),
    obj: [8, 16, 32].map((s) => new Float32Array(cells(s))),
    bbox: [8, 16, 32].map((s) => new Float32Array(cells(s) * 4)),
    kps: [8, 16, 32].map((s) => new Float32Array(cells(s) * 10)),
  };
}

/** Plant one YuNet cell: score=sqrt(cls*obj), box (dx,dy,dw,dh), eyes (ex0,ey0,ex1,ey1). */
function plantCell(
  outputs: YuNetOutputs,
  strideIndex: number,
  stride: number,
  c: number,
  r: number,
  cls: number,
  obj: number,
  box: [number, number, number, number],
  eyes: [number, number, number, number],
): void {
  const grid = FACE_DETECT_SIZE / stride;
  const idx = r * grid + c;
  (outputs.cls[strideIndex] as Float32Array)[idx] = cls;
  (outputs.obj[strideIndex] as Float32Array)[idx] = obj;
  (outputs.bbox[strideIndex] as Float32Array).set(box, idx * 4);
  (outputs.kps[strideIndex] as Float32Array).set(eyes, idx * 10);
}

describe("packFaceDetectInput", () => {
  it("packs BGR float32 NCHW at the 640 grid", () => {
    const { data, geometry } = packFaceDetectInput(solid(4, 2, 255, 0, 0));
    expect(data.length).toBe(3 * FACE_DETECT_SIZE * FACE_DETECT_SIZE);
    expect(geometry).toEqual({ srcWidth: 4, srcHeight: 2 });
    const plane = FACE_DETECT_SIZE * FACE_DETECT_SIZE;
    // Solid red: B=0, G=0, R=255 in every plane position.
    for (const p of [0, 12345, plane - 1]) {
      expect(data[p]).toBe(0);
      expect(data[plane + p]).toBe(0);
      expect(data[2 * plane + p]).toBe(255);
    }
  });
});

describe("parseYuNetFaces", () => {
  it("decodes one cell to a normalized box with eye landmarks", () => {
    const outputs = emptyYuNet();
    // Cell (40,30) @ stride 8: center (324,244), 80x80 box, eyes at 40.3/40.7.
    plantCell(outputs, 0, 8, 40, 30, 0.9, 0.8, [0.5, 0.5, Math.log(10), Math.log(10)], [0.3, 0.4, 0.7, 0.4]);
    const faces = parseYuNetFaces(outputs, { srcWidth: 100, srcHeight: 50 });
    expect(faces).toHaveLength(1);
    const face = faces[0]!;
    expect(face.score).toBeCloseTo(Math.sqrt(0.72), 5);
    expect(face.box.x0).toBeCloseTo(284 / 640, 5);
    expect(face.box.y0).toBeCloseTo(204 / 640, 5);
    expect(face.box.x1).toBeCloseTo(364 / 640, 5);
    expect(face.box.y1).toBeCloseTo(284 / 640, 5);
    expect(face.leftEye?.x).toBeCloseTo((40.3 * 8) / 640, 5);
    expect(face.leftEye?.y).toBeCloseTo((30.4 * 8) / 640, 5);
    expect(face.rightEye?.x).toBeCloseTo((40.7 * 8) / 640, 5);
    expect(face.rightEye?.y).toBeCloseTo((30.4 * 8) / 640, 5);
  });

  it("filters below the score threshold", () => {
    const outputs = emptyYuNet();
    plantCell(outputs, 0, 8, 10, 10, 0.5, 0.5, [0.5, 0.5, 0, 0], [0, 0, 1, 0]);
    expect(parseYuNetFaces(outputs, { srcWidth: 10, srcHeight: 10 })).toHaveLength(0);
  });

  it("suppresses overlapping boxes and returns score-descending faces", () => {
    const outputs = emptyYuNet();
    const box: [number, number, number, number] = [0.5, 0.5, Math.log(10), Math.log(10)];
    plantCell(outputs, 0, 8, 40, 30, 0.9, 0.9, box, [0.3, 0.4, 0.7, 0.4]);
    plantCell(outputs, 0, 8, 41, 30, 0.8, 0.8, box, [0.3, 0.4, 0.7, 0.4]);
    plantCell(outputs, 2, 32, 2, 2, 0.7, 0.7, [0.5, 0.5, 0, 0], [0.2, 0.3, 0.8, 0.3]);
    const faces = parseYuNetFaces(outputs, { srcWidth: 10, srcHeight: 10 });
    expect(faces).toHaveLength(2);
    expect(faces[0]!.score).toBeCloseTo(0.9, 5);
    expect(faces[1]!.score).toBeCloseTo(0.7, 5);
  });

  it("honors the max-faces cap", () => {
    const outputs = emptyYuNet();
    plantCell(outputs, 0, 8, 5, 5, 0.9, 0.9, [0.5, 0.5, 0, 0], [0, 0, 1, 0]);
    plantCell(outputs, 0, 8, 60, 60, 0.8, 0.8, [0.5, 0.5, 0, 0], [0, 0, 1, 0]);
    const faces = parseYuNetFaces(outputs, { srcWidth: 10, srcHeight: 10 }, { maxFaces: 1 });
    expect(faces).toHaveLength(1);
    expect(faces[0]!.score).toBeCloseTo(0.9, 5);
    expect(FACE_DETECT_MAX_FACES).toBe(20);
  });

  it("rejects misshaped outputs", () => {
    const outputs = emptyYuNet();
    outputs.cls = [new Float32Array(10), outputs.cls[1]!, outputs.cls[2]!];
    expect(() => parseYuNetFaces(outputs, { srcWidth: 10, srcHeight: 10 })).toThrow(RangeError);
  });
});

describe("proposeFaceCandidates", () => {
  it("finds a skin square with proportional eyes", () => {
    const image = solid(160, 160, 80, 80, 80);
    paintRect(image, 48, 48, 112, 112, ...SKIN);
    const faces = proposeFaceCandidates(image);
    expect(faces).toHaveLength(1);
    const face = faces[0]!;
    expect(face.score).toBe(FACE_DETECT_CLASSIC_SCORE);
    expect(face.box.x0).toBeLessThanOrEqual(48 / 160);
    expect(face.box.x1).toBeGreaterThanOrEqual(112 / 160);
    expect(face.box.y0).toBeLessThanOrEqual(48 / 160);
    expect(face.box.y1).toBeGreaterThanOrEqual(112 / 160);
    expect(face.leftEye!.x).toBeCloseTo(face.box.x0 + (face.box.x1 - face.box.x0) * 0.3, 5);
    expect(face.rightEye!.x).toBeCloseTo(face.box.x0 + (face.box.x1 - face.box.x0) * 0.7, 5);
  });

  it("finds nothing without skin and rejects full-frame warmth", () => {
    expect(proposeFaceCandidates(solid(160, 160, 80, 80, 80))).toHaveLength(0);
    expect(proposeFaceCandidates(solid(160, 160, ...SKIN))).toHaveLength(0);
  });
});

describe("estimateEyesForBox", () => {
  it("places eyes at 30/70% width and 38% height", () => {
    const { leftEye, rightEye } = estimateEyesForBox({ x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.9 });
    expect(leftEye).toEqual({ x: 0.32, y: 0.404 });
    expect(rightEye).toEqual({ x: 0.48, y: 0.404 });
  });
});

describe("computeFaceWhiteBalance", () => {
  it("anchors on skin means instead of the backdrop", () => {
    const image = solid(64, 64, 60, 80, 180);
    paintRect(image, 16, 16, 48, 48, ...SKIN);
    const anchored = computeFaceWhiteBalance(image, [mockFace()]);
    expect(anchored).toEqual(whiteBalancePatchFromMeans(...SKIN));
    // The blue backdrop would warm the whole-image auto; skin anchors cooler.
    expect(anchored!.temperature).toBeLessThan(5500);
    expect(anchored!.temperature).toBe(4550);
  });

  it("returns null without faces or without enough skin", () => {
    const image = solid(64, 64, 60, 80, 180);
    expect(computeFaceWhiteBalance(image, [])).toBeNull();
    paintRect(image, 16, 16, 48, 48, 60, 80, 180);
    expect(computeFaceWhiteBalance(image, [mockFace()])).toBeNull();
  });
});

describe("faceSkinMeans", () => {
  it("averages skin pixels inside the boxes only", () => {
    const image = solid(64, 64, 60, 80, 180);
    paintRect(image, 16, 16, 48, 48, ...SKIN);
    const means = faceSkinMeans(image, [mockFace()]);
    expect(means.count).toBe(32 * 32);
    expect(means.r).toBeCloseTo(SKIN[0], 5);
    expect(means.g).toBeCloseTo(SKIN[1], 5);
    expect(means.b).toBeCloseTo(SKIN[2], 5);
  });
});

describe("faceMeanLuminance and faceLiftAmount", () => {
  it("prefers skin pixels over dark surroundings", () => {
    const image = solid(40, 40, 20, 20, 20);
    paintRect(image, 10, 10, 30, 30, ...DARK_SKIN);
    const mean = faceMeanLuminance(image, { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
    // Skin luminance ≈ 95, not the near-black surround.
    expect(mean).toBeGreaterThan(80);
    expect(mean).toBeLessThan(110);
  });

  it("maps dark faces to a capped lift and bright faces to zero", () => {
    expect(faceLiftAmount(200)).toBe(0);
    expect(faceLiftAmount(112)).toBe(0);
    expect(faceLiftAmount(100)).toBeCloseTo(Math.log2(1.12) / 0.6, 2);
    expect(faceLiftAmount(56)).toBe(1);
    expect(faceLiftAmount(8)).toBe(1);
    expect(faceLiftAmount(0)).toBe(0);
  });
});

describe("faceLiftMask and applyFaceLift", () => {
  const box = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 };

  it("masks the ellipse interior, feathers the rim, and clears the outside", () => {
    const mask = faceLiftMask([box], 20, 20);
    expect(mask[10 * 20 + 10]).toBe(1);
    expect(mask[0]).toBe(0);
    expect(mask[19 * 20 + 19]).toBe(0);
    const rim = mask[14 * 20 + 10]!;
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(1);
    expect(faceLiftMask([], 20, 20).every((v) => v === 0)).toBe(true);
  });

  it("lifts the face and leaves the corner untouched", () => {
    const image = solid(20, 20, 50, 60, 70);
    const copy = new Uint8ClampedArray(image.data);
    applyFaceLift(copy, 20, 20, [box], 1);
    const gain = Math.pow(2, 0.6);
    const center = (10 * 20 + 10) * 4;
    expect(copy[center]).toBe(Math.round(50 * gain));
    expect(copy[center + 1]).toBe(Math.round(60 * gain));
    expect(copy[center + 2]).toBe(Math.round(70 * gain));
    expect(copy[0]).toBe(50);
    expect(copy[1]).toBe(60);
    expect(copy[2]).toBe(70);
    expect(copy[3]).toBe(255);
  });

  it("is a no-op without amount or boxes", () => {
    const image = solid(8, 8, 50, 60, 70);
    const copy = new Uint8ClampedArray(image.data);
    applyFaceLift(copy, 8, 8, [box], 0);
    applyFaceLift(copy, 8, 8, [], 1);
    expect(copy).toEqual(image.data);
  });
});

describe("findRedEyeSpots and applyRedEyeFix", () => {
  function portraitWithRedPupils(): PixelImage {
    const image = solid(60, 60, ...SKIN);
    // Red pupils at the mocked eye positions (24,26) and (36,26).
    paintRect(image, 23, 25, 26, 28, 200, 40, 40);
    paintRect(image, 35, 25, 38, 28, 200, 40, 40);
    return image;
  }

  it("finds one spot per red eye and nothing on flash-free portraits", () => {
    const spots = findRedEyeSpots(portraitWithRedPupils(), [mockFace()]);
    expect(spots).toHaveLength(2);
    for (const spot of spots) {
      expect(Math.abs(spot.y - 0.44)).toBeLessThan(0.05);
      expect(spot.radius).toBeGreaterThan(0);
    }
    expect(spots[0]!.x).toBeLessThan(spots[1]!.x);
    expect(findRedEyeSpots(solid(60, 60, ...SKIN), [mockFace()])).toHaveLength(0);
    expect(findRedEyeSpots(portraitWithRedPupils(), [])).toHaveLength(0);
  });

  it("pulls red pupils toward gray and spares other pixels", () => {
    const image = portraitWithRedPupils();
    const spots = findRedEyeSpots(image, [mockFace()]);
    const copy = new Uint8ClampedArray(image.data);
    applyRedEyeFix(copy, 60, 60, spots);
    const pupil = (26 * 60 + 24) * 4;
    expect(copy[pupil]).toBeLessThan(100);
    expect(copy[pupil + 1]).toBe(40);
    expect(copy[pupil + 2]).toBe(40);
    // Skin far from the pupils is untouched.
    const cheek = (50 * 60 + 30) * 4;
    expect(copy[cheek]).toBe(SKIN[0]);
    expect(copy[cheek + 1]).toBe(SKIN[1]);
    expect(copy[cheek + 2]).toBe(SKIN[2]);
  });

  it("spares warm skin even inside a fix disc", () => {
    const image = solid(40, 40, ...SKIN);
    const copy = new Uint8ClampedArray(image.data);
    applyRedEyeFix(copy, 40, 40, [{ x: 0.5, y: 0.5, radius: 0.4 }]);
    expect(copy).toEqual(image.data);
  });
});

describe("faceAdjustForFaces", () => {
  it("builds lift state for underexposed faces", () => {
    const image = solid(64, 64, 90, 90, 90);
    paintRect(image, 16, 16, 48, 48, ...DARK_SKIN);
    const state = faceAdjustForFaces(image, [mockFace()], "onnx");
    expect(state).not.toBeNull();
    expect(state!.boxes).toHaveLength(1);
    expect(state!.amount).toBeGreaterThan(0);
    expect(state!.redEye).toHaveLength(0);
    expect(state!.source).toBe("onnx");
    expect(state!.enabled).toBe(true);
  });

  it("keeps red-eye-only and drops no-op applies", () => {
    const bright = solid(60, 60, ...SKIN);
    paintRect(bright, 23, 25, 26, 28, 200, 40, 40);
    paintRect(bright, 35, 25, 38, 28, 200, 40, 40);
    const redEyeOnly = faceAdjustForFaces(bright, [mockFace()], "classic");
    expect(redEyeOnly).not.toBeNull();
    expect(redEyeOnly!.amount).toBe(0);
    expect(redEyeOnly!.redEye).toHaveLength(2);
    // Bright, flash-free: nothing would change, so no badge is stored.
    expect(faceAdjustForFaces(solid(60, 60, ...SKIN), [mockFace()], "onnx")).toBeNull();
    expect(faceAdjustForFaces(solid(60, 60, ...SKIN), [], "onnx")).toBeNull();
  });
});

describe("isFaceAdjustActive and editHasFaceAdjust", () => {
  it("detects pixel-changing state only", () => {
    expect(isFaceAdjustActive(null)).toBe(false);
    expect(isFaceAdjustActive(undefined)).toBe(false);
    expect(isFaceAdjustActive({ boxes: [], amount: 0, redEye: [], source: "onnx" })).toBe(false);
    expect(isFaceAdjustActive({ boxes: [], amount: 1, redEye: [], source: "onnx" })).toBe(false);
    expect(
      isFaceAdjustActive({ boxes: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], amount: 0.5, redEye: [], source: "onnx" }),
    ).toBe(true);
    expect(isFaceAdjustActive({ boxes: [], amount: 0, redEye: [{ x: 0.5, y: 0.5, radius: 0.01 }], source: "classic" })).toBe(true);
    // A toggled-off adjust changes nothing but stays stored (toggle back on
    // restores it); legacy recipes without the key stay active.
    expect(
      isFaceAdjustActive({ boxes: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], amount: 0.5, redEye: [], source: "onnx", enabled: false }),
    ).toBe(false);
    expect(
      isFaceAdjustStored({ boxes: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], amount: 0.5, redEye: [], source: "onnx", enabled: false }),
    ).toBe(true);
    expect(isFaceAdjustStored(null)).toBe(false);
    expect(isFaceAdjustStored({ boxes: [], amount: 0, redEye: [], source: "onnx" })).toBe(false);
    expect(editHasFaceAdjust({ ...DEFAULT_EDIT })).toBe(false);
    expect(
      editHasFaceAdjust({ ...DEFAULT_EDIT, faceAdjust: { boxes: [], amount: 0, redEye: [], source: "onnx" } }),
    ).toBe(false);
  });
});

describe("face adjust in the adjustment pipeline", () => {
  const box = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 };

  it("renders the masked lift through renderAdjustedPixels", () => {
    const source = solid(20, 20, 50, 60, 70);
    const rendered = renderAdjustedPixels(source, {
      ...DEFAULT_EDIT,
      faceAdjust: { boxes: [box], amount: 1, redEye: [], source: "onnx" },
    });
    const gain = Math.pow(2, 0.6);
    const center = (10 * 20 + 10) * 4;
    expect(rendered.data[center]).toBe(Math.round(50 * gain));
    expect(rendered.data[0]).toBe(50);
    expect(isNeutralEdit({ ...DEFAULT_EDIT, faceAdjust: { boxes: [box], amount: 1, redEye: [], source: "onnx" } })).toBe(false);
  });

  it("stays neutral without an active face adjust", () => {
    expect(isNeutralEdit({ ...DEFAULT_EDIT })).toBe(true);
    expect(isNeutralEdit({ ...DEFAULT_EDIT, faceAdjust: null })).toBe(true);
    expect(isNeutralEdit({ ...DEFAULT_EDIT, faceAdjust: { boxes: [], amount: 0, redEye: [], source: "onnx" } })).toBe(true);
  });

  it("bypasses a toggled-off face adjust in the render", () => {
    const source = solid(20, 20, 50, 60, 70);
    const rendered = renderAdjustedPixels(source, {
      ...DEFAULT_EDIT,
      faceAdjust: { boxes: [box], amount: 1, redEye: [], source: "onnx", enabled: false },
    });
    expect(Array.from(rendered.data)).toEqual(Array.from(source.data));
    expect(
      isNeutralEdit({ ...DEFAULT_EDIT, faceAdjust: { boxes: [box], amount: 1, redEye: [], source: "onnx", enabled: false } }),
    ).toBe(true);
  });
});
