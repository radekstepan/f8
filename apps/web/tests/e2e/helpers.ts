// apps/web/tests/e2e/helpers.ts
//
// Shared heal e2e helpers: deterministic image stubbing, stroke painting,
// heal-completion waits, per-photo resets, and the read-only
// `window.__photomatorTest` hook (queue depth, cached groups, ML readiness,
// transport calls) published by PhotoCanvas (no behavior change, specs read
// only).

import { expect, type Page } from "@playwright/test";
import { DEFAULT_EDIT, type EditState } from "@photomator/core";

export const PHOTO_ID = "photo-1";

/** Transport call recorded by useInpaintRepair (see core/test-hooks.ts). */
export interface TestHealCall {
  method: string;
  quality: string | undefined;
  seamlessLight: boolean | undefined;
  featherPx: number | undefined;
  areas: number | null;
  aggregate: { index: number; total: number } | undefined;
  at: number;
}

/** One main-canvas paint recorded by PhotoCanvas (source path + content key). */
export interface PaintLogEntry {
  source: string;
  key: string;
  at: number;
}

interface TestHookValues {
  healCalls: () => TestHealCall[];
  clearHealCalls: () => void;
  queue: () => { active: boolean; pendingJobs: number };
  cacheKeys: () => number[];
  pendingRepairIds: () => number[];
  overlayGroupIds: () => number[];
  mlReady: () => { method: string | null; engine: string | null; ready: boolean | null; warming: boolean };
  paintLog: () => PaintLogEntry[];
  clearPaintLog: () => void;
}

export interface MlReadiness {
  method: string | null;
  engine: string | null;
  ready: boolean | null;
  warming: boolean;
}

declare global {
  interface Window {
    __photomatorTest: TestHookValues;
  }
}

async function hook<T>(page: Page, expr: string): Promise<T> {
  return page.evaluate(`window.__photomatorTest.${expr}`) as Promise<T>;
}

export const getHealCalls = (page: Page) => hook<TestHealCall[]>(page, "healCalls()");
export const clearHealCalls = (page: Page) => hook<void>(page, "clearHealCalls()");
export const getMlReady = (page: Page) => hook<MlReadiness>(page, "mlReady()");

/**
 * Wait until the ML tier finishes warming and painting unlocks. Auto-warmup
 * runs on entering ML Repair; strokes painted earlier are ignored, so ML
 * specs must await this before the first stroke.
 */
export async function waitForMlReady(page: Page, timeout = 30_000): Promise<void> {
  await expect
    .poll(async () => (await getMlReady(page)).ready, { timeout, intervals: [250, 500] })
    .toBe(true);
}
export const getQueue = (page: Page) => hook<{ active: boolean; pendingJobs: number }>(page, "queue()");
export const getCacheKeys = (page: Page) => hook<number[]>(page, "cacheKeys()");
export const getPendingIds = (page: Page) => hook<number[]>(page, "pendingRepairIds()");
export const getOverlayGroupIds = (page: Page) => hook<number[]>(page, "overlayGroupIds()");
export const getPaintLog = (page: Page) => hook<PaintLogEntry[]>(page, "paintLog()");
export const clearPaintLog = (page: Page) => hook<void>(page, "clearPaintLog()");

// Deterministic photo pixels: the seed library points at remote Pexels URLs
// (network + CORS-tainted canvas would break heal readbacks), so every spec
// routes all seed src/thumbnail URLs to this local textured SVG before
// navigation. Gradients + hard shapes give heal donors real structure.
export const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#7fb2d9"/><stop offset="1" stop-color="#dfe9f3"/>
</linearGradient></defs>
<rect width="640" height="400" fill="url(#sky)"/>
<rect x="0" y="280" width="640" height="120" fill="#5d8a5f"/>
<rect x="60" y="120" width="140" height="160" fill="#8a6f4d"/>
<rect x="440" y="90" width="120" height="190" fill="#6d5a44"/>
<circle cx="520" cy="70" r="34" fill="#f5e6b8"/>
<circle cx="150" cy="320" r="46" fill="#3f6b41"/>
<circle cx="330" cy="200" r="26" fill="#a8433c"/>
<rect x="250" y="240" width="90" height="60" fill="#c9c2b4"/>
</svg>`;

/** Route all seed-library images to TEST_SVG; returns the first photo. */
export async function stubLibraryImages(page: Page): Promise<{ id: string; src: string }> {
  const res = await page.request.get("/api/library");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    photos: { id: string; src: string; thumbnail: string }[];
  };
  const urls = new Set<string>();
  for (const photo of body.photos) {
    urls.add(photo.src);
    urls.add(photo.thumbnail);
  }
  for (const url of urls) {
    await page.route(url, (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        headers: { "access-control-allow-origin": "*" },
        body: TEST_SVG,
      }),
    );
  }
  const first = body.photos[0];
  if (!first) throw new Error("Seed library has no photos.");
  return { id: first.id, src: first.src };
}

/** Open the editor on a clean, deterministic state. */
export async function gotoEditor(page: Page): Promise<void> {
  await page.goto("/");
  await awaitEditor(page);
}

/** Wait for the editor to settle without navigating (single-document flows). */
export async function awaitEditor(page: Page): Promise<void> {
  // Library gate clears once /api/library resolves (App.tsx).
  await expect(page.getByRole("toolbar", { name: "Editing tools" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("photo-frame")).toBeVisible();
  // Published by PhotoCanvas; every heal assertion reads through it.
  await expect
    .poll(() => page.evaluate(() => typeof window.__photomatorTest), { timeout: 10_000 })
    .toBe("object");
}

/**
 * Reset one photo to a pristine heal state via the API: neutral adjustments
 * (tint/pixel assertions need an ungraded pipeline) plus zero retouches, and
 * every heal overlay deleted. IndexedDB preview cache needs no reset —
 * keys are content-addressed, so a reset edit simply addresses a fresh key.
 */
export async function resetPhoto(page: Page, photoId: string): Promise<void> {
  const list = await page.request.get(`/api/photos/${photoId}/heal-overlays`);
  expect(list.ok()).toBeTruthy();
  const { patches } = (await list.json()) as { patches: { groupId: number }[] };
  for (const patch of patches) {
    await page.request.delete(`/api/photos/${photoId}/heal-overlays/${patch.groupId}`);
  }
  const put = await page.request.put(`/api/photos/${photoId}/edit`, {
    data: { present: { ...DEFAULT_EDIT, retouches: [] } },
  });
  expect(put.ok()).toBeTruthy();
  await clearHealCalls(page).catch(() => undefined);
}

/** Select the Repair tool and a reconstruction method. */
export async function selectRepairMethod(
  page: Page,
  method: "ml-heal" | "heal" | "telea" | "ns",
): Promise<void> {
  await page
    .getByRole("toolbar", { name: "Editing tools" })
    .getByRole("button", { name: "Repair", exact: true })
    .click();
  await page.getByTestId(`repair-method-${method}`).click();
}

/** Paint one drag stroke across the photo frame, in fractional coordinates. */
export async function paintStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
): Promise<void> {
  const frame = page.getByTestId("photo-frame");
  const box = await frame.boundingBox();
  if (!box) throw new Error("photo-frame has no bounding box.");
  const point = (f: { x: number; y: number }) => ({
    x: box.x + f.x * box.width,
    y: box.y + f.y * box.height,
  });
  const a = point(from);
  const b = point(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  }
  await page.mouse.up();
}

/**
 * Wait until healing starts: a pending group, an active queue, or a recorded
 * transport call. Required before waitForHealingDone — the queue debounces
 * ~600ms, so an immediate "settled" poll would pass before work begins.
 */
export async function waitForHealingStart(page: Page, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const [pending, queue, calls] = await Promise.all([
          getPendingIds(page),
          getQueue(page),
          getHealCalls(page),
        ]);
        return pending.length > 0 || queue.active || queue.pendingJobs > 0 || calls.length > 0
          ? "started"
          : "idle";
      },
      { timeout, intervals: [200, 400] },
    )
    .toBe("started");
}

/** Paint one stroke and wait until its heal fully settles. */
export async function healStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await paintStroke(page, from, to);
  await waitForHealingStart(page);
  await waitForHealingDone(page);
}

/**
 * Wait until every heal settles: no pending repair groups and an idle queue.
 * The queue debounces 300ms + 300ms before starting (PhotoCanvas), and the
 * first classic heal also boots the vision worker (OpenCV parse), so the
 * timeout is generous; steady state settles in ~1s.
 */
export async function waitForHealingDone(page: Page, timeout = 90_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const [pending, queue] = await Promise.all([getPendingIds(page), getQueue(page)]);
        return pending.length === 0 && !queue.active && queue.pendingJobs === 0 ? "done" : "working";
      },
      { timeout, intervals: [250, 500, 1000] },
    )
    .toBe("done");
}

/** Retouch group count from the inspector list. */
export async function retouchGroupCount(page: Page): Promise<number> {
  const list = page.getByTestId("retouch-group-list");
  if (!(await list.isVisible().catch(() => false))) return 0;
  return list.locator("li").count();
}

/** Sample one canvas pixel at fractional coordinates. */
export async function sampleCanvasPixel(
  page: Page,
  at: { x: number; y: number },
): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(({ fx, fy }) => {
    const canvas = document.querySelector(
      '[data-testid="edited-canvas"]',
    ) as HTMLCanvasElement | null;
    if (!canvas) throw new Error("edited-canvas missing.");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context.");
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(fx * canvas.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(fy * canvas.height)));
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
  }, { fx: at.x, fy: at.y });
}

/** Persisted heal overlays for one photo, straight from the server. */
export async function serverOverlays(
  page: Page,
  photoId: string,
): Promise<{ groupId: number; signature: string }[]> {
  const res = await page.request.get(`/api/photos/${photoId}/heal-overlays`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { patches: { groupId: number; signature: string }[] };
  return body.patches;
}

/** Set a RangeControl numeric field (brush size, feather) by its testid. */
export async function setRangeByTestId(page: Page, testId: string, value: number): Promise<void> {
  const input = page.getByTestId(testId).locator('input[type="number"]');
  await input.fill(String(value));
  await input.press("Enter");
}

/** Full edit recipe for one photo, straight from the server library. */
export async function serverEdit(page: Page, photoId: string): Promise<EditState> {
  const res = await page.request.get("/api/library");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { photos: { id: string; edit: EditState }[] };
  const photo = body.photos.find((item) => item.id === photoId);
  if (!photo) throw new Error(`photo ${photoId} missing from library.`);
  return photo.edit;
}

/** Set an Adjust-panel RangeControl (no testid) by its accessible value label. */
export async function adjustSlider(page: Page, label: string, value: number): Promise<void> {
  const input = page.getByLabel(`${label} value`);
  await input.fill(String(value));
  await input.press("Enter");
}

/** Toolbar undo/redo buttons in the Topbar .history-buttons group. */
export function historyButton(page: Page, name: "Undo" | "Redo") {
  return page.locator(".history-buttons").getByRole("button", { name: new RegExp(name) });
}

/** Reset All Adjustments via the Edit menu (the only reset entry point). */
export async function resetViaMenu(page: Page): Promise<void> {
  await page.locator(".menu-bar").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reset All Adjustments" }).click();
}
