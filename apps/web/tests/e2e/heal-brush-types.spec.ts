// apps/web/tests/e2e/heal-brush-types.spec.ts
//
// Locks brush-size/type behavior across reconstruction methods
// (core/inpaint.ts, Inspector RepairMethodControl):
//   - heal / Smooth (telea) / Detail (ns) each run their own transport and
//     produce visibly different fills for the same stroke
//   - brush size changes what a new stroke covers (small vs large heals differ)
//   - feather + seamless travel with the healing call, never with finished work
//
// Real worker throughout (classic + diffusion need OpenCV); assertions are
// pixel + recorded-call based, never timing-based.
import { expect, test, type Page } from "@playwright/test";
import {
  PHOTO_ID,
  clearHealCalls,
  getHealCalls,
  gotoEditor,
  healStroke,
  resetPhoto,
  sampleCanvasPixel,
  selectRepairMethod,
  setRangeByTestId,
  stubLibraryImages,
} from "./helpers";

const STROKE = { from: { x: 0.42, y: 0.42 }, to: { x: 0.5, y: 0.5 }, center: { x: 0.46, y: 0.46 } };

test.beforeEach(async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  // Repair tool once; methods switch per test below.
  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Repair", exact: true }).click();
});

async function healCenterWith(
  page: Page,
  method: "heal" | "telea" | "ns",
): Promise<{ r: number; g: number; b: number }> {
  await selectRepairMethod(page, method);
  await healStroke(page, STROKE.from, STROKE.to);
  return sampleCanvasPixel(page, STROKE.center);
}

test("heal, smooth, and detail each reconstruct differently", async ({ page }) => {
  const healed = await healCenterWith(page, "heal");
  const healCalls = await getHealCalls(page);
  expect(healCalls).toHaveLength(1);
  expect(healCalls[0]?.method).toBe("heal");

  // Same stroke, different engine: reset via API (fresh state, same pixels).
  await resetPhoto(page, PHOTO_ID);
  await page.reload();
  await gotoEditor(page);
  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Repair", exact: true }).click();
  const smooth = await healCenterWith(page, "telea");
  const smoothCalls = await getHealCalls(page);
  expect(smoothCalls.at(-1)?.method).toBe("telea");

  await resetPhoto(page, PHOTO_ID);
  await page.reload();
  await gotoEditor(page);
  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Repair", exact: true }).click();
  const detail = await healCenterWith(page, "ns");

  // Exemplar transplant vs two diffusion fills: mutually different pixels.
  expect(smooth).not.toEqual(healed);
  expect(detail).not.toEqual(healed);
  expect(detail).not.toEqual(smooth);
});

test("brush size changes what a new stroke heals", async ({ page }) => {
  await selectRepairMethod(page, "heal");

  await setRangeByTestId(page, "brush-size", 12);
  await healStroke(page, { x: 0.3, y: 0.3 }, { x: 0.32, y: 0.32 });
  const small = await sampleCanvasPixel(page, { x: 0.31, y: 0.31 });

  await resetPhoto(page, PHOTO_ID);
  await page.reload();
  await gotoEditor(page);
  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Repair", exact: true }).click();
  await selectRepairMethod(page, "heal");
  await setRangeByTestId(page, "brush-size", 120);
  await healStroke(page, { x: 0.3, y: 0.3 }, { x: 0.32, y: 0.32 });
  const large = await sampleCanvasPixel(page, { x: 0.31, y: 0.31 });

  // A 10x brush paints a different mask, so the composite differs.
  expect(large).not.toEqual(small);
  // Both healed exactly one group through the worker.
  const calls = await getHealCalls(page);
  expect(calls.filter((call) => call.method === "heal")).toHaveLength(1);
});

test("feather and seamless ride on the healing call", async ({ page }) => {
  await selectRepairMethod(page, "heal");
  await setRangeByTestId(page, "blend-feather", 0);
  await healStroke(page, STROKE.from, STROKE.to);

  const calls = await getHealCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.featherPx).toBe(0);
  expect(calls[0]?.seamlessLight).toBe(false);

  // Seamless on + feather 8: finished group untouched, next call carries both.
  await page.getByTestId("seamless-light-row").getByRole("switch").click();
  await setRangeByTestId(page, "blend-feather", 8);
  await clearHealCalls(page);
  await healStroke(page, { x: 0.62, y: 0.3 }, { x: 0.68, y: 0.36 });

  const next = await getHealCalls(page);
  expect(next).toHaveLength(1);
  expect(next[0]?.seamlessLight).toBe(true);
  expect(next[0]?.featherPx).toBe(8);
});
