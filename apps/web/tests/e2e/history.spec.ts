// apps/web/tests/e2e/history.spec.ts
//
// Undo/redo/reset e2e for f/8. Verifies that:
//   - a slider drag is one undo step (toolbar buttons + Ctrl/Cmd+Z, Shift+Z, Y)
//   - one heal stroke is exactly one undo step, and two strokes are two steps
//   - rotate is undoable, and reset clears everything + purges heal overlays
//   - reset on a pristine photo is a noop (no phantom history entry)
//   - undo of a reset (or stroke) restores strokes AND their server overlays
//
// Classic `heal` only: local compute, no ML mocks, fastest and least flaky.
// Seed images are stubbed to a local SVG so no test needs the network.
import { expect, test } from "@playwright/test";
import {
  PHOTO_ID,
  adjustSlider,
  clearHealCalls,
  getHealCalls,
  gotoEditor,
  healStroke,
  historyButton,
  resetPhoto,
  resetViaMenu,
  retouchGroupCount,
  selectRepairMethod,
  serverEdit,
  serverOverlays,
  stubLibraryImages,
  waitForHealingDone,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
});

test("slider adjustment undoes and redoes via toolbar and keyboard", async ({ page }) => {
  const undo = historyButton(page, "Undo");
  const redo = historyButton(page, "Redo");
  await expect(undo).toBeDisabled();

  await adjustSlider(page, "Exposure", 1);
  await expect(page.getByLabel("Exposure value")).toHaveValue("1");
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).exposure, { timeout: 10_000 })
    .toBe(1);
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect(page.getByLabel("Exposure value")).toHaveValue("0");
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).exposure, { timeout: 10_000 })
    .toBe(0);
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect(page.getByLabel("Exposure value")).toHaveValue("1");

  // Keyboard: undo, redo via Shift+Z, undo again, redo via Y.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Exposure value")).toHaveValue("0");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByLabel("Exposure value")).toHaveValue("1");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Exposure value")).toHaveValue("0");
  await page.keyboard.press("ControlOrMeta+y");
  await expect(page.getByLabel("Exposure value")).toHaveValue("1");
});

test("one heal stroke is exactly one undo step", async ({ page }) => {
  await selectRepairMethod(page, "heal");
  await healStroke(page, { x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 });
  await expect(page.getByTestId("retouch-status")).toContainText("1 group");
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(1);

  await historyButton(page, "Undo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("No retouching yet");
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).retouches.length, { timeout: 10_000 })
    .toBe(0);
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(0);

  // Redo restores the stroke from the in-memory cache AND re-persists its
  // overlay (purged as an orphan by the undo), so reloads never reheal.
  await clearHealCalls(page);
  await historyButton(page, "Redo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("1 group");
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).retouches.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await waitForHealingDone(page);
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(1);
});

test("two heal strokes undo and redo independently", async ({ page }) => {
  await selectRepairMethod(page, "heal");
  await healStroke(page, { x: 0.25, y: 0.3 }, { x: 0.35, y: 0.4 });
  await healStroke(page, { x: 0.6, y: 0.6 }, { x: 0.7, y: 0.7 });
  await expect(page.getByTestId("retouch-status")).toContainText("2 groups");
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(2);

  // Fast consecutive strokes must NOT coalesce: two undos to clear both.
  await historyButton(page, "Undo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("1 group");
  await historyButton(page, "Undo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("No retouching yet");

  await clearHealCalls(page);
  await historyButton(page, "Redo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("1 group");
  await historyButton(page, "Redo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("2 groups");
  await waitForHealingDone(page);
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(2);
});

test("rotate undoes and redoes", async ({ page }) => {
  await page
    .getByRole("toolbar", { name: "Editing tools" })
    .getByRole("button", { name: "Crop", exact: true })
    .click();
  await page.getByTitle("Rotate left 90 degrees").click();
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).rotation, { timeout: 10_000 })
    .toBe(-90);

  await historyButton(page, "Undo").click();
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).rotation, { timeout: 10_000 })
    .toBe(0);

  await historyButton(page, "Redo").click();
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).rotation, { timeout: 10_000 })
    .toBe(-90);
});

test("reset clears everything, purges overlays, and undoes", async ({ page }) => {
  await adjustSlider(page, "Exposure", 1);
  await selectRepairMethod(page, "heal");
  await healStroke(page, { x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 });
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(1);

  // The reset itself must not trigger any reheal.
  await clearHealCalls(page);
  await resetViaMenu(page);
  await expect(page.locator(".toast")).toContainText("Adjustments reset");
  await expect(page.getByTestId("retouch-status")).toContainText("No retouching yet");
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).exposure, { timeout: 10_000 })
    .toBe(0);
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).retouches.length, { timeout: 10_000 })
    .toBe(0);
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(0);
  // Let any stray jobs surface, then prove none ran.
  await page.waitForTimeout(1500);
  expect(await getHealCalls(page)).toHaveLength(0);

  // Undo restores the pre-reset recipe, rehealed pixels, and the overlay.
  await historyButton(page, "Undo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("1 group");
  expect(await retouchGroupCount(page)).toBe(1);
  await expect
    .poll(async () => (await serverEdit(page, PHOTO_ID)).exposure, { timeout: 10_000 })
    .toBe(1);
  await page
    .getByRole("toolbar", { name: "Editing tools" })
    .getByRole("button", { name: "Adjust", exact: true })
    .click();
  await expect(page.getByLabel("Exposure value")).toHaveValue("1");
  // The restored stroke may reheal from scratch (overlay was purged): allow
  // a job to start, then require full settlement before asserting pixels.
  await waitForHealingDone(page);
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(1);
});

test("reset on a pristine photo is a noop", async ({ page }) => {
  await expect(historyButton(page, "Undo")).toBeDisabled();
  await resetViaMenu(page);
  await expect(page.locator(".toast")).toContainText("nothing to reset");
  await expect(historyButton(page, "Undo")).toBeDisabled();
});
