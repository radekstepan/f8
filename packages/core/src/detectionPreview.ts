// Hover preview for ML removal candidates: a normalized detection region
// (person box or dust-spot disc, both in 0..1 source-image coordinates, the
// same framing the detect/apply path uses) mapped to canvas-frame pixels so
// the canvas can paint it in red like a healed area.

import type { DetectedBox } from "./vision/object-detect.js";

/** One list row's canvas preview, in normalized 0..1 coordinates. */
export type DetectionPreview =
  | { kind: "box"; box: DetectedBox }
  | { kind: "disc"; x: number; y: number; radius: number };

/** Pixel geometry for the overlay SVG: a bounding rect or a healed-style disc. */
export type PreviewFrameGeometry =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

/** Minimum disc radius in px: sub-pixel dust must stay visible on hover. */
export const DETECTION_PREVIEW_MIN_RADIUS = 3;

/**
 * Map a normalized preview region onto a canvas frame. The frame shows the
 * cropped/rotated photo while detections run on the source framing, so the
 * overlay is exact only without crop/rotation — the same known limitation
 * the apply path documents (rotation/crop remapping is a follow-up).
 */
export function previewFrameGeometry(
  preview: DetectionPreview,
  frameWidth: number,
  frameHeight: number,
): PreviewFrameGeometry {
  if (preview.kind === "disc") {
    return {
      kind: "circle",
      cx: preview.x * frameWidth,
      cy: preview.y * frameHeight,
      r: Math.max(DETECTION_PREVIEW_MIN_RADIUS, preview.radius * frameWidth),
    };
  }
  const x = preview.box.x0 * frameWidth;
  const y = preview.box.y0 * frameHeight;
  return {
    kind: "rect",
    x,
    y,
    width: Math.max(0, preview.box.x1 * frameWidth - x),
    height: Math.max(0, preview.box.y1 * frameHeight - y),
  };
}
