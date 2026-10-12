// Object-detect contract: YOLO parse → boxes → repair strokes/masks.

import { describe, expect, it } from "vitest";
import {
  OBJECT_DETECT_CLASSIC_SCORE,
  OBJECT_DETECT_SIZE,
  detectionsToRepairMask,
  detectionsToRepairPoints,
  mapYoloBoxToNormalized,
  packObjectDetectInput,
  parseYoloDetections,
  proposePersonCandidates,
  type DetectedObject,
  type ObjectDetectLetterbox,
} from "./object-detect.js";
import { rasterizeRepairMask } from "./inpaint.js";
import { planMlHealRoi } from "./ml-heal.js";
import type { PixelImage } from "./analyze.js";

const ROWS = 84;
const COLS = 8400;

function squareLetterbox(): ObjectDetectLetterbox {
  return { scale: 1, padX: 0, padY: 0, srcWidth: OBJECT_DETECT_SIZE, srcHeight: OBJECT_DETECT_SIZE };
}

/** YOLO output with one person peak per entry: [col, cx, cy, w, h, personScore, otherScore]. */
function yoloOutput(peaks: Array<[number, number, number, number, number, number, number?]>): Float32Array {
  const out = new Float32Array(ROWS * COLS);
  for (const [col, cx, cy, w, h, person, other = 0] of peaks) {
    out[col] = cx;
    out[COLS + col] = cy;
    out[2 * COLS + col] = w;
    out[3 * COLS + col] = h;
    out[4 * COLS + col] = person;
    out[5 * COLS + col] = other;
  }
  return out;
}

function solidImage(width: number, height: number, r: number, g: number, b: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe("packObjectDetectInput", () => {
  it("letterboxes a wide image with gray bars top and bottom", () => {
    const { data, letterbox } = packObjectDetectInput(solidImage(640, 320, 200, 30, 30));
    expect(letterbox.scale).toBeCloseTo(1, 6);
    expect(letterbox.padX).toBeCloseTo(0, 6);
    expect(letterbox.padY).toBeCloseTo(160, 6);
    // Corner is pad gray (114/255); center row is the red photo.
    expect(data[0]).toBeCloseTo(114 / 255, 6);
    const plane = OBJECT_DETECT_SIZE * OBJECT_DETECT_SIZE;
    const center = 320 * OBJECT_DETECT_SIZE + 320;
    expect(data[center]).toBeCloseTo(200 / 255, 2);
    expect(data[plane + center]).toBeCloseTo(30 / 255, 2);
  });

  it("packs a square image with no padding", () => {
    const { letterbox } = packObjectDetectInput(solidImage(100, 100, 10, 20, 30));
    expect(letterbox.padX).toBeCloseTo(0, 6);
    expect(letterbox.padY).toBeCloseTo(0, 6);
    expect(letterbox.scale).toBeCloseTo(6.4, 6);
  });
});

describe("mapYoloBoxToNormalized", () => {
  it("maps grid pixels through an identity letterbox", () => {
    const box = mapYoloBoxToNormalized(320, 320, 320, 160, squareLetterbox());
    expect(box).toEqual({ x0: 0.25, y0: 0.375, x1: 0.75, y1: 0.625 });
  });

  it("clamps pad spill and rejects degenerate boxes", () => {
    const letterbox = squareLetterbox();
    expect(mapYoloBoxToNormalized(320, 320, 0, 100, letterbox)).toBeNull();
    expect(mapYoloBoxToNormalized(Number.NaN, 320, 100, 100, letterbox)).toBeNull();
    const clamped = mapYoloBoxToNormalized(320, 320, 2000, 2000, letterbox);
    expect(clamped).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
});

describe("parseYoloDetections", () => {
  it("keeps person peaks, drops low scores and non-person classes", () => {
    const out = yoloOutput([
      [10, 320, 320, 200, 300, 0.9], // person, strong
      [20, 100, 100, 60, 80, 0.1], // person, under threshold
      [30, 500, 500, 60, 80, 0.05, 0.95], // dog, strong — not a removal target
    ]);
    const detections = parseYoloDetections(out, squareLetterbox());
    expect(detections).toHaveLength(1);
    expect(detections[0]?.label).toBe("person");
    expect(detections[0]?.score).toBeCloseTo(0.9, 6);
    expect(detections[0]?.box.x0).toBeCloseTo((320 - 100) / 640, 6);
  });

  it("suppresses overlapping lower-score boxes (NMS)", () => {
    const out = yoloOutput([
      [10, 320, 320, 200, 300, 0.9],
      [11, 330, 330, 200, 300, 0.7], // near-duplicate of the first
      [12, 80, 80, 60, 80, 0.8], // separate person survives
    ]);
    const detections = parseYoloDetections(out, squareLetterbox());
    expect(detections).toHaveLength(2);
    expect(detections[0]?.score).toBeCloseTo(0.9, 5);
    expect(detections[1]?.score).toBeCloseTo(0.8, 5);
  });

  it("rejects misshapen model output", () => {
    expect(() => parseYoloDetections(new Float32Array(10), squareLetterbox())).toThrow(RangeError);
  });

  it("caps the detection count", () => {
    const peaks = Array.from({ length: 30 }, (_, i) => {
      const gx = 30 + (i % 10) * 60;
      const gy = 30 + Math.floor(i / 10) * 200;
      return [i, gx, gy, 40, 60, 0.9 - i * 0.001] as [number, number, number, number, number, number];
    });
    const detections = parseYoloDetections(yoloOutput(peaks), squareLetterbox(), { maxDetections: 5 });
    expect(detections).toHaveLength(5);
  });
});

describe("detectionsToRepairPoints", () => {
  const detections: DetectedObject[] = [
    { label: "person", score: 0.9, box: { x0: 0.2, y0: 0.1, x1: 0.5, y1: 0.9 } },
    { label: "person", score: 0.8, box: { x0: 0.7, y0: 0.4, x1: 0.8, y1: 0.6 } },
  ];

  it("covers every box with valid repair points", () => {
    const aspect = 3 / 2;
    const points = detectionsToRepairPoints(detections, aspect, { stroke: 4 });
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.kind).toBe("repair");
      expect(point.size).toBeGreaterThan(0);
      expect(point.strength).toBe(100);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
    // Each detection owns one stroke id (individually deletable).
    expect(new Set(points.map((p) => p.stroke))).toEqual(new Set([4, 5]));
    // Sampled grid over each box: every sample sits inside some disc.
    for (const detection of detections) {
      const group = points.filter((p) => p.stroke === (detection === detections[0] ? 4 : 5));
      for (let fy = 0; fy <= 4; fy += 1) {
        for (let fx = 0; fx <= 4; fx += 1) {
          const x = detection.box.x0 + ((detection.box.x1 - detection.box.x0) * fx) / 4;
          const y = detection.box.y0 + ((detection.box.y1 - detection.box.y0) * fy) / 4;
          const covered = group.some((p) => {
            const rx = p.size / 2;
            const ry = (p.size / 2) * aspect;
            return ((x - p.x) / rx) ** 2 + ((y - p.y) / ry) ** 2 <= 1.0001;
          });
          expect(covered, `sample ${fx},${fy} of ${JSON.stringify(detection.box)}`).toBe(true);
        }
      }
    }
  });

  it("skips degenerate boxes and rejects bad aspects", () => {
    expect(detectionsToRepairPoints([{ label: "person", score: 1, box: { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 } }], 1)).toEqual([]);
    expect(() => detectionsToRepairPoints(detections, 0)).toThrow(RangeError);
  });
});

describe("detectionsToRepairMask", () => {
  it("fills box interiors and nothing else (detect→mask contract)", () => {
    const mask = detectionsToRepairMask(
      [{ label: "person", score: 0.9, box: { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 } }],
      100,
      100,
    );
    expect(mask.data[30 * 100 + 30]).toBe(255);
    expect(mask.data[49 * 100 + 49]).toBe(255);
    expect(mask.data[0]).toBe(0);
    expect(mask.data[99 * 100 + 99]).toBe(0);
    expect(mask.data[10 * 100 + 10]).toBe(0);
  });
});

describe("detect → mask → inpaint wiring (mocked detector)", () => {
  it("rasterizes canned detection strokes over the box for the ROI pipeline", () => {
    // The server is mocked here: canned boxes stand in for detector output.
    const canned: DetectedObject[] = [
      { label: "person", score: 0.9, box: { x0: 0.3, y0: 0.2, x1: 0.6, y1: 0.8 } },
    ];
    const points = detectionsToRepairPoints(canned, 1, { stroke: 1 });
    const mask = rasterizeRepairMask(points, 200, 200);
    // Box center and corners are masked; a far corner stays clean.
    expect(mask.data[100 * 200 + 90]).toBeGreaterThan(0);
    expect(mask.data[45 * 200 + 65]).toBeGreaterThan(0);
    expect(mask.data[155 * 200 + 115]).toBeGreaterThan(0);
    expect(mask.data[10 * 200 + 10]).toBe(0);
    // The mask feeds the existing ML-heal ROI planner unchanged.
    const roi = planMlHealRoi(mask);
    expect(roi).not.toBeNull();
    expect(roi?.x0).toBeLessThanOrEqual(60);
    expect(roi!.x0 + roi!.size).toBeGreaterThanOrEqual(120);
  });
});

describe("proposePersonCandidates (classical fallback)", () => {
  it("finds a skin-tone figure and skips tiny specks", () => {
    const image = solidImage(320, 240, 90, 140, 200);
    // Skin-tone torso (Kovac-range) in the middle.
    for (let y = 60; y < 180; y += 1) {
      for (let x = 120; x < 200; x += 1) {
        const i = (y * 320 + x) * 4;
        image.data[i] = 210;
        image.data[i + 1] = 150;
        image.data[i + 2] = 120;
      }
    }
    // One speck elsewhere (below the area floor).
    const speck = (10 * 320 + 10) * 4;
    image.data[speck] = 210;
    image.data[speck + 1] = 150;
    image.data[speck + 2] = 120;
    const found = proposePersonCandidates(image);
    expect(found).toHaveLength(1);
    expect(found[0]?.label).toBe("person");
    expect(found[0]?.score).toBe(OBJECT_DETECT_CLASSIC_SCORE);
    // Expanded box covers the torso with margin.
    expect(found[0]?.box.x0).toBeLessThan(120 / 320);
    expect(found[0]?.box.x1).toBeGreaterThan(200 / 320);
    expect(found[0]?.box.y0).toBeLessThan(60 / 240);
    expect(found[0]?.box.y1).toBeGreaterThan(180 / 240);
  });

  it("reports nothing on a skin-free photo", () => {
    expect(proposePersonCandidates(solidImage(320, 240, 90, 140, 200))).toEqual([]);
  });
});
