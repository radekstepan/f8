// EXIF orientation mapping (pure, no DOM access).
//
// The browser decoder already applies EXIF orientation for us: imports are
// decoded with createImageBitmap(..., { imageOrientation: "from-image" })
// and <img> auto-orients for display, so production code must never apply
// these transforms to pixels (that would double-rotate portrait photos).
// This module documents the intended 1-8 mapping and guards regressions:
// if a future pipeline ever decodes without orientation, these transforms
// normalize stored pixels to upright (orientation 1).

/** Valid EXIF orientation tag values. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Transform normalizing stored pixels to upright display.
 * Apply `rotation` clockwise about the image center first, then mirror
 * left-right when `flipH` is set and top-bottom when `flipV` is set.
 */
export interface OrientationTransform {
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
}

const IDENTITY: OrientationTransform = { rotation: 0, flipH: false, flipV: false };

/**
 * Map an EXIF orientation tag to its normalizing transform. Unknown values
 * (corrupt metadata) fall back to identity so imports never break.
 */
export function exifOrientationToTransform(orientation: number): OrientationTransform {
  switch (orientation) {
    case 1:
      return { rotation: 0, flipH: false, flipV: false };
    case 2:
      return { rotation: 0, flipH: true, flipV: false };
    case 3:
      return { rotation: 180, flipH: false, flipV: false };
    case 4:
      return { rotation: 0, flipH: false, flipV: true };
    case 5:
      return { rotation: 90, flipH: true, flipV: false };
    case 6:
      return { rotation: 90, flipH: false, flipV: false };
    case 7:
      return { rotation: 270, flipH: true, flipV: false };
    case 8:
      return { rotation: 270, flipH: false, flipV: false };
    default:
      return { ...IDENTITY };
  }
}

/** True for the transposed orientations (5-8), which swap width and height. */
export function exifOrientationSwapsDimensions(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

export interface OrientedDimensions {
  width: number;
  height: number;
}

/** Display dimensions of stored `width`x`height` pixels carrying `orientation`. */
export function orientedDimensions(
  width: number,
  height: number,
  orientation: number,
): OrientedDimensions {
  return exifOrientationSwapsDimensions(orientation)
    ? { width: height, height: width }
    : { width, height };
}
