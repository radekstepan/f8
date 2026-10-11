// apps/web/tests/e2e/heal-persistence-cache.spec.ts
//
// Locks the three caches around healing:
//   - image bytes: loadImage (core/image.ts) memoizes per src — revisiting a
//     photo in-session issues zero new file requests
//   - persisted overlays: every finished group is PUT right after it heals;
//     reopening seeds the in-memory cache from GET, so zero inference runs
//   - preview renders: the final composite is stashed in IndexedDB under a
//     content key for instant reloads (core/preview-render-cache.ts)
//
// Real classic worker; assertions via request counters, the test hook, and
// IndexedDB reads — never timing-based.
import { expect, test } from "@playwright/test";
import {
  PHOTO_ID,
  awaitEditor,
  getHealCalls,
  getOverlayGroupIds,
  gotoEditor,
  healStroke,
  resetPhoto,
  selectRepairMethod,
  serverOverlays,
  stubLibraryImages,
  waitForHealingDone,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await resetPhoto(page, PHOTO_ID);
  await gotoEditor(page);
  await selectRepairMethod(page, "heal");
});

test("reopening reuses persisted overlays with zero new inference", async ({ page }) => {
  await healStroke(page, { x: 0.2, y: 0.3 }, { x: 0.26, y: 0.36 });
  expect(await serverOverlays(page, PHOTO_ID)).toHaveLength(1);

  await page.reload();
  await gotoEditor(page);
  await page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name: "Repair", exact: true }).click();

  // First paint waits for saved work: the group is already listed, seeded
  // from the server, and no transport call ever ran in this session.
  await expect(page.getByTestId("retouch-status")).toContainText("1 group", {
    timeout: 15_000,
  });
  await waitForHealingDone(page);
  expect(await getHealCalls(page)).toHaveLength(0);
  expect(await getOverlayGroupIds(page)).toHaveLength(1);
});

test("revisiting a photo in-session does not refetch its image", async ({ page }) => {
  const library = await (await page.request.get("/api/library")).json() as {
    photos: { id: string; src: string; title: string; albumId: string }[];
  };
  // The editor opens on the Dolomites collection; navigate within it so both
  // photos are in the filmstrip.
  const siblings = library.photos.filter((entry) => entry.albumId === "dolomites");
  const first = siblings.find((entry) => entry.id === PHOTO_ID);
  const other = siblings.find((entry) => entry.id !== PHOTO_ID);
  if (!first?.src || !other) throw new Error("need two seed photos for navigation");

  let hits = 0;
  // Count real image bytes for photo-1 (the stub fulfills; the counter is
  // what matters — loadImage must call through only once per src).
  await page.unroute(first.src);
  await page.route(first.src, (route) => {
    hits += 1;
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400'><rect width='640' height='400' fill='#88aacc'/></svg>",
    });
  });
  // A fresh navigation picks up the counting route (it was installed after
  // the beforeEach load). Exactly one navigation: every new document starts
  // with an empty in-memory image cache, so a second load would refetch
  // legitimately and pollute the count.
  await page.goto("/");
  await awaitEditor(page);
  expect(hits).toBe(1);

  // Open another photo, then come back: the memoized <img> serves photo-1.
  await page.getByRole("button", { name: `Open ${other.title}` }).click();
  await expect(page.getByTestId("photo-frame")).toBeVisible();
  await page.getByRole("button", { name: `Open ${first.title}` }).click();
  await expect(page.getByTestId("photo-frame")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(hits).toBe(1);
});

test("final composite is stashed in the preview render cache", async ({ page }) => {
  // Two strokes: the first boots the vision worker mid-job (its status flip
  // starts a newer pipeline generation, which by design owns the preview
  // write — the superseded job skips it), the second heals on a warm worker
  // so its onGroupDone persists the on-screen pixels.
  await healStroke(page, { x: 0.3, y: 0.4 }, { x: 0.36, y: 0.46 });
  await healStroke(page, { x: 0.55, y: 0.55 }, { x: 0.6, y: 0.6 });

  // onGroupDone persists the on-screen pixels once every group is healed.
  // The open below replicates the app's own openDb (with onupgradeneeded
  // creating the store): a bare indexedDB.open would create an empty v1 DB
  // and pin the version, so the app's later open would never create its
  // store and every save would silently no-op. Only the blob size crosses
  // the evaluate boundary (Blobs don't need to).
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase | null>((resolve) => {
            try {
              const req = indexedDB.open("photomator-preview-cache", 1);
              req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains("previews")) {
                  req.result.createObjectStore("previews", { keyPath: "photoId" });
                }
              };
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => resolve(null);
            } catch {
              resolve(null);
            }
          });
          if (!db) return 0;
          try {
            if (!db.objectStoreNames.contains("previews")) return 0;
            const size = await new Promise<number>((resolve) => {
              try {
                const tx = db.transaction("previews", "readonly");
                const rq = tx.objectStore("previews").get("photo-1");
                rq.onsuccess = () => {
                  const record = rq.result as { blob?: Blob } | undefined;
                  resolve(record?.blob?.size ?? 0);
                };
                rq.onerror = () => resolve(0);
              } catch {
                resolve(0);
              }
            });
            return size;
          } finally {
            db.close();
          }
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
});

test("export dialog opens over a mixed-method healed photo", async ({ page }) => {
  await healStroke(page, { x: 0.2, y: 0.3 }, { x: 0.26, y: 0.36 });
  // The export pipeline (geometryForExport) reuses saved overlays instead of
  // rehealing; the dialog itself proves the photo is exportable mid-state.
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog")).toContainText("Export Photo");
  await expect(page.getByRole("button", { name: "Close dialog" })).toBeVisible();
});
