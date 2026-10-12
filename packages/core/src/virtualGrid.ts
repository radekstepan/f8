// Pure row-window math for the virtualized photo grid.
//
// The grid renders only the rows around the viewport plus an overscan margin,
// with top/bottom spacers standing in for the hidden rows so the scrollbar
// and scroll position behave like the full list. All geometry lives here so
// it is unit-testable; the component only measures and slices.

export interface GridWindowInput {
  /** Total items in the grid. */
  itemCount: number;
  /** Columns per row (>= 1; smaller values are treated as 1). */
  columns: number;
  /** Current scroll offset of the grid container in px (clamped >= 0). */
  scrollTop: number;
  /** Visible height of the grid container in px. */
  viewportHeight: number;
  /** Measured height of one grid item in px. Non-positive disables windowing. */
  rowHeight: number;
  /** Measured row gap in px. */
  rowGap: number;
  /** Extra rows rendered above and below the viewport (clamped >= 0). */
  overscanRows: number;
}

export interface GridWindow {
  /** First visible row (inclusive) and last (exclusive). */
  startRow: number;
  endRow: number;
  /** Item slice: photos.slice(startIndex, endIndex). */
  startIndex: number;
  endIndex: number;
  /** Spacer heights in px; zero means "omit the spacer". */
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  rowCount: number;
}

const FULL_LIST = (itemCount: number, rowCount: number): GridWindow => ({
  startRow: 0,
  endRow: rowCount,
  startIndex: 0,
  endIndex: itemCount,
  topSpacerHeight: 0,
  bottomSpacerHeight: 0,
  rowCount,
});

export function computeGridWindow(input: GridWindowInput): GridWindow {
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  const columns = Math.max(1, Math.floor(input.columns) || 1);
  const rowCount = Math.ceil(itemCount / columns);
  if (itemCount === 0 || rowCount === 0) return FULL_LIST(0, 0);
  const rowHeight = input.rowHeight;
  const rowGap = Math.max(0, input.rowGap || 0);
  // Without a positive measurement there is no safe window: render all.
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return FULL_LIST(itemCount, rowCount);
  const scrollTop = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0;
  const viewportHeight = Number.isFinite(input.viewportHeight) ? Math.max(0, input.viewportHeight) : 0;
  const overscan = Number.isFinite(input.overscanRows) ? Math.max(0, Math.floor(input.overscanRows)) : 0;

  const stride = rowHeight + rowGap;
  // Programmatic overscroll clamps like the browser would, so the window
  // still covers the last rows instead of collapsing to empty.
  const totalHeight = rowCount * rowHeight + (rowCount - 1) * rowGap;
  const clampedScroll = Math.min(scrollTop, Math.max(0, totalHeight - viewportHeight));
  const firstVisible = Math.floor(clampedScroll / stride);
  const lastVisible = Math.floor((clampedScroll + viewportHeight) / stride);
  const startRow = Math.max(0, Math.min(rowCount, firstVisible - overscan));
  const endRow = Math.max(startRow, Math.min(rowCount, lastVisible + 1 + overscan));

  const startIndex = Math.min(itemCount, startRow * columns);
  const endIndex = Math.min(itemCount, endRow * columns);
  // Each spacer stands in for its hidden rows plus their grid gaps; the grid
  // itself contributes one gap above/below the spacer, hence the minus rowGap.
  const topSpacerHeight = startRow > 0 ? startRow * stride - rowGap : 0;
  const hiddenBottom = rowCount - endRow;
  const bottomSpacerHeight = hiddenBottom > 0 ? hiddenBottom * stride - rowGap : 0;
  return { startRow, endRow, startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, rowCount };
}
