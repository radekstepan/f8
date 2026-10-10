// Pure image-analysis helpers.
//
// These functions operate on plain pixel buffers and never touch the DOM,
// so they run identically on the main thread, in workers, and in Node tests.
// Pixel layout matches ImageData: row-major RGBA, one byte per channel.

export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function assertValidImage(image: PixelImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${image.width}x${image.height}.`);
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError(
      `Pixel buffer length ${image.data.length} does not match dimensions ${image.width}x${image.height}.`,
    );
  }
}

/** Read one pixel as [r, g, b, a]. Throws RangeError for out-of-bounds coordinates. */
export function getPixel(image: PixelImage, x: number, y: number): readonly [number, number, number, number] {
  assertValidImage(image);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= image.width || y >= image.height) {
    throw new RangeError(`Pixel (${x}, ${y}) is outside ${image.width}x${image.height}.`);
  }
  const i = (y * image.width + x) * 4;
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0, image.data[i + 3] ?? 0];
}

export interface ChannelMeans {
  r: number;
  g: number;
  b: number;
}

/** Mean value of each color channel over all pixels, in 0..255. Alpha is ignored. */
export function channelMeans(image: PixelImage): ChannelMeans {
  assertValidImage(image);
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = image.width * image.height;
  for (let i = 0; i < image.data.length; i += 4) {
    r += image.data[i] ?? 0;
    g += image.data[i + 1] ?? 0;
    b += image.data[i + 2] ?? 0;
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

/** Mean Rec.709 luminance over all pixels, in 0..255. */
export function meanLuminance(image: PixelImage): number {
  const { r, g, b } = channelMeans(image);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
