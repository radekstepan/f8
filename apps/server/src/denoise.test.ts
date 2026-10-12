import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  denoiseDir,
  ensureDenoiseReady,
  getDenoiseHealth,
  runDenoise,
  validateDenoiseBody,
} from "./denoise.ts";
import { createTestContext } from "./fixtures.ts";

function rgbaB64(width: number, height: number, paint?: (data: Uint8Array, width: number, height: number) => void): string {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    bytes[i * 4] = 128;
    bytes[i * 4 + 1] = 128;
    bytes[i * 4 + 2] = 128;
    bytes[i * 4 + 3] = 255;
  }
  paint?.(bytes, width, height);
  return Buffer.from(bytes).toString("base64");
}

/** Deterministic alternating grain ±24, like the core fixture. */
function withGrain(bytes: Uint8Array, width: number, height: number): void {
  for (let i = 0; i < width * height; i += 1) {
    const delta = i % 2 === 0 ? 24 : -24;
    bytes[i * 4] = 128 + delta;
    bytes[i * 4 + 1] = 128 - delta;
    bytes[i * 4 + 2] = 128 + delta;
  }
}

function lumaVariance(b64: string): number {
  const bytes = Buffer.from(b64, "base64");
  const plane = bytes.length / 4;
  let mean = 0;
  for (let p = 0; p < plane; p += 1) {
    mean += 0.2126 * (bytes[p * 4] ?? 0) + 0.7152 * (bytes[p * 4 + 1] ?? 0) + 0.0722 * (bytes[p * 4 + 2] ?? 0);
  }
  mean /= plane;
  let variance = 0;
  for (let p = 0; p < plane; p += 1) {
    const luma = 0.2126 * (bytes[p * 4] ?? 0) + 0.7152 * (bytes[p * 4 + 1] ?? 0) + 0.0722 * (bytes[p * 4 + 2] ?? 0);
    variance += (luma - mean) * (luma - mean);
  }
  return variance / plane;
}

describe("validateDenoiseBody", () => {
  it("accepts a well-formed preview request", () => {
    const parsed = validateDenoiseBody({ width: 64, height: 48, imageB64: rgbaB64(64, 48), strength: 65 }, "preview");
    expect(parsed.ok).toBe(true);
  });

  it("accepts a well-formed apply request", () => {
    const parsed = validateDenoiseBody({ width: 1600, height: 1200, imageB64: rgbaB64(1600, 1200), strength: 65 }, "apply");
    expect(parsed.ok).toBe(true);
  });

  it("rejects malformed bodies and strengths", () => {
    expect(validateDenoiseBody({}).ok).toBe(false);
    expect(validateDenoiseBody({ width: 0, height: 6, imageB64: "eA==", strength: 50 }).ok).toBe(false);
    expect(validateDenoiseBody({ width: 8, height: 6, imageB64: "eA==", strength: 50 }).ok).toBe(false);
    expect(validateDenoiseBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6) }).ok).toBe(false);
    expect(validateDenoiseBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6), strength: -1 }).ok).toBe(false);
    expect(validateDenoiseBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6), strength: 101 }).ok).toBe(false);
    expect(validateDenoiseBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6), strength: Number.NaN }).ok).toBe(false);
  });

  it("enforces the downsample-first flow: preview rejects large frames, apply caps at 2048", () => {
    const big = { width: 600, height: 400, imageB64: rgbaB64(600, 400), strength: 50 };
    const preview = validateDenoiseBody(big, "preview");
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.error).toContain("512px");
    expect(validateDenoiseBody(big, "apply").ok).toBe(true);
    const huge = { width: 2049, height: 100, imageB64: "eA==", strength: 50 };
    expect(validateDenoiseBody(huge, "apply").ok).toBe(false);
    expect(validateDenoiseBody(huge, "preview").ok).toBe(false);
  });
});

describe("denoise (weights absent → classical fallback)", () => {
  it("serves health without weights and names the model", async () => {
    const ctx = createTestContext();
    try {
      const health = await getDenoiseHealth(ctx.dir);
      expect(health.ready).toBe(true);
      expect(health.serving).toBe(true);
      expect(health.source).toBe("classic");
      expect(health.model.file).toBe("dncnn_color.onnx");
      expect(health.model.license).toBe("MIT");
      expect(health.model.url).toContain("npuscale");
      const viaHttp = await ctx.app.request("/api/denoise/health");
      expect(viaHttp.status).toBe(200);
    } finally {
      ctx.close();
    }
  });

  it("denoises grain classically and echoes strength", async () => {
    const ctx = createTestContext();
    try {
      const imageB64 = rgbaB64(48, 32, withGrain);
      const direct = await runDenoise(ctx.dir, { width: 48, height: 32, imageB64, strength: 100 });
      expect(direct.source).toBe("classic");
      expect(direct.strength).toBe(100);
      expect(direct.width).toBe(48);
      expect(direct.height).toBe(32);
      expect(lumaVariance(direct.imageB64)).toBeLessThan(lumaVariance(imageB64) / 2);
    } finally {
      ctx.close();
    }
  });

  it("serves preview and apply over HTTP and rejects oversized previews", async () => {
    const ctx = createTestContext();
    try {
      const small = { width: 48, height: 32, imageB64: rgbaB64(48, 32, withGrain), strength: 65 };
      const preview = await ctx.app.request("/api/denoise/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(small),
      });
      expect(preview.status).toBe(200);
      const previewBody = (await preview.json()) as { source: string; imageB64: string; strength: number };
      expect(previewBody.source).toBe("classic");
      expect(previewBody.strength).toBe(65);
      expect(lumaVariance(previewBody.imageB64)).toBeLessThan(lumaVariance(small.imageB64));

      const apply = await ctx.app.request("/api/denoise/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 600, height: 400, imageB64: rgbaB64(600, 400), strength: 45 }),
      });
      expect(apply.status).toBe(200);

      const oversized = await ctx.app.request("/api/denoise/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 600, height: 400, imageB64: rgbaB64(600, 400), strength: 45 }),
      });
      expect(oversized.status).toBe(400);

      const bad = await ctx.app.request("/api/denoise/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 8, height: 8, imageB64: "eA==", strength: 50 }),
      });
      expect(bad.status).toBe(400);
    } finally {
      ctx.close();
    }
  });
});

describe("denoise (weights present → ONNX)", () => {
  it("warms a local DnCNN file and serves the learned path", async () => {
    const weights = process.env["F8_TEST_DENOISE_WEIGHTS"];
    if (!weights) return;
    const ctx = createTestContext();
    try {
      const dir = denoiseDir(ctx.dir);
      await fs.mkdir(dir, { recursive: true });
      await fs.copyFile(weights, path.join(dir, "dncnn_color.onnx"));
      await ensureDenoiseReady(ctx.dir);
      const health = await getDenoiseHealth(ctx.dir);
      expect(health.weightsReady).toBe(true);
      expect(health.sessionsWarm).toBe(true);
      expect(health.source).toBe("onnx");
      const result = await runDenoise(ctx.dir, {
        width: 48,
        height: 32,
        imageB64: rgbaB64(48, 32, withGrain),
        strength: 100,
      });
      expect(result.source).toBe("onnx");
      expect(lumaVariance(result.imageB64)).toBeLessThan(lumaVariance(rgbaB64(48, 32, withGrain)));
    } finally {
      ctx.close();
    }
  });
});
