import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureSuperresReady,
  getSuperresHealth,
  getSuperresProgress,
  resetSuperresProgress,
  runSuperres,
  superresDir,
  validateSuperresBody,
} from "./superres.ts";
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

/** Left-dark / right-light step so the 2x output has checkable structure. */
function withStep(bytes: Uint8Array, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = x < width / 2 ? 0 : 255;
      const i = (y * width + x) * 4;
      bytes[i] = v;
      bytes[i + 1] = v;
      bytes[i + 2] = v;
    }
  }
}

function redAt(b64: string, width: number, x: number, y: number): number {
  return Buffer.from(b64, "base64")[(y * width + x) * 4] ?? -1;
}

describe("validateSuperresBody", () => {
  it("accepts a well-formed upscale request", () => {
    const parsed = validateSuperresBody({ width: 64, height: 48, imageB64: rgbaB64(64, 48) });
    expect(parsed.ok).toBe(true);
  });

  it("rejects malformed bodies and byte mismatches", () => {
    expect(validateSuperresBody({}).ok).toBe(false);
    expect(validateSuperresBody({ width: 0, height: 6, imageB64: "eA==" }).ok).toBe(false);
    expect(validateSuperresBody({ width: 8, height: 6, imageB64: "eA==" }).ok).toBe(false);
    expect(validateSuperresBody({ width: 8, height: 6 }).ok).toBe(false);
    expect(validateSuperresBody("nope").ok).toBe(false);
  });

  it("caps inputs at a 2048px long edge", () => {
    const huge = { width: 2049, height: 100, imageB64: "eA==" };
    const parsed = validateSuperresBody(huge);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("Invalid width");
    const tall = { width: 100, height: 3000, imageB64: "eA==" };
    expect(validateSuperresBody(tall).ok).toBe(false);
  });
});

describe("superres (weights absent → classical fallback)", () => {
  it("serves health without weights and names the model", async () => {
    const ctx = createTestContext();
    try {
      const health = await getSuperresHealth(ctx.dir);
      expect(health.ready).toBe(true);
      expect(health.serving).toBe(true);
      expect(health.source).toBe("classic");
      expect(health.model.file).toBe("realesrgan_x2.onnx");
      expect(health.model.license).toBe("BSD-3-Clause");
      expect(health.model.url).toContain("npuscale");
      const viaHttp = await ctx.app.request("/api/superres/health");
      expect(viaHttp.status).toBe(200);
    } finally {
      ctx.close();
    }
  });

  it("reports idle progress with no job running", async () => {
    resetSuperresProgress();
    const ctx = createTestContext();
    try {
      const progress = getSuperresProgress();
      expect(progress.active).toBe(false);
      expect(progress.stage).toBe("idle");
      const viaHttp = await ctx.app.request("/api/superres/progress");
      expect(viaHttp.status).toBe(200);
      const body = (await viaHttp.json()) as { active: boolean; stage: string };
      expect(body.active).toBe(false);
      expect(body.stage).toBe("idle");
    } finally {
      ctx.close();
    }
  });

  it("upscales classically at exactly 2x with the step preserved", async () => {
    const ctx = createTestContext();
    try {
      const direct = await runSuperres(ctx.dir, { width: 32, height: 16, imageB64: rgbaB64(32, 16, withStep) });
      expect(direct.source).toBe("classic");
      expect(direct.tiles).toBe(0);
      expect(direct.width).toBe(64);
      expect(direct.height).toBe(32);
      // The dark/light step survives at double resolution.
      expect(redAt(direct.imageB64, 64, 4, 8)).toBeLessThan(16);
      expect(redAt(direct.imageB64, 64, 59, 8)).toBeGreaterThan(239);
      expect(redAt(direct.imageB64, 64, 31, 8)).toBeLessThan(128);
      expect(redAt(direct.imageB64, 64, 32, 8)).toBeGreaterThan(128);
    } finally {
      ctx.close();
    }
  });

  it("serves upscale over HTTP and rejects oversized and malformed bodies", async () => {
    const ctx = createTestContext();
    try {
      const small = { width: 32, height: 16, imageB64: rgbaB64(32, 16, withStep) };
      const response = await ctx.app.request("/api/superres/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(small),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { source: string; width: number; height: number; imageB64: string; tiles: number };
      expect(body.source).toBe("classic");
      expect(body.width).toBe(64);
      expect(body.height).toBe(32);
      expect(body.tiles).toBe(0);
      expect(Buffer.from(body.imageB64, "base64").length).toBe(64 * 32 * 4);

      const oversized = await ctx.app.request("/api/superres/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 4096, height: 100, imageB64: "eA==" }),
      });
      expect(oversized.status).toBe(400);

      const bad = await ctx.app.request("/api/superres/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 8, height: 8, imageB64: "eA==" }),
      });
      expect(bad.status).toBe(400);
    } finally {
      ctx.close();
    }
  });
});

describe("superres (weights present → ONNX)", () => {
  it("warms a local Real-ESRGAN file and serves the learned tiled path", async () => {
    const weights = process.env["F8_TEST_SUPERRES_WEIGHTS"];
    if (!weights) return;
    resetSuperresProgress();
    const ctx = createTestContext();
    try {
      const dir = superresDir(ctx.dir);
      await fs.mkdir(dir, { recursive: true });
      await fs.copyFile(weights, path.join(dir, "realesrgan_x2.onnx"));
      await ensureSuperresReady(ctx.dir);
      const health = await getSuperresHealth(ctx.dir);
      expect(health.weightsReady).toBe(true);
      expect(health.sessionsWarm).toBe(true);
      expect(health.source).toBe("onnx");
      const result = await runSuperres(ctx.dir, {
        width: 48,
        height: 32,
        imageB64: rgbaB64(48, 32, withStep),
      });
      expect(result.source).toBe("onnx");
      expect(result.tiles).toBe(1);
      expect(result.width).toBe(96);
      expect(result.height).toBe(64);
      // Learned 2x keeps the step: dark stays dark, light stays light.
      expect(redAt(result.imageB64, 96, 6, 32)).toBeLessThan(64);
      expect(redAt(result.imageB64, 96, 89, 32)).toBeGreaterThan(191);
      const progress = getSuperresProgress();
      expect(progress.stage).toBe("done");
      expect(progress.totalTiles).toBe(1);
    } finally {
      resetSuperresProgress();
      ctx.close();
    }
  }, 120_000);
});
