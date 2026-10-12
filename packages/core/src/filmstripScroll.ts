/** Album-footer filmstrip scroll routing (Filmstrip).
 *
 * The filmstrip is a single-row horizontal scroller with a visually hidden
 * scrollbar. A plain mouse wheel over it only carries a vertical delta, so
 * without help the strip feels "not scrollable". The wheel routing rule and
 * the arrow-key focus math live here as pure functions so both are
 * unit-testable without a DOM; the component only applies the verdict
 * (shift scrollLeft, move focus).
 */

/** Wheel intent over the filmstrip list. Deltas follow WheelEvent semantics. */
export interface FilmstripWheelIntent {
  /** WheelEvent.deltaX in deltaMode units. */
  deltaX: number;
  /** WheelEvent.deltaY in deltaMode units. */
  deltaY: number;
  /** WheelEvent.deltaMode: 0 = pixels, 1 = lines, 2 = pages. */
  deltaMode: number;
  /** True for a pinch-zoom gesture (Ctrl on trackpads) or browser-zoom chord. */
  zoomChord: boolean;
  /** True when the list overflows horizontally (scrollWidth > clientWidth). */
  canScrollX: boolean;
  /** List clientWidth in px; only used to scale page-mode deltas. */
  clientWidth: number;
}

/** Pixels per wheel line when deltaMode is lines (matches a typical row). */
export const FILMSTRIP_WHEEL_LINE_PX = 16;

/** Horizontal scroll (px, +right) the strip should apply for one wheel event.
 *
 * Returns 0 to let the browser handle the event natively:
 * - zoom chords are never hijacked (pinch/browser zoom must keep working);
 * - without horizontal overflow there is nowhere to go;
 * - horizontal-dominant gestures (trackpad swipe, Shift+wheel) already
 *   scroll the strip natively, so only vertical-dominant ones translate.
 */
export function filmstripWheelShift(intent: FilmstripWheelIntent): number {
  if (intent.zoomChord || !intent.canScrollX) return 0;
  if (!(Math.abs(intent.deltaY) > Math.abs(intent.deltaX))) return 0;
  if (intent.deltaMode === 2) return Math.sign(intent.deltaY) * Math.max(intent.clientWidth, 0);
  if (intent.deltaMode === 1) return intent.deltaY * FILMSTRIP_WHEEL_LINE_PX;
  return intent.deltaY;
}

/** Index of the filmstrip item to focus for a key press.
 *
 * Returns -1 when the key is not handled or focus should stay put (at the
 * row ends, on an empty row, or when focus is outside the row). The caller
 * focuses the item at the returned index, which scrolls it into view.
 */
export function filmstripArrowIndex(key: string, currentIndex: number, itemCount: number): number {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) return -1;
  if (key === 'ArrowRight') return currentIndex + 1 < itemCount ? currentIndex + 1 : -1;
  if (key === 'ArrowLeft') return currentIndex - 1 >= 0 ? currentIndex - 1 : -1;
  if (key === 'Home') return currentIndex === 0 ? -1 : 0;
  if (key === 'End') return currentIndex === itemCount - 1 ? -1 : itemCount - 1;
  return -1;
}
