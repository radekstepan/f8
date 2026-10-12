// Repro: heal-then-turn must move healed pixels, never re-run inference.
// Covers both turn types: 90-degree rotates (R key / crop-inspector
// buttons) and straighten-dial tweaks (small slider steps).
import { expect, test } from "@playwright/test";
import { mockMlHeal } from "./heal-mocks";
import {
  PHOTO_ID,
  clearHealCalls,
  clearPaintLog,
  getHealCalls,
  getPaintLog,
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

/** Nudge the straighten slider by `ticks` of 0.1deg via keyboard (a dial tweak). */
async function straightenTweak(page: import("@playwright/test").Page, ticks: number): Promise<void> {
  await page
    .getByRole("toolbar", { name: "Editing tools" })
    .getByRole("button", { name: "Crop", exact: true })
    .click();
  const slider = page.locator(".straighten-assist input[type='range']");
  await slider.focus();
  for (let i = 0; i < Math.abs(ticks); i += 1) {
    await page.keyboard.press(ticks > 0 ? "ArrowRight" : "ArrowLeft");
  }
  const expected = ticks * 0.1;
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).straighten, { timeout: 10_000 })
    .toBeGreaterThan(expected - 0.05);
}

/** Every post-tweak paint settled through the sync path (no queued reheal repaint). */
async function expectSyncOnlyPaints(page: import("@playwright/test").Page): Promise<void> {
  const log = await getPaintLog(page);
  expect(log.length).toBeGreaterThan(0);
  expect(log.filter((entry) => entry.source.startsWith("queue"))).toEqual([]);
  expect(log.some((entry) => entry.source === "sync-heal")).toBe(true);
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

test("classic heal-then-straighten runs zero new inference and settles via sync", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  await selectRepairMethod(page, "heal");

  await healStroke(page, { x: 0.2, y: 0.3 }, { x: 0.26, y: 0.36 });
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(1);

  await clearHealCalls(page);
  await clearPaintLog(page);
  await straightenTweak(page, 30);
  await waitForHealingDone(page);
  expect(await getHealCalls(page)).toHaveLength(0);
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(1);
  await expectSyncOnlyPaints(page);
});

test("ml heal-then-straighten hits zero inpaint calls and settles via sync", async ({ page }) => {
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
  await clearPaintLog(page);
  await straightenTweak(page, 30);
  await waitForHealingDone(page);
  expect(await getHealCalls(page)).toHaveLength(0);
  expect(inpaintCalls).toHaveLength(0);
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(1);
  await expectSyncOnlyPaints(page);
});
