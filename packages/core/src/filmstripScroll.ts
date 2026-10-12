/** Album-footer filmstrip scroll routing (Filmstrip).
 *
 * The filmstrip wraps its items into rows and grows up to a capped height;
 * past the cap it scrolls vertically (thin app-standard scrollbar). A plain
 * mouse wheel over it only carries a vertical delta, so when the strip fits
 * vertically but overflows horizontally (narrow viewport) the wheel is
 * translated into horizontal scroll instead — otherwise the strip would feel
 * "not scrollable". The wheel routing rule, the overflow predicate, and the
 * arrow-key focus math live here as pure functions so all are unit-testable
 * without a DOM; the component only applies the verdict (shift scrollLeft,
 * move focus).
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
  /** True when the list overflows vertically (scrollHeight > clientHeight).
   * Absent (legacy callers) means no vertical overflow. */
  canScrollY?: boolean;
  /** List clientWidth in px; only used to scale page-mode deltas. */
  clientWidth: number;
}

/** Pixels per wheel line when deltaMode is lines (matches a typical row). */
export const FILMSTRIP_WHEEL_LINE_PX = 16;

/** Sub-pixel slack (px) before scroll overflow counts as scrollable. */
export const FILMSTRIP_OVERFLOW_TOLERANCE_PX = 1;

/** True when a scroll container's content overflows its viewport edge. */
export function filmstripOverflows(scrollSize: number, clientSize: number): boolean {
  return scrollSize > clientSize + FILMSTRIP_OVERFLOW_TOLERANCE_PX;
}

/** Horizontal scroll (px, +right) the strip should apply for one wheel event.
 *
 * Returns 0 to let the browser handle the event natively:
 * - zoom chords are never hijacked (pinch/browser zoom must keep working);
 * - with vertical overflow the wheel scrolls the rows natively instead;
 * - without horizontal overflow there is nowhere to go;
 * - horizontal-dominant gestures (trackpad swipe, Shift+wheel) already
 *   scroll the strip natively, so only vertical-dominant ones translate.
 */
export function filmstripWheelShift(intent: FilmstripWheelIntent): number {
  if (intent.zoomChord || intent.canScrollY || !intent.canScrollX) return 0;
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

/** Geometry for revealing the active filmstrip item (Filmstrip).
 *
 * Item edges are in list content coordinates: the caller measures them with
 * `getBoundingClientRect` on the item and the list
 * (`itemRect - listRect - list.clientLeft/Top + list.scrollLeft/Top`) so the
 * math stays correct regardless of which ancestor is the offsetParent.
 */
export interface FilmstripCenterIntent {
  /** Current list scrollLeft in px. */
  scrollLeft: number;
  /** Current list scrollTop in px. */
  scrollTop: number;
  /** List clientWidth in px. */
  clientWidth: number;
  /** List clientHeight in px. */
  clientHeight: number;
  /** List scrollWidth in px. */
  scrollWidth: number;
  /** List scrollHeight in px. */
  scrollHeight: number;
  /** Active item's left edge in content px. */
  itemLeft: number;
  /** Active item's top edge in content px. */
  itemTop: number;
  /** Active item's width in px. */
  itemWidth: number;
  /** Active item's height in px. */
  itemHeight: number;
}

/** Scroll offset the filmstrip list should move to. */
export interface FilmstripScrollOffset {
  scrollLeft: number;
  scrollTop: number;
}

/** Scroll offset that centers the active item horizontally.
 *
 * Horizontal: the item's center lands on the viewport's center, clamped to
 * `[0, scrollWidth - clientWidth]` so the first items pin to the start and
 * the last items pin to the end instead of showing empty space. Always
 * recenters (like `scrollIntoView({ inline: 'center' })`), even when the
 * item is already visible — opening a photo is an explicit jump, so the
 * strip settles with context (photos before and after) on both sides.
 *
 * Vertical: nearest-row reveal (like `block: 'nearest'`): rows above the
 * viewport align their top, rows below align their bottom, visible rows
 * stay put. The wrapped strip's overflow is vertical, so this is the axis
 * that actually moves there.
 *
 * Axes without overflow (within `FILMSTRIP_OVERFLOW_TOLERANCE_PX`, or a
 * non-positive viewport) keep the current offset rather than snapping.
 */
export function filmstripCenteredScrollOffset(intent: FilmstripCenterIntent): FilmstripScrollOffset {
  let scrollLeft = intent.scrollLeft;
  if (intent.clientWidth > 0 && filmstripOverflows(intent.scrollWidth, intent.clientWidth)) {
    const target = intent.itemLeft + intent.itemWidth / 2 - intent.clientWidth / 2;
    scrollLeft = Math.min(Math.max(target, 0), Math.max(intent.scrollWidth - intent.clientWidth, 0));
  }
  let scrollTop = intent.scrollTop;
  if (intent.clientHeight > 0 && filmstripOverflows(intent.scrollHeight, intent.clientHeight)) {
    const max = Math.max(intent.scrollHeight - intent.clientHeight, 0);
    if (intent.itemTop < intent.scrollTop) scrollTop = intent.itemTop;
    else if (intent.itemTop + intent.itemHeight > intent.scrollTop + intent.clientHeight) {
      scrollTop = intent.itemTop + intent.itemHeight - intent.clientHeight;
    }
    scrollTop = Math.min(Math.max(scrollTop, 0), max);
  }
  return { scrollLeft, scrollTop };
}

/** Index of the filmstrip item to focus for a key press in a wrapped grid.
 *
 * Left/Right/Home/End behave exactly as {@link filmstripArrowIndex} (DOM
 * order across rows). Up/Down step one row in the same column; there is no
 * wrapping (first/last row holds) and a partial last row holds when the
 * column has no cell below. `columns` is the live first-row item count;
 * values < 1 mean "unknown" and Up/Down hold rather than guess.
 */
export function filmstripGridArrowIndex(key: string, currentIndex: number, itemCount: number, columns: number): number {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) return -1;
  if (key === 'ArrowUp') {
    if (!(columns >= 1)) return -1;
    const target = currentIndex - Math.floor(columns);
    return target >= 0 ? target : -1;
  }
  if (key === 'ArrowDown') {
    if (!(columns >= 1)) return -1;
    const target = currentIndex + Math.floor(columns);
    return target < itemCount ? target : -1;
  }
  return filmstripArrowIndex(key, currentIndex, itemCount);
}
