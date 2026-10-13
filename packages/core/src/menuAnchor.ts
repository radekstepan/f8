/** Viewport-anchored dropdown positioning (sidebar album menus).
 *
 * The sidebar album "..." menu is `position: fixed`, so it escapes the
 * sidebar's scroll clipping and floats above the UI. Fixed positioning needs
 * explicit viewport coordinates: the menu opens below its trigger with right
 * edges aligned (the historical look), flips above the trigger when the
 * bottom edge would clip, and clamps both axes into the viewport. Pure math
 * so it unit-tests without a DOM; the component only measures the rects and
 * applies the returned viewport coordinates as inline left/top.
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
