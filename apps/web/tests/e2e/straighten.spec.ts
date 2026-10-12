// apps/web/tests/e2e/straighten.spec.ts
//
// Locks straighten UX (crop inspector + canvas grid):
//   - dragging the Straighten slider swaps the thirds grid for a fine mesh
//     (ninths, thirds emphasized) until the drag ends
//   - the Auto trigger matches the other Auto actions (auto-small pill, not
//     a full secondary button)
import { expect, test } from "@playwright/test";
import { PHOTO_ID, gotoEditor, resetPhoto, stubLibraryImages } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  await page
    .getByRole("toolbar", { name: "Editing tools" })
    .getByRole("button", { name: "Crop", exact: true })
    .click();
});

test("dragging the straighten slider shows a fine mesh", async ({ page }) => {
  const thirds = page.locator(".photo-frame > .crop-grid:not(.is-fine)");
  const fine = page.getByTestId("crop-grid-fine");

  // At rest the crop tool shows the thirds grid.
  await expect(thirds).toBeVisible();
  await expect(fine).toBeHidden();

  // Pointer down on the slider swaps in the fine mesh: 8 + 8 lines at
  // ninths, with the thirds lines emphasized.
  const slider = page.locator(".straighten-assist input[type='range']");
  await slider.hover();
  await page.mouse.down();
  await expect(fine).toBeVisible();
  await expect(fine.locator("> i")).toHaveCount(16);
  await expect(fine.locator("> i.is-major")).toHaveCount(4);

  // Releasing anywhere restores the thirds grid.
  await page.mouse.up();
  await expect(fine).toBeHidden();
  await expect(thirds).toBeVisible();
});

test("auto straighten uses the shared auto pill style", async ({ page }) => {
  const auto = page.locator(".straighten-auto");
  await expect(auto).toBeVisible();
  await expect(auto).toHaveClass(/auto-small/);
  await expect(auto).not.toHaveClass(/secondary-button/);
});
