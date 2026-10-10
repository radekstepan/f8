// Synthetic test images generated in code (no files, no network).
//
// Every fixture returns a fresh PixelImage buffer; callers may mutate it.

import type { PixelImage } from "./analyze.js";

function createImage(width: number, height: number): PixelImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Every pixel is (r, g, b, a). */
export function solidColor(width: number, height: number, r: number, g: number, b: number, a = 255): PixelImage {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
    image.data[i + 3] = a;
  }
  return image;
}

/**
 * Grayscale gradient, black at x = 0 to white at x = width - 1.
 * Pixel value is round(255 * x / (width - 1)); every row is identical.
 */
export function horizontalGradient(width: number, height: number): PixelImage {
  const image = createImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.round((255 * x) / Math.max(1, width - 1));
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

/**
 * Grayscale gradient, black at y = 0 to white at y = height - 1.
 * Pixel value is round(255 * y / (height - 1)); every column is identical.
 */
export function verticalGradient(width: number, height: number): PixelImage {
  const image = createImage(width, height);
  for (let y = 0; y < height; y += 1) {
    const v = Math.round((255 * y) / Math.max(1, height - 1));
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

/** Left half (x < width / 2) is black, right half is white. Fully opaque. */
export function halfBlackHalfWhite(width: number, height: number): PixelImage {
  const image = createImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = x < width / 2 ? 0 : 255;
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

/**
 * Small deterministic photo-like image for golden tests: a vertical
 * luminance gradient with a warm cast and seeded per-pixel noise.
 * Same dimensions always produce the same bytes; no files, no network.
 */
export function goldenPhoto(width = 64, height = 48): PixelImage {
  const image = createImage(width, height);
  let seed = 0x2f6e2b1;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  for (let y = 0; y < height; y += 1) {
    const base = 40 + (120 * y) / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      image.data[i] = base * 1.15 + next() * 24;
      image.data[i + 1] = base + next() * 24;
      image.data[i + 2] = base * 0.8 + next() * 24;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

/**
 * Dark background (10, 10, 10) with a single 1px white line through the image
 * center. Angle is in degrees from the positive x-axis; positive angles run
 * clockwise (toward increasing y, i.e. downward on screen), so 0 is horizontal
 * and 90 is vertical.
 */
export function brightLine(width: number, height: number, angleDegrees: number): PixelImage {
  const image = solidColor(width, height, 10, 10, 10);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const theta = (angleDegrees * Math.PI) / 180;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Perpendicular distance from the pixel center to the line through (cx, cy).
      const distance = Math.abs((x - cx) * dy - (y - cy) * dx);
      if (distance < 0.5) {
        const i = (y * width + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
      }
    }
  }
  return image;
}
