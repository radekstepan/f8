import { describe, expect, it } from "vitest";
import {
  exifOrientationSwapsDimensions,
  exifOrientationToTransform,
  orientedDimensions,
  type OrientationTransform,
} from "./orientation.js";

describe("exifOrientationToTransform", () => {
  it("maps each EXIF orientation 1-8 to the correct rotation/flip", () => {
    expect(exifOrientationToTransform(1)).toEqual({ rotation: 0, flipH: false, flipV: false });
    expect(exifOrientationToTransform(2)).toEqual({ rotation: 0, flipH: true, flipV: false });
    expect(exifOrientationToTransform(3)).toEqual({ rotation: 180, flipH: false, flipV: false });
    expect(exifOrientationToTransform(4)).toEqual({ rotation: 0, flipH: false, flipV: true });
    expect(exifOrientationToTransform(5)).toEqual({ rotation: 90, flipH: true, flipV: false });
    expect(exifOrientationToTransform(6)).toEqual({ rotation: 90, flipH: false, flipV: false });
    expect(exifOrientationToTransform(7)).toEqual({ rotation: 270, flipH: true, flipV: false });
    expect(exifOrientationToTransform(8)).toEqual({ rotation: 270, flipH: false, flipV: false });
  });

  it("falls back to identity for corrupt or missing orientation values", () => {
    for (const bad of [0, 9, -1, 1.5, Number.NaN]) {
      expect(exifOrientationToTransform(bad)).toEqual({ rotation: 0, flipH: false, flipV: false });
    }
  });

  it("returns a fresh object per call so callers cannot mutate shared state", () => {
    const first = exifOrientationToTransform(6);
    expect(first).not.toBe(exifOrientationToTransform(6));
    expect(exifOrientationToTransform(0)).not.toBe(exifOrientationToTransform(0));
  });
});

/** Apply a transform to row-major labels: rotate clockwise, then mirror. */
function applyTransform(labels: string[][], transform: OrientationTransform): string[][] {
  const height = labels.length;
  const width = labels[0]?.length ?? 0;
  const at = (x: number, y: number): string => labels[y]?.[x] ?? "?";
  const swapped = transform.rotation === 90 || transform.rotation === 270;
  const outWidth = swapped ? height : width;
  const outHeight = swapped ? width : height;
  const out: string[][] = [];
  for (let dy = 0; dy < outHeight; dy += 1) {
    const row: string[] = [];
    for (let dx = 0; dx < outWidth; dx += 1) {
      // Undo the mirrors, then the rotation, to find the source pixel.
      const unflippedX = transform.flipH ? outWidth - 1 - dx : dx;
      const unflippedY = transform.flipV ? outHeight - 1 - dy : dy;
      let sx = 0;
      let sy = 0;
      if (transform.rotation === 0) {
        sx = unflippedX;
        sy = unflippedY;
      } else if (transform.rotation === 90) {
        sx = unflippedY;
        sy = outWidth - 1 - unflippedX;
      } else if (transform.rotation === 180) {
        sx = width - 1 - unflippedX;
        sy = height - 1 - unflippedY;
      } else {
        sx = outHeight - 1 - unflippedY;
        sy = unflippedX;
      }
      row.push(at(sx, sy));
    }
    out.push(row);
  }
  return out;
}

describe("orientation pixel layouts", () => {
  // Stored 2x3 test pattern; expected displays are pinned from the EXIF
  // spec (stored row 0 / column 0 placement per orientation value).
  const stored = [
    ["A", "B"],
    ["C", "D"],
    ["E", "F"],
  ];
  const expected: Record<number, string[][]> = {
    1: [
      ["A", "B"],
      ["C", "D"],
      ["E", "F"],
    ],
    2: [
      ["B", "A"],
      ["D", "C"],
      ["F", "E"],
    ],
    3: [
      ["F", "E"],
      ["D", "C"],
      ["B", "A"],
    ],
    4: [
      ["E", "F"],
      ["C", "D"],
      ["A", "B"],
    ],
    5: [
      ["A", "C", "E"],
      ["B", "D", "F"],
    ],
    6: [
      ["E", "C", "A"],
      ["F", "D", "B"],
    ],
    7: [
      ["F", "D", "B"],
      ["E", "C", "A"],
    ],
    8: [
      ["B", "D", "F"],
      ["A", "C", "E"],
    ],
  };

  for (let orientation = 1; orientation <= 8; orientation += 1) {
    it(`normalizes orientation ${orientation} to its upright layout`, () => {
      expect(applyTransform(stored, exifOrientationToTransform(orientation))).toEqual(
        expected[orientation],
      );
    });
  }
});

describe("exifOrientationSwapsDimensions", () => {
  it("swaps width/height only for the transposed orientations 5-8", () => {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      expect(exifOrientationSwapsDimensions(orientation)).toBe(orientation >= 5);
    }
  });
});

describe("orientedDimensions", () => {
  it("reports upright dimensions for a portrait phone photo (stored landscape, orientation 6)", () => {
    expect(orientedDimensions(4000, 3000, 6)).toEqual({ width: 3000, height: 4000 });
  });

  it("keeps stored dimensions for orientation 1", () => {
    expect(orientedDimensions(4000, 3000, 1)).toEqual({ width: 4000, height: 3000 });
  });
});
