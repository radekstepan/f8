// apps/web/tests/e2e/ml-heal-tiers.spec.ts
//
// Locks ML-heal tier behavior (core/ml-heal.ts, useInpaintRepair, Inspector):
// Balanced runs LaMa, Best runs Moebius (mocked tints prove routing); Fast
// is classic-only and coerced under ML Heal; tier switches clear stale
// errors; a failing tier surfaces a persistent alert and recovery is an
// explicit tier switch (no fallback buttons).
//
// The neural backend is fully mocked (heal-mocks.ts): no weights, no GPU,
// deterministic pixels per engine.
import { expect, test } from "@playwright/test";
import { LAMA_TINT, MOEBIUS_TINT, mockMlHeal } from "./heal-mocks";
import {
  PHOTO_ID,
  clearHealCalls,
  getHealCalls,
  getMlReady,
  gotoEditor,
  healStroke,
  paintStroke,
  resetPhoto,
  retouchGroupCount,
  sampleCanvasPixel,
  selectRepairMethod,
  stubLibraryImages,
  waitForHealingDone,
  waitForHealingStart,
  waitForMlReady,
} from "./helpers";

const TINT_TOLERANCE = 40;

function near(pixel: { r: number; g: number; b: number }, tint: { r: number; g: number; b: number }): boolean {
  return (
    Math.abs(pixel.r - tint.r) <= TINT_TOLERANCE &&
    Math.abs(pixel.g - tint.g) <= TINT_TOLERANCE &&
    Math.abs(pixel.b - tint.b) <= TINT_TOLERANCE
  );
}

test.beforeEach(async ({ page }) => {
  await stubLibraryImages(page);
  await mockMlHeal(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  await selectRepairMethod(page, "ml-heal");
  await waitForMlReady(page);
  await clearHealCalls(page);
});

test("balanced heals with lama, best with moebius", async ({ page }) => {
  // Balanced is the default tier -> LaMa engine.
  await expect(page.getByTestId("heal-quality-balanced")).toHaveClass(/is-active/);
  await healStroke(page, { x: 0.2, y: 0.3 }, { x: 0.26, y: 0.36 });
  expect(near(await sampleCanvasPixel(page, { x: 0.23, y: 0.33 }), LAMA_TINT)).toBe(true);

  // Best -> Moebius diffusion tier, painted over a different area.
  await page.getByTestId("heal-quality-best").click();
  await healStroke(page, { x: 0.6, y: 0.6 }, { x: 0.66, y: 0.66 });
  expect(near(await sampleCanvasPixel(page, { x: 0.63, y: 0.63 }), MOEBIUS_TINT)).toBe(true);

  // The LaMa group kept its pixels: tiers never cross-heal finished work.
  expect(near(await sampleCanvasPixel(page, { x: 0.23, y: 0.33 }), LAMA_TINT)).toBe(true);

  const calls = await getHealCalls(page);
  expect(calls.map((call) => call.quality)).toEqual(["balanced", "best"]);
  expect(await retouchGroupCount(page)).toBe(2);
});

test("fast has no ml tier and coerces to balanced", async ({ page }) => {
  // Fast is classic-only: hidden while ML Heal is selected...
  await expect(page.getByTestId("heal-quality-fast")).toBeHidden();

  // ...and entering ML Heal from classic Fast migrates to Balanced.
  await selectRepairMethod(page, "heal");
  await page.getByTestId("heal-quality-fast").click();
  await selectRepairMethod(page, "ml-heal");
  await expect(page.getByTestId("heal-quality-balanced")).toHaveClass(/is-active/);
  await waitForMlReady(page);
});

test("failed tier surfaces a persistent error without fallbacks", async ({ page }) => {
  await page.unroute("**/api/ml-heal/inpaint");
  await mockMlHeal(page, { failing: ["moebius"] });
  await page.getByTestId("heal-quality-best").click();

  await paintStroke(page, { x: 0.3, y: 0.3 }, { x: 0.36, y: 0.36 });
  await waitForHealingStart(page);
  await waitForHealingDone(page);

  // Errors never auto-dismiss: still visible well past the 4s success window.
  const alert = page.getByTestId("ml-progress");
  await expect(alert).toContainText("Model unavailable");
  await page.waitForTimeout(5000);
  await expect(alert).toContainText("Model unavailable");

  // A 503 is a failed heal, not a down server: no offline line, no
  // fallback buttons — recovery is an explicit tier switch.
  await expect(page.getByTestId("ml-offline")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try Balanced instead" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Use classic Repair/ })).toHaveCount(0);

  // Switching tiers clears the stale Moebius error; Balanced heals cleanly.
  await page.getByTestId("heal-quality-balanced").click();
  await expect(alert).toBeHidden({ timeout: 10_000 });
  await waitForHealingDone(page);
  expect(near(await sampleCanvasPixel(page, { x: 0.33, y: 0.33 }), LAMA_TINT)).toBe(true);
});

test("unreachable server shows one offline line and retry recovers", async ({ page }) => {
  await page.unroute("**/api/ml-heal/health");
  await page.unroute("**/api/ml-heal/warmup");
  await page.unroute("**/api/ml-heal/inpaint");
  await page.route("**/api/ml-heal/**", (route) => route.abort("failed"));

  // Re-enter ML Heal so warmup runs against the dead server.
  await selectRepairMethod(page, "heal");
  await selectRepairMethod(page, "ml-heal");

  // Neither tier can run: the whole ML tier UI collapses to one line.
  await expect(page.getByTestId("ml-offline")).toContainText("Photo server offline.");
  await expect(page.getByTestId("heal-quality-group")).toBeHidden();
  await expect(page.getByTestId("ml-progress")).toBeHidden();
  await expect
    .poll(async () => (await getMlReady(page)).ready, { timeout: 10_000 })
    .toBe(false);

  // Server back: retry re-warms and restores the tier UI.
  await page.unroute("**/api/ml-heal/**");
  await mockMlHeal(page);
  await page.getByTestId("ml-retry").click();
  await waitForMlReady(page);
  await expect(page.getByTestId("ml-offline")).toBeHidden();
  await expect(page.getByTestId("heal-quality-group")).toBeVisible();
  await expect(page.getByTestId("heal-quality-balanced")).toHaveClass(/is-active/);
});

test("repair progress names the work and hides the bar once done", async ({ page }) => {
  await page.unroute("**/api/ml-heal/inpaint");
  await mockMlHeal(page, { delayMs: 6000 });

  await paintStroke(page, { x: 0.25, y: 0.4 }, { x: 0.3, y: 0.45 });
  await waitForHealingStart(page);

  // Long inference names the work plus elapsed time — no server/stall filler.
  await expect(page.getByTestId("ml-progress-stage")).toContainText(/Repairing… \d+s/, { timeout: 15_000 });
  await expect(page.getByTestId("ml-cancel")).toContainText("Cancel repair");

  await waitForHealingDone(page);

  // Terminal states keep their note but never a full progress bar.
  await expect(page.getByTestId("ml-progress-stage")).toContainText("Repair done", { timeout: 10_000 });
  await expect(page.locator('[data-testid="ml-progress"] .ml-progress-bar')).toHaveCount(0);
});

test("server-ready state shows a note without a progress bar", async ({ page }) => {
  // Re-enter ML Heal so warmup runs again against the mocked backend.
  await selectRepairMethod(page, "heal");
  await selectRepairMethod(page, "ml-heal");

  // A static ready state is a note, not progress: no bar under it.
  await expect(page.getByTestId("ml-progress-stage")).toContainText("Server ready.", { timeout: 15_000 });
  await expect(page.locator('[data-testid="ml-progress"] .ml-progress-bar')).toHaveCount(0);
});

test("cancel heals clears progress and later strokes still heal", async ({ page }) => {
  await page.unroute("**/api/ml-heal/inpaint");
  await mockMlHeal(page, { delayMs: 6000 });

  await paintStroke(page, { x: 0.25, y: 0.4 }, { x: 0.3, y: 0.45 });
  await waitForHealingStart(page);
  await expect(page.getByTestId("ml-cancel")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("ml-cancel").click();
  await expect(page.getByTestId("ml-progress")).toBeHidden({ timeout: 10_000 });

  // Cancel restarts the worker and drops readiness: re-enter ML Heal to
  // re-warm (same as a user recovering), with a fast backend this time.
  // The cancelled job's late result still lands harmlessly in its own area.
  await page.unroute("**/api/ml-heal/inpaint");
  await mockMlHeal(page);
  await selectRepairMethod(page, "heal");
  await selectRepairMethod(page, "ml-heal");
  await waitForMlReady(page);
  await paintStroke(page, { x: 0.55, y: 0.55 }, { x: 0.6, y: 0.6 });
  await waitForHealingStart(page);
  await waitForHealingDone(page);
  expect(near(await sampleCanvasPixel(page, { x: 0.575, y: 0.575 }), LAMA_TINT)).toBe(true);
});
