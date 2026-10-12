// apps/web/tests/e2e/basic.spec.ts
//
// Smoke e2e for Photomator. Verifies that:
//   - the Vite dev server boots and serves `/` against the isolated test API
//   - the library gate clears once /api/library resolves (seeded .e2e data)
//   - the editor mounts: toolbar, photo frame, inspector
//   - the Repair tool opens the heal inspector with all four methods
//
// Intentionally minimal; heal behavior lives in heal-*.spec.ts. Seed images
// are stubbed to a local SVG so no test needs the network or CORS-clean
// remote pixels.
import { expect, test } from "@playwright/test";
import { gotoEditor, resetPhoto, stubLibraryImages, PHOTO_ID } from "./helpers";

test("home page loads and renders the photo editor", async ({ page }) => {
  await stubLibraryImages(page);
  await gotoEditor(page);

  // Toolbar (Topbar.tsx) renders one button per tool; Repair is the heal entry.
  // Order is Adjust first (the default tool), then Repair, Crop, and the
  // Enhance one-shot action last. Clone was removed.
  const toolbar = page.getByRole("toolbar", { name: "Editing tools" });
  await expect(toolbar.getByRole("button", { name: "Repair", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Adjust", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Clone", exact: true })).toHaveCount(0);
  await expect(toolbar.locator("button").first()).toContainText("Adjust");

  // PhotoCanvas mounts with an empty retouch state on a fresh seed photo.
  await expect(page.getByTestId("photo-frame")).toBeVisible();
  await expect(page.getByTestId("edited-canvas")).toBeVisible();
});

test("repair tool opens the heal inspector", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);

  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Repair", exact: true }).click();

  // Inspector repair section: all four reconstruction methods + quality tiers.
  await expect(page.getByTestId("repair-method-ml-heal")).toBeVisible();
  await expect(page.getByTestId("repair-method-heal")).toBeVisible();
  await expect(page.getByTestId("repair-method-telea")).toBeVisible();
  await expect(page.getByTestId("repair-method-ns")).toBeVisible();
  await expect(page.getByTestId("heal-quality-balanced")).toBeVisible();
  await expect(page.getByTestId("brush-size")).toBeVisible();
  await expect(page.getByTestId("retouch-status")).toContainText("No retouching yet");
});

test("crop view has no Reset Composition button; reset stays in options menu", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);

  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Crop", exact: true }).click();

  // Reset Composition was removed from the Crop inspector body.
  await expect(page.getByRole("button", { name: "Reset Composition" })).toHaveCount(0);

  // Reset remains available via the inspector "..." options menu.
  await page.getByRole("button", { name: "Adjustment options" }).click();
  await expect(page.getByRole("menuitem", { name: "Reset All Adjustments" })).toBeVisible();
});

test("compare is disabled while cropping", async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);

  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Crop", exact: true }).click();

  // Both compare entry points (toolbar + canvas status) are disabled on Crop.
  await expect(page.locator(".toolbar-actions").getByRole("button", { name: /Compare/ })).toBeDisabled();
  await expect(page.locator(".canvas-status .compare-button")).toBeDisabled();

  // Back on Adjust, compare works again.
  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.locator(".canvas-status .compare-button")).toBeEnabled();
});
