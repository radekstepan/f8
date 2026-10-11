import { describe, expect, it } from "vitest";
import { getMlHealHealth, runRemoteHeal, validateRemoteBody } from "./ml-heal.ts";
import { createTestContext } from "./fixtures.ts";

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("validateRemoteBody", () => {
  it("accepts a well-formed ROI request", () => {
    const size = 24;
    const parsed = validateRemoteBody({
      roi: { x0: 4, y0: 8, size },
      srcWidth: 100,
      srcHeight: 80,
      imageB64: b64(new Uint8Array(size * size * 4)),
      maskB64: b64(new Uint8Array(size * size)),
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects oversized and malformed rois", () => {
    expect(validateRemoteBody({}).ok).toBe(false);
    expect(
      validateRemoteBody({
        roi: { x0: 0, y0: 0, size: 4096 },
        srcWidth: 100,
        srcHeight: 100,
        imageB64: "eA==",
        maskB64: "eA==",
      }).ok,
    ).toBe(false);
  });

  it("accepts both engines and rejects unknown ones", () => {
    const size = 24;
    const base = {
      roi: { x0: 0, y0: 0, size },
      srcWidth: size,
      srcHeight: size,
      imageB64: b64(new Uint8Array(size * size * 4)),
      maskB64: b64(new Uint8Array(size * size)),
    };
    expect(validateRemoteBody({ ...base, engine: "lama" }).ok).toBe(true);
    expect(validateRemoteBody({ ...base, engine: "moebius" }).ok).toBe(true);
    expect(validateRemoteBody({ ...base }).ok).toBe(true);
    expect(validateRemoteBody({ ...base, engine: "lama-fake" }).ok).toBe(false);
  });
});

describe("remote heal", () => {
  it("reports per-tier health without weights", async () => {
    const ctx = createTestContext();
    try {
      const health = await getMlHealHealth(ctx.dir);
      expect(health.ready).toBe(true);
      expect(health.ortAvailable).toBe(true);
      expect(health.moebiusReady).toBe(false);
      expect(health.lamaReady).toBe(false);
      expect(health.lamaCached).toBe(false);
      expect(health.engines.moebius.serving).toBe(false);
      expect(health.engines.lama.serving).toBe(false);
    } finally {
      ctx.close();
    }
  });

  it("answers 503 for lama when weights cannot download", async () => {
    const ctx = createTestContext();
    const prev = process.env["PHOTOMATOR_ML_HEAL_LAMA_URL"];
    process.env["PHOTOMATOR_ML_HEAL_LAMA_URL"] = "http://127.0.0.1:9/lama_fp32.onnx";
    try {
      const size = 24;
      const response = await ctx.app.request("/api/ml-heal/inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: "lama",
          roi: { x0: 0, y0: 0, size },
          srcWidth: size,
          srcHeight: size,
          imageB64: b64(new Uint8Array(size * size * 4)),
          maskB64: b64(new Uint8Array(size * size)),
        }),
      });
      expect(response.status).toBe(503);
    } finally {
      if (prev === undefined) delete process.env["PHOTOMATOR_ML_HEAL_LAMA_URL"];
      else process.env["PHOTOMATOR_ML_HEAL_LAMA_URL"] = prev;
      ctx.close();
    }
  });

  it("rejects moebius without downloadable weights instead of silent fallback", async () => {
    const ctx = createTestContext();
    const prev = process.env["PHOTOMATOR_ML_HEAL_OFFLINE"];
    process.env["PHOTOMATOR_ML_HEAL_OFFLINE"] = "1";
    try {
      const size = 24;
      const image = new Uint8Array(size * size * 4);
      image.fill(200);
      const mask = new Uint8Array(size * size);
      mask[12 * size + 12] = 255;
      await expect(
        runRemoteHeal(ctx.dir, {
          engine: "moebius",
          roi: { x0: 0, y0: 0, size },
          srcWidth: size,
          srcHeight: size,
          imageB64: b64(image),
          maskB64: b64(mask),
        }),
      ).rejects.toThrow(/OFFLINE/);
    } finally {
      if (prev === undefined) delete process.env["PHOTOMATOR_ML_HEAL_OFFLINE"];
      else process.env["PHOTOMATOR_ML_HEAL_OFFLINE"] = prev;
      ctx.close();
    }
  });

  it("serves health and inpaint over HTTP", async () => {
    const ctx = createTestContext();
    try {
      const health = await ctx.app.request("/api/ml-heal/health");
      expect(health.status).toBe(200);
      expect(((await health.json()) as { ready: boolean }).ready).toBe(true);

      const size = 24;
      const image = new Uint8Array(size * size * 4);
      image.fill(200);
      const mask = new Uint8Array(size * size);
      mask[12 * size + 12] = 255;
      const prevOffline = process.env["PHOTOMATOR_ML_HEAL_OFFLINE"];
      process.env["PHOTOMATOR_ML_HEAL_OFFLINE"] = "1";
      try {
        const response = await ctx.app.request("/api/ml-heal/inpaint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roi: { x0: 0, y0: 0, size },
            srcWidth: size,
            srcHeight: size,
            imageB64: b64(image),
            maskB64: b64(mask),
          }),
        });
        // No weights + provisioning disabled → honest 503, never a quiet
        // exemplar fill pretending to be Best.
        expect(response.status).toBe(503);
        expect(((await response.json()) as { error: string }).error).toMatch(/failed/i);
      } finally {
        if (prevOffline === undefined) delete process.env["PHOTOMATOR_ML_HEAL_OFFLINE"];
        else process.env["PHOTOMATOR_ML_HEAL_OFFLINE"] = prevOffline;
      }

      const bad = await ctx.app.request("/api/ml-heal/inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roi: { x0: 0, y0: 0, size: 99999 } }),
      });
      expect(bad.status).toBe(400);

      const warmupBad = await ctx.app.request("/api/ml-heal/warmup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: "sd-turbo" }),
      });
      expect(warmupBad.status).toBe(400);

      // Offline: the kick fails in the background without touching the
      // network, but the route still answers immediately.
      const prevOfflineWarm = process.env["PHOTOMATOR_ML_HEAL_OFFLINE"];
      process.env["PHOTOMATOR_ML_HEAL_OFFLINE"] = "1";
      try {
        const warmup = await ctx.app.request("/api/ml-heal/warmup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine: "moebius" }),
        });
        expect(warmup.status).toBe(200);
        const snapshot = (await warmup.json()) as { engines: { moebius: { serving: boolean } } };
        expect(snapshot.engines.moebius.serving).toBe(false);
      } finally {
        if (prevOfflineWarm === undefined) delete process.env["PHOTOMATOR_ML_HEAL_OFFLINE"];
        else process.env["PHOTOMATOR_ML_HEAL_OFFLINE"] = prevOfflineWarm;
      }
    } finally {
      ctx.close();
    }
  });
});
