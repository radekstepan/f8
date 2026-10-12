// apps/web/tests/e2e/presets.spec.ts
//
// Locks preset toggling (PhotoStrips): clicking the active preset reverts
// to Original instead of stacking an identical undo step, and re-clicking
// Original itself is a no-op.
import { expect, test } from "@playwright/test";
import {
  PHOTO_ID,
  gotoEditor,
  healStroke,
  historyButton,
  resetPhoto,
  selectRepairMethod,
  stubLibraryImages,
} from "./helpers";

test("clicking the active preset again reverts to Original", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);

  // Fresh seed photo: Original is active, nothing edited.
  const selected = page.locator(".preset-item.is-selected");
  await expect(selected).toContainText("Original");
  await expect(page.locator(".edited-indicator")).toBeHidden();

  // Applying a preset marks the photo edited...
  await page.locator(".preset-item", { hasText: "Vivid" }).click();
  await expect(selected).toContainText("Vivid");
  await expect(page.locator(".edited-indicator")).toBeVisible();

  // ...and clicking it again reverts to Original.
  await page.locator(".preset-item", { hasText: "Vivid" }).click();
  await expect(selected).toContainText("Original");
  await expect(page.locator(".edited-indicator")).toBeHidden();

  // Re-clicking Original is a no-op, not an empty undo step.
  await page.locator(".preset-item", { hasText: "Original" }).click();
  await expect(selected).toContainText("Original");
  await expect(page.locator(".edited-indicator")).toBeHidden();
});

test("repair keeps Original selected through paint, delete, and undo", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);

  // The default tab is orientation-neutral, even on portrait photos.
  await expect(page.locator(".preset-tabs")).toContainText("Essentials");
  await expect(page.locator(".preset-tabs")).not.toContainText("Landscape");

  const selected = page.locator(".preset-item.is-selected");
  await expect(selected).toContainText("Original");

  await selectRepairMethod(page, "heal");
  await healStroke(page, { x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 });
  // Repair is not a color look: Original stays selected, but the photo
  // still counts as edited.
  await expect(selected).toContainText("Original");
  await expect(page.locator(".edited-indicator")).toBeVisible();

  // Deleting the stroke from the inspector keeps Original too.
  await page.getByRole("button", { name: "Delete Repair 1" }).click();
  await expect(page.getByTestId("retouch-status")).toContainText("No retouching yet");
  await expect(selected).toContainText("Original");
  await expect(page.locator(".edited-indicator")).toBeHidden();

  // Undoing the delete restores the stroke without deselecting Original.
  await historyButton(page, "Undo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("1 group");
  await expect(selected).toContainText("Original");

  // Undoing the stroke itself leaves a pristine, still-Original photo.
  await historyButton(page, "Undo").click();
  await expect(page.getByTestId("retouch-status")).toContainText("No retouching yet");
  await expect(selected).toContainText("Original");
  await expect(page.locator(".edited-indicator")).toBeHidden();
});

test("sliders dragged back to defaults restore the Original label", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);

  const selected = page.locator(".preset-item.is-selected");
  await expect(selected).toContainText("Original");

  // A color tweak leaves Original: no preset matches the Custom recipe.
  const exposure = page.getByLabel("Exposure", { exact: true });
  await exposure.fill("1");
  await expect(selected).toHaveCount(0);
  await expect(page.locator(".edited-indicator")).toBeVisible();

  // Returning the slider to its default restores Original, not Custom.
  await exposure.fill("0");
  await expect(selected).toContainText("Original");
  await expect(page.locator(".edited-indicator")).toBeHidden();
});
