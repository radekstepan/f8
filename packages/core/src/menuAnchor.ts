/** Viewport-anchored dropdown positioning (sidebar album menus, photo context menus).
 *
 * Fixed-positioned menus escape scroll clipping and float above the UI, but
 * fixed positioning needs explicit viewport coordinates: a dropdown opens
 * below its trigger with right edges aligned (the historical look), a
 * context menu opens at the cursor, and both flip to the side with room
 * when the preferred side would clip, then clamp both axes into the
 * viewport. Pure math so it unit-tests without a DOM; the component only
 * measures the rects and applies the returned viewport coordinates as
 * inline left/top.
 */

/** Viewport coordinates of the menu trigger (a DOMRect subset). */
export interface MenuAnchorTrigger {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A measured menu or viewport size in px. */
export interface MenuAnchorBox {
  width: number;
  height: number;
}

/** Gap (px) between the trigger and the open menu. */
export const MENU_ANCHOR_GAP_PX = 5;

/** Minimum (px) clearance kept from every viewport edge. */
export const MENU_ANCHOR_EDGE_PX = 8;

/** Viewport coordinates of a right-click (a pointer-event client subset). */
export interface MenuAnchorCursor {
  x: number;
  y: number;
}

/** Viewport position for a context menu opened at the cursor. */
export function anchorMenuAtCursor(cursor: MenuAnchorCursor, menu: MenuAnchorBox, viewport: MenuAnchorBox): { x: number; y: number } {
  // Prefer below/right of the cursor; flip above/left when that would clip.
  // (Right-clicks in the bottom-docked filmstrip always take the above path.)
  let x = cursor.x + menu.width > viewport.width - MENU_ANCHOR_EDGE_PX ? cursor.x - menu.width : cursor.x;
  let y = cursor.y + menu.height > viewport.height - MENU_ANCHOR_EDGE_PX ? cursor.y - menu.height : cursor.y;
  // Neither side fits (a menu larger than the viewport): pin inside.
  if (x < MENU_ANCHOR_EDGE_PX) x = MENU_ANCHOR_EDGE_PX;
  if (y < MENU_ANCHOR_EDGE_PX) y = MENU_ANCHOR_EDGE_PX;
  if (x + menu.width > viewport.width - MENU_ANCHOR_EDGE_PX) {
    x = Math.max(MENU_ANCHOR_EDGE_PX, viewport.width - menu.width - MENU_ANCHOR_EDGE_PX);
  }
  if (y + menu.height > viewport.height - MENU_ANCHOR_EDGE_PX) {
    y = Math.max(MENU_ANCHOR_EDGE_PX, viewport.height - menu.height - MENU_ANCHOR_EDGE_PX);
  }
  return { x, y };
}

/** Viewport position for a dropdown anchored to a trigger button. */
export function anchorMenuBelowTrigger(trigger: MenuAnchorTrigger, menu: MenuAnchorBox, viewport: MenuAnchorBox): { x: number; y: number } {
  let x = trigger.right - menu.width;
  let y = trigger.bottom + MENU_ANCHOR_GAP_PX;
  // Below would clip: flip above the trigger instead.
  if (y + menu.height > viewport.height - MENU_ANCHOR_EDGE_PX) {
    y = trigger.top - menu.height - MENU_ANCHOR_GAP_PX;
  }
  // Neither side fits (a menu taller than the viewport): pin inside.
  if (y < MENU_ANCHOR_EDGE_PX) y = Math.max(MENU_ANCHOR_EDGE_PX, viewport.height - menu.height - MENU_ANCHOR_EDGE_PX);
  if (x < MENU_ANCHOR_EDGE_PX) x = MENU_ANCHOR_EDGE_PX;
  // A menu wider than the viewport pins to the left edge instead.
  if (x + menu.width > viewport.width - MENU_ANCHOR_EDGE_PX) {
    x = Math.max(MENU_ANCHOR_EDGE_PX, viewport.width - menu.width - MENU_ANCHOR_EDGE_PX);
  }
  return { x, y };
}
