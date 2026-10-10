// Horizon/straighten voting: pure functions mapping Hough line segments to a
// suggested `straighten` correction. No DOM or OpenCV access, so this runs
// identically in Node tests, the vision worker, and the main thread.
//
// Sign convention: segment angles use screen coordinates (+x right, +y down),
// so a positive angle runs clockwise (down toward the right). The canvas
// pipeline applies `straighten` via ctx.rotate(), where positive values also
// rotate clockwise. A horizon tilted +5 degrees therefore needs a -5 degree
// correction, so the voted `angle` is the negated dominant line angle and can
// be applied to EditState.straighten verbatim.

/** A line segment in image pixels, as reported by HoughLinesP. */
export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Suggested straighten correction plus 0..1 confidence in the suggestion. */
export interface StraightenVote {
  /** Value for EditState.straighten, already negated; 0 when confidence is 0. */
  angle: number;
  /** 1 for a single dominant horizontal consensus, 0 when nothing usable. */
  confidence: number;
}

// Detection defaults, tuned for STRAIGHTEN_WORKING_WIDTH-wide input (see the
// vision worker). Tradeoff: lower Canny/Hough thresholds catch soft or short
// horizons but admit texture clutter (foliage, waves, rooftops) that dilutes
// the vote; higher values reject clutter but miss weak horizons entirely.
// minLineLength (~20% of the working width) drops short texture fragments
// while keeping real horizons and rooflines; maxLineGap reconnects dashed
// edges (piers, fences) without merging unrelated clutter. Verified with real
// OpenCV against synthetic tilted horizons (0/2/5/10/-7 degrees recover
// within 0.3 degrees at high confidence), cluttered and lineless input
// (moderate and zero confidence, never a wild angle), and 4 real landscape
// photos (ambiguous scenes stay near zero at low confidence; a dominant
// line family tracks an artificial 5-degree warp).
export const STRAIGHTEN_WORKING_WIDTH = 512;
export const STRAIGHTEN_CANNY_LOW = 50;
export const STRAIGHTEN_CANNY_HIGH = 150;
export const STRAIGHTEN_HOUGH_THRESHOLD = 80;
export const STRAIGHTEN_HOUGH_MIN_LINE_LENGTH = 100;
export const STRAIGHTEN_HOUGH_MAX_LINE_GAP = 10;
/** Detection and slider range: the Straighten slider spans [-15, 15] degrees. */
export const STRAIGHTEN_MAX_ANGLE = 15;
/** Below this confidence the UI warns that no clear horizon was found. */
export const STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD = 0.25;
/** Inlier spread (std dev, degrees) at which agreement reaches zero. */
const AGREEMENT_FULL_SPREAD = 12;

function clampAngle(angle: number): number {
  return Math.min(STRAIGHTEN_MAX_ANGLE, Math.max(-STRAIGHTEN_MAX_ANGLE, angle));
}

/**
 * Fold a directed angle to the direction-invariant line angle in [-90, 90):
 * HoughLinesP endpoints are unordered, so (a -> b) and (b -> a) must agree.
 */
export function foldLineAngle(degrees: number): number {
  let folded = degrees % 180;
  if (folded >= 90) folded -= 180;
  if (folded < -90) folded += 180;
  return folded;
}

/** Length of a segment in pixels; non-finite coordinates yield NaN. */
export function segmentLength(segment: LineSegment): number {
  return Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
}

/**
 * Direction-invariant line angle in [-90, 90) degrees, screen coordinates
 * (+clockwise). Horizontal is 0 however the endpoints are ordered; vertical
 * folds to -90.
 */
export function segmentAngleDeg(segment: LineSegment): number {
  return foldLineAngle((Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1) * 180) / Math.PI);
}

function isUsable(segment: LineSegment): boolean {
  return (
    Number.isFinite(segment.x1) &&
    Number.isFinite(segment.y1) &&
    Number.isFinite(segment.x2) &&
    Number.isFinite(segment.y2) &&
    (segment.x1 !== segment.x2 || segment.y1 !== segment.y2)
  );
}

/**
 * Vote for the dominant near-horizontal line angle, weighted by segment
 * length, and return the straighten correction that would level it.
 * Segments beyond +/-STRAIGHTEN_MAX_ANGLE count against confidence as
 * outliers. Empty, degenerate, or line-free input yields { angle: 0,
 * confidence: 0 } -- never a wild angle.
 */
export function voteStraightenAngle(segments: readonly LineSegment[]): StraightenVote {
  let totalWeight = 0;
  let inlierWeight = 0;
  let weightedSum = 0;
  const inliers: { angle: number; weight: number }[] = [];
  for (const segment of segments) {
    if (!isUsable(segment)) continue;
    const weight = segmentLength(segment);
    if (!(weight > 0)) continue;
    totalWeight += weight;
    const angle = segmentAngleDeg(segment);
    if (Math.abs(angle) > STRAIGHTEN_MAX_ANGLE) continue;
    inlierWeight += weight;
    weightedSum += angle * weight;
    inliers.push({ angle, weight });
  }
  if (inlierWeight <= 0 || totalWeight <= 0) return { angle: 0, confidence: 0 };
  const mean = weightedSum / inlierWeight;
  let varianceSum = 0;
  for (const { angle, weight } of inliers) {
    varianceSum += weight * (angle - mean) * (angle - mean);
  }
  const std = Math.sqrt(varianceSum / inlierWeight);
  const dominance = inlierWeight / totalWeight;
  const agreement = Math.max(0, 1 - std / AGREEMENT_FULL_SPREAD);
  const confidence = Math.round(Math.min(1, Math.max(0, dominance * agreement)) * 100) / 100;
  const rounded = Math.round(clampAngle(-mean) * 10) / 10;
  return { angle: rounded === 0 ? 0 : rounded, confidence };
}
