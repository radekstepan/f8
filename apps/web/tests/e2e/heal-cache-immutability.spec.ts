// apps/web/tests/e2e/heal-cache-immutability.spec.ts
//
// Locks the incremental heal cache contract (core/heal-cache.ts):
// a finished group is immutable — its pixels are reused verbatim until its
// stroke is deleted, regardless of the current method/quality/feather.
// Those settings apply only to groups healing right now, so one photo can
// mix classic- and ML-healed areas. Overlap composites newest-on-top; saved
// work is never re-healed to match a joint run.
//
// Runs against the real classic worker (no mocks): switching settings must
// produce zero new transport calls for finished groups.
import { expect, test, type Page } from "@playwright/test";
import {
  PHOTO_ID,
  clearHealCalls,
  getCacheKeys,
  getHealCalls,
  getPendingIds,
  gotoEditor,
  healStroke,
  resetPhoto,
  retouchGroupCount,
  sampleCanvasPixel,
  selectRepairMethod,
  serverOverlays,
  setRangeByTestId,
  stubLibraryImages,
  waitForHealingDone,
} from "./helpers";

const GROUP_A = { from: { x: 0.2, y: 0.3 }, to: { x: 0.26, y: 0.36 }, center: { x: 0.23, y: 0.33 } };
const GROUP_B = { from: { x: 0.58, y: 0.58 }, to: { x: 0.64, y: 0.64 }, center: { x: 0.61, y: 0.61 } };

test.beforeEach(async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  await selectRepairMethod(page, "heal");
});

/** Settle the pipeline, then assert absolutely nothing healed. */
async function expectNoReheal(page: Page): Promise<void> {
  await waitForHealingDone(page);
  // The queue debounces ~600ms after any edit; outwait it so a stray job
  // would have shown up in the recorded transport calls.
  await page.waitForTimeout(2000);
  expect(await getHealCalls(page)).toHaveLength(0);
  expect(await getPendingIds(page)).toHaveLength(0);
}

test("switching heal settings never reheals finished groups", async ({ page }) => {
  await healStroke(page, GROUP_A.from, GROUP_A.to);
  expect(await retouchGroupCount(page)).toBe(1);
  const before = await serverOverlays(page, PHOTO_ID);
  expect(before).toHaveLength(1);
  const pixelBefore = await sampleCanvasPixel(page, GROUP_A.center);
  await clearHealCalls(page);

  // Quality preset: applies to groups healing now, never to finished work.
  await page.getByTestId("heal-quality-best").click();
  await expectNoReheal(page);
  expect(await getCacheKeys(page)).toHaveLength(1);

  // Seamless light toggle: same — provenance for future heals only.
  await page.getByTestId("seamless-light-row").getByRole("switch").click();
  await expectNoReheal(page);

  // Blend feather: same.
  await setRangeByTestId(page, "blend-feather", 8);
  await expectNoReheal(page);

  // Brush size: not even a pipeline input for existing groups.
  await setRangeByTestId(page, "brush-size", 120);
  await expectNoReheal(page);

  // Telea keeps the single full-pass path: exactly one full-pass repaint,
  // but persisted per-group overlays are untouched (no PUT, no DELETE).
  await page.getByTestId("repair-method-telea").click();
  await waitForHealingDone(page);
  const teleaCalls = await getHealCalls(page);
  expect(teleaCalls).toHaveLength(1);
  expect(teleaCalls[0]?.method).toBe("telea");
  const duringTelea = await serverOverlays(page, PHOTO_ID);
  expect(duringTelea).toEqual(before);
  await clearHealCalls(page);

  // Back to Heal: the finished group composites from cache, zero inference.
  await page.getByTestId("repair-method-heal").click();
  await expectNoReheal(page);
  expect(await serverOverlays(page, PHOTO_ID)).toEqual(before);
  expect(await sampleCanvasPixel(page, GROUP_A.center)).toEqual(pixelBefore);
});

test("new groups heal with current settings; old pixels stay verbatim", async ({ page }) => {
  await healStroke(page, GROUP_A.from, GROUP_A.to);
  const overlaysBefore = await serverOverlays(page, PHOTO_ID);
  const pixelBefore = await sampleCanvasPixel(page, GROUP_A.center);
  await clearHealCalls(page);

  // Change everything that applies to "groups healing right now".
  await page.getByTestId("heal-quality-best").click();
  await page.getByTestId("seamless-light-row").getByRole("switch").click();
  await setRangeByTestId(page, "blend-feather", 8);
  await expectNoReheal(page);
  await clearHealCalls(page);

  await healStroke(page, GROUP_B.from, GROUP_B.to);

  // Only the new group ran inference, with the current settings attached.
  const calls = await getHealCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe("heal");
  expect(calls[0]?.quality).toBe("best");
  expect(calls[0]?.seamlessLight).toBe(true);
  expect(calls[0]?.featherPx).toBe(8);

  // The old overlay is byte-identical; the new one is saved alongside it —
  // one photo mixing two provenances, neither re-healed for the other.
  const overlaysAfter = await serverOverlays(page, PHOTO_ID);
  expect(overlaysAfter).toHaveLength(2);
  expect(overlaysAfter.find((entry) => entry.groupId === overlaysBefore[0]?.groupId)).toEqual(
    overlaysBefore[0],
  );
  expect(await retouchGroupCount(page)).toBe(2);
  expect(await sampleCanvasPixel(page, GROUP_A.center)).toEqual(pixelBefore);
});

test("deleting a stroke drops its overlay; survivors never reheal", async ({ page }) => {
  await healStroke(page, GROUP_A.from, GROUP_A.to);
  await healStroke(page, GROUP_B.from, GROUP_B.to);
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(2);
  await clearHealCalls(page);

  // Delete Repair 1 via the inspector list (labels are per-kind counters).
  await page.getByRole("button", { name: "Delete Repair 1" }).click();
  await expect(page.getByTestId("retouch-status")).toContainText("1 group");
  await expectNoReheal(page);

  // Best-effort orphan delete reached the server; the survivor's overlay is intact.
  await expect
    .poll(async () => (await serverOverlays(page, PHOTO_ID)).length, { timeout: 10_000 })
    .toBe(1);
  expect(await retouchGroupCount(page)).toBe(1);
});
