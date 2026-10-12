import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDustSpotsHealth, runDustSpotsDetect, validateDustSpotsBody } from "./dust-spots.ts";
import { createTestContext } from "./fixtures.ts";

function rgbaB64(width: number, height: number, paint?: (data: Uint8Array, width: number, height: number) => void): string {
  const bytes = new Uint8Array(width * height * 4);
  // Sky-bright background: dust shows as dark blobs.
  for (let i = 0; i < width * height; i += 1) {
    bytes[i * 4] = 150;
    bytes[i * 4 + 1] = 190;
    bytes[i * 4 + 2] = 230;
    bytes[i * 4 + 3] = 255;
  }
  paint?.(bytes, width, height);
  return Buffer.from(bytes).toString("base64");
}

/** Dark dust disc for the classical proposer. */
function withDust(bytes: Uint8Array, width: number, cx: number, cy: number, radius: number): void {
  for (let y = 0; y < 120; y += 1) {
    for (let x = 0; x < 160; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * width + x) * 4;
        bytes[i] = 60;
        bytes[i + 1] = 70;
        bytes[i + 2] = 80;
      }
    }
  }
}

afterEach(() => {
  delete process.env["F8_DUST_SPOTS_OFFLINE"];
  delete process.env["F8_DUST_SPOTS_WEIGHTS"];
});

describe("validateDustSpotsBody", () => {
  it("accepts a well-formed detect request", () => {
    expect(validateDustSpotsBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6) }).ok).toBe(true);
  });

  it("rejects malformed bodies", () => {
    expect(validateDustSpotsBody({}).ok).toBe(false);
    expect(validateDustSpotsBody({ width: 0, height: 6, imageB64: "eA==" }).ok).toBe(false);
    expect(validateDustSpotsBody({ width: 8, height: 6, imageB64: "eA==" }).ok).toBe(false);
  });
});

describe("dust-spots detect (ML by default, classical fallback)", () => {
  it("serves health with the embedded ML classifier", async () => {
    const ctx = createTestContext();
    try {
      const health = await getDustSpotsHealth(ctx.dir);
      expect(health.ready).toBe(true);
      expect(health.serving).toBe(true);
      expect(health.mlEnabled).toBe(true);
      expect(health.source).toBe("ml");
      expect(health.classifier.model).toBe("dust-logreg");
      expect(health.classifier.weights).toBe("embedded");
      expect(health.error).toBeNull();
      const viaHttp = await ctx.app.request("/api/dust-spots/health");
      expect(viaHttp.status).toBe(200);
      const warmup = await ctx.app.request("/api/dust-spots/warmup", { method: "POST" });
      expect(warmup.status).toBe(200);
    } finally {
      ctx.close();
    }
  });

  it("finds a dust spot with an ML score, direct and over HTTP", async () => {
    const ctx = createTestContext();
    try {
      const imageB64 = rgbaB64(160, 120, (bytes, width) => withDust(bytes, width, 40, 30, 4));
      const direct = await runDustSpotsDetect(ctx.dir, { width: 160, height: 120, imageB64 });
      expect(direct.source).toBe("ml");
      expect(direct.spots).toHaveLength(1);
      expect(direct.spots[0]?.polarity).toBe("dark");
      expect(direct.spots[0]?.score).toBeGreaterThan(0.5);
      expect(direct.spots[0]?.x).toBeCloseTo(40 / 160, 1);
      const response = await ctx.app.request("/api/dust-spots/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 160, height: 120, imageB64 }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { source: string; spots: Array<{ score: number }> };
      expect(payload.source).toBe("ml");
      expect(payload.spots).toHaveLength(1);
      expect(payload.spots[0]?.score).toBeGreaterThan(0.5);
    } finally {
      ctx.close();
    }
  });

  it("reports nothing on a clean photo", async () => {
    const ctx = createTestContext();
    try {
      const direct = await runDustSpotsDetect(ctx.dir, { width: 64, height: 64, imageB64: rgbaB64(64, 64) });
      expect(direct.source).toBe("ml");
      expect(direct.spots).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it("serves classical-only candidates when offline", async () => {
    const ctx = createTestContext();
    try {
      const imageB64 = rgbaB64(160, 120, (bytes, width) => withDust(bytes, width, 40, 30, 4));
      const env = { F8_DUST_SPOTS_OFFLINE: "1" };
      const health = await getDustSpotsHealth(ctx.dir, env);
      expect(health.mlEnabled).toBe(false);
      expect(health.source).toBe("classic");
      const direct = await runDustSpotsDetect(ctx.dir, { width: 160, height: 120, imageB64 }, env);
      expect(direct.source).toBe("classic");
      expect(direct.spots).toHaveLength(1);
      expect(direct.spots[0]?.score).toBe(0.5);
    } finally {
      ctx.close();
    }
  });

  it("degrades to classical-only when custom weights are unreadable", async () => {
    const ctx = createTestContext();
    try {
      const imageB64 = rgbaB64(160, 120, (bytes, width) => withDust(bytes, width, 40, 30, 4));
      const env = { F8_DUST_SPOTS_WEIGHTS: path.join(ctx.dir, "missing-weights.json") };
      const health = await getDustSpotsHealth(ctx.dir, env);
      expect(health.mlEnabled).toBe(false);
      expect(health.source).toBe("classic");
      expect(health.error).toContain("ENOENT");
      const direct = await runDustSpotsDetect(ctx.dir, { width: 160, height: 120, imageB64 }, env);
      expect(direct.source).toBe("classic");
      expect(direct.spots).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it("honors a custom weights file", async () => {
    const ctx = createTestContext();
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "f8-dust-weights-")));
    try {
      const weightsPath = path.join(dir, "weights.json");
      writeFileSync(weightsPath, JSON.stringify({ bias: -100, contrast: 0, size: 0, circularity: 0, border: 0 }));
      const env = { F8_DUST_SPOTS_WEIGHTS: weightsPath };
      const health = await getDustSpotsHealth(ctx.dir, env);
      expect(health.mlEnabled).toBe(true);
      expect(health.classifier.weights).toBe("custom");
      // A prohibitive bias drops the spot the embedded weights would keep.
      const imageB64 = rgbaB64(160, 120, (bytes, width) => withDust(bytes, width, 40, 30, 4));
      const direct = await runDustSpotsDetect(ctx.dir, { width: 160, height: 120, imageB64 }, env);
      expect(direct.source).toBe("ml");
      expect(direct.spots).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      ctx.close();
    }
  });

  it("rejects bad detect payloads over HTTP", async () => {
    const ctx = createTestContext();
    try {
      const response = await ctx.app.request("/api/dust-spots/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 8, height: 6, imageB64: "eA==" }),
      });
      expect(response.status).toBe(400);
    } finally {
      ctx.close();
    }
  });
});
