import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { createTestContext, makeBmp } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";
import type { ImportReport } from "@f8/core";

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

  it("accepts short hashed signatures but still rejects oversized ones", async () => {
    const hashed = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/9`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody("id:9|g:photo|4/3|0|0|0|0|100x80|h:0123456789abcdef")),
    });
    expect(hashed.status).toBe(200);
    const oversized = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/10`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody("s".repeat(4097))),
    });
    expect(oversized.status).toBe(400);
    expect(((await oversized.json()) as { error: string }).error).toBe("Invalid signature.");
  });

  it("round-trips the resample budget and rejects invalid values", async () => {
    const put = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patchBody("sig-1"), resampleDeg: 12.5 }),
    });
    expect(put.status).toBe(200);
    const listed = (await (await ctx.app.request(`/api/photos/${photoId}/heal-overlays`)).json()) as {
      patches: { groupId: number; resampleDeg?: number }[];
    };
    expect(listed.patches[0]?.resampleDeg).toBe(12.5);
    for (const bad of [-1, Number.NaN, "12" as unknown as number]) {
      const res = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patchBody("sig-2"), resampleDeg: bad }),
      });
      expect(res.status).toBe(400);
    }
    // Pre-budget clients omit the field: still accepted.
    const legacy = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/3`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody("sig-3")),
    });
    expect(legacy.status).toBe(200);
  });

  it("accepts overhanging patches that a turn swung off-canvas", async () => {
    // Negative origins and edges past the canvas dims carry off-canvas
    // pixels for the reverse turn; even fully-outside patches persist.
    for (const [groupId, x0, y0] of [[1, -3, 2], [2, 31, 31], [3, 40, 40]] as const) {
      const put = await ctx.app.request(`/api/photos/${photoId}/heal-overlays/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patchBody(`sig-${groupId}`), x0, y0 }),
      });
      expect(put.status).toBe(200);
    }
    const listed = (await (await ctx.app.request(`/api/photos/${photoId}/heal-overlays`)).json()) as {
      patches: { groupId: number; x0: number; y0: number }[];
    };
    expect(listed.patches.map((p) => [p.groupId, p.x0, p.y0])).toEqual([[1, -3, 2], [2, 31, 31], [3, 40, 40]]);
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
