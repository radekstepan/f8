/** Canvas drag routing for the zoomed photo view (PhotoCanvas).
 *
 * The photo frame hosts two drag gestures on the same pointer: repair
 * painting and viewport panning. The routing rule and the scroll math live
 * here as pure functions so both are unit-testable without a DOM; the
 * component only applies the verdict (capture the pointer, paint a stamp,
 * or shift the stage scroll).
 */

import type { Tool } from "./types.js";

export interface CanvasDragIntent {
  /** True when a primary press would paint (brush tool, not comparing, ML tier ready). */
  canPaint: boolean;
  /** True when the frame overflows the stage, so scrolling can move the view. */
  pannable: boolean;
  /** PointerEvent.button of the press: 0 primary, 1 middle, 2 secondary. */
  button: number;
  /** PointerEvent.pointerType: 'mouse' | 'pen' | 'touch'. */
  pointerType: string;
  /** True while Space is held: pan wins over paint (standard grab-tool override). */
  spaceHeld: boolean;
}

export type CanvasDragAction = 'paint' | 'pan' | 'none';

/** Route a press on the photo frame to painting, panning, or neither.
 *
 * - Touch scrolls the stage natively, so a touch press only ever paints;
 *   anything else stays 'none' and the browser handles the scroll.
 * - Middle-drag always pans when there is somewhere to go, on any tool.
 * - Space is the grab-tool override: it pans even inside the repair brush.
 * - Otherwise the brush paints and every other tool pans when zoomed in.
 */
export function resolveCanvasDrag(intent: CanvasDragIntent): CanvasDragAction {
  const pointer = intent.pointerType || 'mouse';
  if (pointer === 'touch') return intent.canPaint && intent.button === 0 && !intent.spaceHeld ? 'paint' : 'none';
  if (intent.button === 1) return intent.pannable ? 'pan' : 'none';
  if (intent.button !== 0) return 'none';
  if (intent.spaceHeld) return intent.pannable ? 'pan' : 'none';
  if (intent.canPaint) return 'paint';
  return intent.pannable ? 'pan' : 'none';
}

/** True while a repair stroke is being painted (pointer down, not yet released).
 *
 * The render pipeline skips all canvas work while this holds: the base
 * canvas excludes repair stamps, so it cannot change mid-drag, and the red
 * mask overlay is a pure function of the edit state that React paints on
 * the same render. Repainting the full-res canvas on every pointermove only
 * blocks the main thread and makes the patch lag behind the cursor. The
 * release (active stroke back to null) re-runs the pipeline and schedules
 * the heal, so no work is lost — it just waits for the drag to end.
 */
export function isLiveRepairDrag(tool: Tool, activeStroke: number | null): boolean {
  return tool === "repair" && activeStroke !== null;
}

/** Stage scroll position after dragging from a press point to the current one.
 *
 * The view tracks the pointer 1:1 (drag left to see what's on the right).
 * The caller assigns the result to scrollLeft/scrollTop, which clamps it to
 * the scrollable range — no explicit clamping needed here.
 */
export function panScrollFromDrag(
  start: { scrollLeft: number; scrollTop: number; clientX: number; clientY: number },
  current: { clientX: number; clientY: number },
): { scrollLeft: number; scrollTop: number } {
  return {
    scrollLeft: start.scrollLeft + (start.clientX - current.clientX),
    scrollTop: start.scrollTop + (start.clientY - current.clientY),
  };
}
