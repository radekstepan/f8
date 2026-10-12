// Repro: heal-then-rotate must rotate healed pixels, never re-run inference.
import { expect, test } from "@playwright/test";
import { mockMlHeal } from "./heal-mocks";
import {
  PHOTO_ID,
  clearHealCalls,
  getHealCalls,
  gotoEditor,
  healStroke,
  resetPhoto,
  selectRepairMethod,
  serverEdit,
  serverOverlays,
  stubLibraryImages,
  waitForHealingDone,
  waitForMlReady,
} from "./helpers";

async function rotateLeft(page: import("@playwright/test").Page): Promise<void> {
  await page
    .getByRole("toolbar", { name: "Editing tools" })
    .getByRole("button", { name: "Crop", exact: true })
    .click();
  await page.getByTitle("Rotate left 90 degrees").click();
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).rotation, { timeout: 10_000 })
    .toBe(-90);
}

test("classic heal-then-rotate runs zero new inference", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  await selectRepairMethod(page, "heal");

  await healStroke(page, { x: 0.2, y: 0.3 }, { x: 0.26, y: 0.36 });
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(1);

  await clearHealCalls(page);
  await rotateLeft(page);
  await waitForHealingDone(page);
  expect(await getHealCalls(page)).toHaveLength(0);
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(1);
});

test("ml heal-then-rotate hits zero inpaint calls", async ({ page }) => {
  await stubLibraryImages(page);
  const inpaintCalls = await mockMlHeal(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  await selectRepairMethod(page, "ml-heal");
  await waitForMlReady(page);
  await clearHealCalls(page);

  await healStroke(page, { x: 0.2, y: 0.3 }, { x: 0.26, y: 0.36 });
  expect(inpaintCalls.length).toBeGreaterThan(0);
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(1);

  inpaintCalls.length = 0;
  await clearHealCalls(page);
  await rotateLeft(page);
  await waitForHealingDone(page);
  expect(await getHealCalls(page)).toHaveLength(0);
  expect(inpaintCalls).toHaveLength(0);
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(1);
});
