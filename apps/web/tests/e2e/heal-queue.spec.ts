// apps/web/tests/e2e/heal-queue.spec.ts
//
// Locks the serial heal job queue (core/heal-queue.ts, PhotoCanvas prepare):
// one group at a time, FIFO, never parallel; aggregate progress
// ("Healing i of N…") with a single terminal "Healing done"; repeat strokes
// schedule follow-up jobs planned at start time against the latest cache.
//
// The neural backend is mocked with a fixed delay so job boundaries are
// deterministic: without latency, rapid strokes would coalesce into one job
// before the first group starts (also covered below). Classic-heal wiring of
// the same queue is covered by heal-cache-immutability.spec.ts.
import { expect, test } from "@playwright/test";
import { mockMlHeal } from "./heal-mocks";
import {
  PHOTO_ID,
  clearHealCalls,
  getHealCalls,
  getOverlayGroupIds,
  gotoEditor,
  healStroke,
  paintStroke,
  resetPhoto,
  retouchGroupCount,
  selectRepairMethod,
  stubLibraryImages,
  waitForHealingDone,
  waitForHealingStart,
  waitForMlReady,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubLibraryImages(page);
  await mockMlHeal(page, { delayMs: 2000 });
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  await selectRepairMethod(page, "ml-heal");
  // Auto-warmup runs on entering ML Heal; painting is gated until ready.
  await waitForMlReady(page);
  await clearHealCalls(page);
});

test("one group heals with a single terminal done", async ({ page }) => {
  await healStroke(page, { x: 0.2, y: 0.3 }, { x: 0.26, y: 0.36 });

  const calls = await getHealCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe("ml-heal");
  expect(calls[0]?.aggregate).toEqual({ index: 0, total: 1 });

  // Terminal progress resolves and auto-dismisses; the group persists.
  await expect(page.getByTestId("ml-progress")).toBeHidden({ timeout: 15_000 });
  expect(await retouchGroupCount(page)).toBe(1);
  expect(await getOverlayGroupIds(page)).toHaveLength(1);
});

test("group 1 finishes before a batch of follow-up heals starts", async ({ page }) => {
  // Group 1: a lone job. Wait until its first transport call is dispatched —
  // only then is job 1 really running, so follow-up strokes form a second,
  // deferred job instead of coalescing (pending flags alone are not enough:
  // the queue debounces ~600ms after the last edit).
  await paintStroke(page, { x: 0.15, y: 0.3 }, { x: 0.2, y: 0.35 });
  await expect
    .poll(async () => (await getHealCalls(page)).length, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(1);

  // Batch of three while group 1 is still healing (2s mocked latency).
  await paintStroke(page, { x: 0.5, y: 0.3 }, { x: 0.55, y: 0.35 });
  await paintStroke(page, { x: 0.7, y: 0.6 }, { x: 0.75, y: 0.65 });
  await paintStroke(page, { x: 0.35, y: 0.7 }, { x: 0.4, y: 0.75 });

  // Aggregate copy names the follow-up job while it runs.
  await expect(page.getByTestId("ml-progress-stage")).toContainText("of 3", {
    timeout: 30_000,
  });
  await waitForHealingDone(page);

  const calls = await getHealCalls(page);
  expect(calls).toHaveLength(4);
  // Job 1 covered only group 1; the deferred job partitioned the other three
  // against the latest cache (already-finished groups never reheal).
  expect(calls[0]?.aggregate).toEqual({ index: 0, total: 1 });
  expect(calls.slice(1).map((call) => call.aggregate)).toEqual([
    { index: 0, total: 3 },
    { index: 1, total: 3 },
    { index: 2, total: 3 },
  ]);
  // Strictly serial: each call started only after the previous finished.
  for (let i = 1; i < calls.length; i += 1) {
    expect((calls[i]?.at ?? 0) - (calls[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(1500);
  }
  expect(await retouchGroupCount(page)).toBe(4);
  expect(await getOverlayGroupIds(page)).toHaveLength(4);
});

test("rapid strokes coalesce into one serial job, never parallel", async ({ page }) => {
  await paintStroke(page, { x: 0.2, y: 0.3 }, { x: 0.25, y: 0.35 });
  await paintStroke(page, { x: 0.5, y: 0.35 }, { x: 0.55, y: 0.4 });
  await paintStroke(page, { x: 0.65, y: 0.65 }, { x: 0.7, y: 0.7 });
  await waitForHealingStart(page);
  await waitForHealingDone(page);

  const calls = await getHealCalls(page);
  expect(calls).toHaveLength(3);
  // One job of three: every call carries the same aggregate total.
  expect(calls.map((call) => call.aggregate?.total)).toEqual([3, 3, 3]);
  expect(calls.map((call) => call.aggregate?.index)).toEqual([0, 1, 2]);
  for (let i = 1; i < calls.length; i += 1) {
    expect((calls[i]?.at ?? 0) - (calls[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(1500);
  }
});
