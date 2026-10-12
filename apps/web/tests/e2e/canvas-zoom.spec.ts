// apps/web/tests/e2e/canvas-zoom.spec.ts
//
// Locks wheel zoom + minimap navigation (PhotoCanvas): the wheel zooms toward
// the hovered image point (never scrolling the stage), a minimap appears in
// the corner once the frame overflows the stage, and clicking it jumps the
// viewport to that section.
import { expect, test } from "@playwright/test";
import { PHOTO_ID, gotoEditor, resetPhoto, stubLibraryImages } from "./helpers";

async function stageScroll(page: Parameters<typeof gotoEditor>[0]) {
  return page.evaluate(() => {
    const stage = document.querySelector(".canvas-stage");
    if (!stage) throw new Error(".canvas-stage is missing.");
    return {
      left: stage.scrollLeft,
      top: stage.scrollTop,
      maxLeft: stage.scrollWidth - stage.clientWidth,
      maxTop: stage.scrollHeight - stage.clientHeight,
    };
  });
}

test("wheel zooms at the cursor and the minimap jumps the viewport", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);

  const zoom = page.getByLabel("Zoom level");
  await expect(zoom).toHaveValue("1");
  await expect(page.getByTestId("minimap")).toHaveCount(0);

  // Zoom in while hovering the left edge: the view stays biased left,
  // proving the zoom anchored at the cursor instead of the center.
  const frame = page.getByTestId("photo-frame");
  const box = await frame.boundingBox();
  if (!box) throw new Error("photo-frame has no bounding box.");
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => zoom.inputValue()).not.toBe("1");
  const biased = await stageScroll(page);
  expect(biased.maxLeft).toBeGreaterThan(0);
  expect(biased.left / biased.maxLeft).toBeLessThan(0.5);

  // Zoom to the max: the frame overflows and the minimap appears.
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -300);
  await expect(zoom).toHaveValue("3");
  const minimap = page.getByTestId("minimap");
  await expect(minimap).toBeVisible();
  const viewportRect = page.locator(".minimap-viewport");
  await expect(viewportRect).toBeVisible();

  const miniBox = await minimap.boundingBox();
  if (!miniBox) throw new Error("minimap has no bounding box.");
  const viewportLeft = () =>
    viewportRect.evaluate((node) => parseFloat((node as HTMLElement).style.left) || 0);

  // Clicking the minimap's top-left corner jumps to the start of the photo...
  await page.mouse.click(miniBox.x + 3, miniBox.y + 3);
  await expect.poll(async () => (await stageScroll(page)).left).toBeLessThanOrEqual(1);
  await expect.poll(viewportLeft).toBeLessThan(5);

  // ...and the bottom-right corner jumps to the far end.
  await page.mouse.click(miniBox.x + miniBox.width - 3, miniBox.y + miniBox.height - 3);
  await expect.poll(async () => (await stageScroll(page)).left).toBeGreaterThan(100);
  await expect.poll(viewportLeft).toBeGreaterThan(40);

  // Zooming back out hides the minimap once the frame fits again.
  const fitBox = await frame.boundingBox();
  if (!fitBox) throw new Error("photo-frame has no bounding box.");
  await page.mouse.move(fitBox.x + fitBox.width / 2, fitBox.y + fitBox.height / 2);
  for (let i = 0; i < 8; i += 1) await page.mouse.wheel(0, 300);
  await expect(zoom).toHaveValue("0.5");
  await expect(page.getByTestId("minimap")).toHaveCount(0);
});
