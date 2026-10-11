// Retouch stroke grouping: every stamp painted in one drag shares a stroke
// id, so the inspector can list paint strokes as groups instead of a flat
// stamp count. Legacy points without a stroke id collapse into one group
// per kind (repair -> 0, clone -> -1); new strokes always use positive ids.

import type { RetouchPoint } from "./types.js";

/** Group id for repair stamps painted before stroke ids existed. */
export const LEGACY_REPAIR_STROKE = 0;
/** Group id for clone stamps painted before stroke ids existed. */
export const LEGACY_CLONE_STROKE = -1;

export interface RetouchStrokeGroup {
  id: number;
  kind: "repair" | "clone";
  points: RetouchPoint[];
}

/** Stable group id for one stamp: its stroke, or the legacy bucket for its kind. */
export function strokeIdForPoint(point: RetouchPoint): number {
  if (Number.isInteger(point.stroke) && (point.stroke as number) > 0) return point.stroke as number;
  return point.kind === "clone" ? LEGACY_CLONE_STROKE : LEGACY_REPAIR_STROKE;
}

/** Group stamps into paint strokes, preserving first-seen order. */
export function groupRetouchStrokes(points: readonly RetouchPoint[]): RetouchStrokeGroup[] {
  const groups = new Map<number, RetouchStrokeGroup>();
  for (const point of points) {
    const id = strokeIdForPoint(point);
    const existing = groups.get(id);
    if (existing) {
      existing.points.push(point);
    } else {
      groups.set(id, { id, kind: point.kind, points: [point] });
    }
  }
  return [...groups.values()];
}

/** Next positive stroke id after the ids already present; never a legacy id. */
export function nextRetouchStrokeId(points: readonly RetouchPoint[]): number {
  let max = 0;
  for (const point of points) {
    if (Number.isInteger(point.stroke) && (point.stroke as number) > max) max = point.stroke as number;
  }
  return max + 1;
}
