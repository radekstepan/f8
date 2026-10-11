import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { createTestContext, makeBmp } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";
import type { ImportReport } from "@photomator/core";

function patchBody(signature: string, width = 2, height = 2) {
  const raw = Buffer.alloc(width * height * 4, 7);
  return {
    signature,
    x0: 0,
    y0: 0,
    width,
    height,
    canvasWidth: 32,
    canvasHeight: 32,
    method: "ml-heal",
    quality: "balanced",
    featherPx: 2,
    geometryKey: "g",
    dataB64: raw.toString("base64"),
  };
}

describe("heal overlays", () => {
  let ctx: TestContext;
  let photoId: string;

  beforeEach(async () => {
    ctx = createTestContext();
    const report = (await (await ctx.app.request("/api/imports/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Filename": "a.bmp" },
      body: makeBmp(9, 6),
    })).json()) as { photo: { id: string } };
    photoId = report.photo.id;
    void ({} as ImportReport);
  });

  afterEach(() => ctx.close());

  it("saves, lists, and deletes per-group overlays", async () => {
    const put = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/3`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody("sig-3")),
    });
    expect(put.status).toBe(200);

    const listed = (await (await ctx.app.request(`/api/photos/${photoId}/heal-overlays`)).json()) as {
      patches: { groupId: number; signature: string }[];
    };
    expect(listed.patches.map((p) => p.groupId)).toEqual([3]);
    expect(listed.patches[0]?.signature).toBe("sig-3");

    const del = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/3`, { method: "DELETE" });
    expect(((await del.json()) as { deleted: boolean }).deleted).toBe(true);
    const relisted = (await (await ctx.app.request(`/api/photos/${photoId}/heal-overlays`)).json()) as {
      patches: unknown[];
    };
    expect(relisted.patches).toEqual([]);
  });

  it("rejects mismatched patch data", async () => {
    const bad = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patchBody("x"), width: 4 }),
    });
    expect(bad.status).toBe(400);
  });

  it("404s unknown photos and purges overlays with the photo", async () => {
    const missing = await ctx.app.request("/api/photos/nope/heal-overlays");
    expect(missing.status).toBe(404);
    await ctx.app.request(`/api/photos/${photoId}/heal-overlays/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody("sig-1")),
    });
    await ctx.app.request(`/api/photos/${photoId}`, { method: "DELETE" });
    // Photo is gone now; overlay listing 404s rather than leaking.
    expect((await ctx.app.request(`/api/photos/${photoId}/heal-overlays`)).status).toBe(404);
  });
});
