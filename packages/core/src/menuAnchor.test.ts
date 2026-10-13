import { describe, expect, it } from "vitest";
import { MENU_ANCHOR_EDGE_PX, MENU_ANCHOR_GAP_PX, anchorMenuBelowTrigger, type MenuAnchorBox, type MenuAnchorTrigger } from "./menuAnchor.js";

const viewport: MenuAnchorBox = { width: 1280, height: 800 };
const menu: MenuAnchorBox = { width: 190, height: 120 };

function trigger(top: number, right: number, bottom: number, left = right - 26): MenuAnchorTrigger {
  return { top, right, bottom, left };
}

describe("anchorMenuBelowTrigger", () => {
  it("opens below the trigger with right edges aligned", () => {
    expect(anchorMenuBelowTrigger(trigger(200, 200, 226), menu, viewport)).toEqual({ x: 200 - 190, y: 226 + MENU_ANCHOR_GAP_PX });
  });

  it("flips above the trigger when below would clip the bottom edge", () => {
    // Bottom row: below ends at 770 + 120, past the 800px viewport.
    expect(anchorMenuBelowTrigger(trigger(744, 200, 770), menu, viewport)).toEqual({ x: 200 - 190, y: 744 - 120 - MENU_ANCHOR_GAP_PX });
  });

  it("clamps to the left edge when right-aligned would leave the viewport", () => {
    // Narrow sidebar trigger: right-aligned x would be -10.
    expect(anchorMenuBelowTrigger(trigger(200, 180, 226), menu, viewport).x).toBe(MENU_ANCHOR_EDGE_PX);
  });

  it("clamps to the right edge when the menu would overflow it", () => {
    const wide = trigger(200, 1400, 226, 1374);
    expect(anchorMenuBelowTrigger(wide, menu, viewport)).toEqual({
      x: viewport.width - menu.width - MENU_ANCHOR_EDGE_PX,
      y: 226 + MENU_ANCHOR_GAP_PX,
    });
  });

  it("pins an oversized menu inside the viewport instead of flipping past the top", () => {
    const tall: MenuAnchorBox = { width: 190, height: 900 };
    const pos = anchorMenuBelowTrigger(trigger(744, 180, 770), tall, viewport);
    expect(pos.y).toBe(MENU_ANCHOR_EDGE_PX);
    const wide: MenuAnchorBox = { width: 1400, height: 120 };
    expect(anchorMenuBelowTrigger(trigger(200, 180, 226), wide, viewport).x).toBe(MENU_ANCHOR_EDGE_PX);
  });
});
