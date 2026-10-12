import { describe, expect, it } from "vitest";
import { getObjectDetectHealth, runObjectDetect, validateDetectBody } from "./object-detect.ts";
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

/** Skin-tone rectangle (Kovac-range) for the classical proposer. */
function withFigure(bytes: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      bytes[i] = 210;
      bytes[i + 1] = 150;
      bytes[i + 2] = 120;
    }
  }
}

describe("validateDetectBody", () => {
  it("accepts a well-formed detect request", () => {
    const parsed = validateDetectBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6) });
    expect(parsed.ok).toBe(true);
    const withLabels = validateDetectBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6), labels: ["person"] });
    expect(withLabels.ok).toBe(true);
  });

  it("rejects malformed bodies and unsupported labels", () => {
    expect(validateDetectBody({}).ok).toBe(false);
    expect(validateDetectBody({ width: 0, height: 6, imageB64: "eA==" }).ok).toBe(false);
    expect(validateDetectBody({ width: 8, height: 6, imageB64: "eA==" }).ok).toBe(false);
    expect(validateDetectBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6), labels: ["car"] }).ok).toBe(false);
    expect(validateDetectBody({ width: 8, height: 6, imageB64: rgbaB64(8, 6), labels: [] }).ok).toBe(false);
  });
});

describe("object detect (weights absent → classical fallback)", () => {
  it("serves health without weights and names the model", async () => {
    const ctx = createTestContext();
    try {
      const health = await getObjectDetectHealth(ctx.dir);
      expect(health.ready).toBe(true);
      expect(health.serving).toBe(true);
      expect(health.source).toBe("classic");
      expect(health.model.file).toBe("yolov8n.onnx");
      expect(health.model.license).toBe("AGPL-3.0");
      const viaHttp = await ctx.app.request("/api/object-detect/health");
      expect(viaHttp.status).toBe(200);
    } finally {
      ctx.close();
    }
  });

  it("finds a skin-tone figure via the classical fallback", async () => {
    const ctx = createTestContext();
    try {
      const imageB64 = rgbaB64(320, 240, (bytes, width) => withFigure(bytes, width, 120, 60, 200, 180));
      const direct = await runObjectDetect(ctx.dir, { width: 320, height: 240, imageB64 });
      expect(direct.source).toBe("classic");
      expect(direct.detections).toHaveLength(1);
      expect(direct.detections[0]?.label).toBe("person");
      const box = direct.detections[0]?.box;
      expect(box?.x0).toBeLessThan(120 / 320);
      expect(box?.x1).toBeGreaterThan(200 / 320);
      const response = await ctx.app.request("/api/object-detect/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 320, height: 240, imageB64 }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { source: string; detections: unknown[] };
      expect(payload.source).toBe("classic");
      expect(payload.detections).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it("reports nothing on a skin-free photo", async () => {
    const ctx = createTestContext();
    try {
      const direct = await runObjectDetect(ctx.dir, { width: 64, height: 64, imageB64: rgbaB64(64, 64) });
      expect(direct.source).toBe("classic");
      expect(direct.detections).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it("rejects bad detect payloads over HTTP", async () => {
    const ctx = createTestContext();
    try {
      const response = await ctx.app.request("/api/object-detect/detect", {
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
