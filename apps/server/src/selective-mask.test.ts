import { describe, expect, it } from "vitest";
import { getSelectiveMaskHealth, runSelectiveMaskDetect, validateSelectiveMaskBody } from "./selective-mask.ts";
import { createTestContext } from "./fixtures.ts";

function rgbaB64(width: number, height: number, paint?: (data: Uint8Array, width: number, height: number) => void): string {
  const bytes = new Uint8Array(width * height * 4);
  // Sky-blue background: no skin tones.
  for (let i = 0; i < width * height; i += 1) {
    bytes[i * 4] = 90;
    bytes[i * 4 + 1] = 140;
    bytes[i * 4 + 2] = 200;
    bytes[i * 4 + 3] = 255;
  }
  paint?.(bytes, width, height);
  return Buffer.from(bytes).toString("base64");
}

/** Skin-tone square (shared-rule range) for the classical proposer. */
function withSkin(bytes: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      bytes[i] = 210;
      bytes[i + 1] = 150;
      bytes[i + 2] = 120;
    }
  }
}

describe("validateSelectiveMaskBody", () => {
  it("accepts a well-formed segment request", () => {
    const parsed = validateSelectiveMaskBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6) });
    expect(parsed.ok).toBe(true);
  });

  it("rejects malformed bodies", () => {
    expect(validateSelectiveMaskBody({}).ok).toBe(false);
    expect(validateSelectiveMaskBody({ width: 0, height: 6, imageB64: "eA==" }).ok).toBe(false);
    expect(validateSelectiveMaskBody({ width: 8, height: 6, imageB64: "eA==" }).ok).toBe(false);
    expect(validateSelectiveMaskBody({ width: 8, height: 6 }).ok).toBe(false);
  });
});

describe("selective mask (weights absent → classical fallback)", () => {
  it("serves health without weights and names the model", async () => {
    const ctx = createTestContext();
    try {
      const health = await getSelectiveMaskHealth(ctx.dir);
      expect(health.ready).toBe(true);
      expect(health.serving).toBe(true);
      expect(health.source).toBe("classic");
      expect(health.model.file).toBe("u2netp.onnx");
      expect(health.model.license).toBe("Apache-2.0");
      expect(health.model.url).toContain("u2netp.onnx");
      const viaHttp = await ctx.app.request("/api/selective-mask/health");
      expect(viaHttp.status).toBe(200);
    } finally {
      ctx.close();
    }
  });

  it("segments a face-box-derived subject via the classical fallback", async () => {
    const ctx = createTestContext();
    try {
      const imageB64 = rgbaB64(320, 240, (bytes, width) => withSkin(bytes, width, 120, 40, 200, 120));
      const direct = await runSelectiveMaskDetect(ctx.dir, { width: 320, height: 240, imageB64 });
      expect(direct.source).toBe("classic");
      expect(direct.mask).not.toBeNull();
      expect(direct.coverage).toBeGreaterThan(0.01);
      expect(direct.coverage).toBeLessThan(0.98);
      expect(direct.mask!.maskWidth).toBeLessThanOrEqual(160);
      expect(direct.mask!.maskHeight).toBeLessThanOrEqual(160);
      // The wire mask decodes to the advertised dimensions.
      const decoded = Buffer.from(direct.mask!.maskB64, "base64");
      expect(decoded.length).toBe(direct.mask!.maskWidth * direct.mask!.maskHeight);
      const response = await ctx.app.request("/api/selective-mask/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 320, height: 240, imageB64 }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { source: string; mask: unknown; coverage: number };
      expect(payload.source).toBe("classic");
      expect(payload.mask).not.toBeNull();
      expect(payload.coverage).toBeGreaterThan(0.01);
    } finally {
      ctx.close();
    }
  });

  it("reports no subject on a skin-free photo", async () => {
    const ctx = createTestContext();
    try {
      const direct = await runSelectiveMaskDetect(ctx.dir, { width: 64, height: 64, imageB64: rgbaB64(64, 64) });
      expect(direct.source).toBe("classic");
      expect(direct.mask).toBeNull();
      expect(direct.coverage).toBe(0);
    } finally {
      ctx.close();
    }
  });

  it("rejects bad detect payloads over HTTP", async () => {
    const ctx = createTestContext();
    try {
      const response = await ctx.app.request("/api/selective-mask/detect", {
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
