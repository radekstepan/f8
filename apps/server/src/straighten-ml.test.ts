import { describe, expect, it } from "vitest";
import { getStraightenHealth, runStraightenEstimate, validateStraightenBody } from "./straighten-ml.ts";
import { createTestContext } from "./fixtures.ts";

function rgbaB64(width: number, height: number, fill = 128): string {
  const bytes = new Uint8Array(width * height * 4);
  bytes.fill(fill);
  return Buffer.from(bytes).toString("base64");
}

describe("validateStraightenBody", () => {
  it("accepts a well-formed estimate request", () => {
    const parsed = validateStraightenBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6) });
    expect(parsed.ok).toBe(true);
  });

  it("rejects malformed and oversized bodies", () => {
    expect(validateStraightenBody({}).ok).toBe(false);
    expect(validateStraightenBody({ width: 0, height: 6, imageB64: "eA==" }).ok).toBe(false);
    expect(validateStraightenBody({ width: 8, height: 6, imageB64: "eA==" }).ok).toBe(false);
  });
});

describe("straighten estimate", () => {
  it("serves health without weights (gradient fallback)", async () => {
    const ctx = createTestContext();
    try {
      const health = await getStraightenHealth(ctx.dir);
      expect(health.ready).toBe(true);
      expect(health.serving).toBe(true);
      expect(health.source).toBe("gradient");
      const viaHttp = await ctx.app.request("/api/straighten/health");
      expect(viaHttp.status).toBe(200);
    } finally {
      ctx.close();
    }
  });

  it("estimates on flat input without wild angles", async () => {
    const ctx = createTestContext();
    try {
      const direct = await runStraightenEstimate(ctx.dir, { width: 16, height: 16, imageB64: rgbaB64(16, 16) });
      expect(direct.source).toBe("gradient");
      expect(direct.angle).toBe(0);
      expect(direct.confidence).toBe(0);
      const response = await ctx.app.request("/api/straighten/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 16, height: 16, imageB64: rgbaB64(16, 16) }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { angle: number; confidence: number };
      expect(payload.angle).toBe(0);
    } finally {
      ctx.close();
    }
  });
});
