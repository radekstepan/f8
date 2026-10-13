// Multi-select helpers for the album grid: Ctrl/Cmd-toggle, Shift-range,
// right-click/drag target resolution, and rubber-band marquee hit-testing.
// Pure functions so the grid (a DOM component) stays thin and the rules are
// unit-testable without jsdom.

/** Drag payload MIME for moving grid photos onto a sidebar album. */
export const MOVE_PHOTOS_MIME = 'application/x-f8-photo-ids';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Toggle one id in the selection (Ctrl/Cmd-click). Order is stable. */
export function togglePhotoSelection(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
}

/**
 * Union the anchor..id range (in grid order) into the selection
 * (Shift-click). Without an anchor the click behaves like a toggle.
 */
export function extendPhotoRange(
  orderedIds: string[],
  selected: string[],
  anchorId: string | null,
  id: string,
): { selected: string[]; anchor: string } {
  if (anchorId === null || !orderedIds.includes(anchorId) || !orderedIds.includes(id)) {
    return { selected: togglePhotoSelection(selected, id), anchor: id };
  }
  const from = orderedIds.indexOf(anchorId);
  const to = orderedIds.indexOf(id);
  const [start, end] = from <= to ? [from, to] : [to, from];
  const range = orderedIds.slice(start, end + 1);
  const keep = selected.filter((entry) => !range.includes(entry));
  return { selected: [...keep, ...range], anchor: anchorId };
}

/**
 * Photos a context-menu or drag gesture acts on: the whole selection when
 * the target belongs to it, otherwise just the target (a right-click or
 * drag on an unselected photo re-targets to that photo alone).
 */
export function resolveMoveTargets(selected: string[], targetId: string): string[] {
  return selected.includes(targetId) && selected.length > 0 ? [...selected] : [targetId];
}

/** True when two client rects overlap (a marquee edge touching counts). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** Ids whose rects intersect the marquee, in grid order. */
export function marqueeSelectedIds(entries: { id: string; rect: Rect }[], marquee: Rect): string[] {
  return entries.filter((entry) => rectsIntersect(entry.rect, marquee)).map((entry) => entry.id);
}

/** Encode the drag payload dropped onto a sidebar album. */
export function encodeMovePayload(photoIds: string[]): string {
  return JSON.stringify(photoIds);
}

/** Decode a sidebar drop payload; garbage yields an empty list, never a throw. */
export function decodeMovePayload(payload: string): string[] {
  try {
    const parsed: unknown = JSON.parse(payload);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
