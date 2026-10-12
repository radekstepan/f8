// apps/web/tests/e2e/presets.spec.ts
//
// Locks preset toggling (PhotoStrips): clicking the active preset reverts
// to Original instead of stacking an identical undo step, and re-clicking
// Original itself is a no-op.
import { expect, test } from "@playwright/test";
import { PHOTO_ID, gotoEditor, resetPhoto, stubLibraryImages } from "./helpers";

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
