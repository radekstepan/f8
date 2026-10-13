import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDIT } from "./data.js";
import { estimateExportBytes, formatByteSize, isLossyExportFormat, renderExportPreview } from "./exportEstimate.js";

describe("formatByteSize", () => {
  it("shows whole bytes below 1 KB", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(842)).toBe("842 B");
    expect(formatByteSize(1023)).toBe("1023 B");
  });

  it("uses one decimal below 100 units, whole units above", () => {
    expect(formatByteSize(1024)).toBe("1 KB");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(99.96 * 1024)).toBe("100 KB");
    expect(formatByteSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatByteSize(312 * 1024 * 1024)).toBe("312 MB");
    expect(formatByteSize(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("rolls over unit boundaries at 1024", () => {
    expect(formatByteSize(1024 * 1024 - 1)).toBe("1024 KB");
    expect(formatByteSize(1024 * 1024)).toBe("1 MB");
  });

  it("renders unusable input as an en dash, never NaN/negative", () => {
    expect(formatByteSize(Number.NaN)).toBe("–");
    expect(formatByteSize(Number.POSITIVE_INFINITY)).toBe("–");
    expect(formatByteSize(-1)).toBe("–");
  });
});

describe("estimateExportBytes", () => {
  it("renders at the selected size, encodes with the selected format/quality, and reports bytes + dimensions", async () => {
    const canvas = { width: 2048, height: 1365 };
    const render = vi.fn(async () => canvas);
    const encode = vi.fn(async () => ({ size: 482113 }));
    const estimate = await estimateExportBytes(
      "http://localhost/photo.jpg",
      { ...DEFAULT_EDIT },
      "jpeg",
      90,
      2048,
      // Fakes stand in for the DOM pipeline (node has no canvas/Image).
      { render: render as never, encode: encode as never },
    );
    expect(render).toHaveBeenCalledTimes(1);
    // No repair binding: the estimate must stay off the worker heal path.
    expect(render).toHaveBeenCalledWith("http://localhost/photo.jpg", expect.anything(), 2048);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(canvas, "jpeg", 90);
    expect(estimate).toEqual({ bytes: 482113, width: 2048, height: 1365 });
  });

  it("propagates pipeline failures so the dialog can hide the line", async () => {
    const render = vi.fn(async () => { throw new Error("decode failed"); });
    const encode = vi.fn(async () => ({ size: 0 }));
    await expect(
      estimateExportBytes("bad", { ...DEFAULT_EDIT }, "jpeg", 90, 1200, {
        render: render as never,
        encode: encode as never,
      }),
    ).rejects.toThrow("decode failed");
    expect(encode).not.toHaveBeenCalled();
  });
});

describe("isLossyExportFormat", () => {
  it("is true for JPEG and WebP, whose artifacts are worth previewing", () => {
    expect(isLossyExportFormat("jpeg")).toBe(true);
    expect(isLossyExportFormat("webp")).toBe(true);
  });

  it("is false for lossless PNG and fails closed on unknown values", () => {
    expect(isLossyExportFormat("png")).toBe(false);
    expect(isLossyExportFormat("tiff")).toBe(false);
    expect(isLossyExportFormat("")).toBe(false);
    expect(isLossyExportFormat("JPEG")).toBe(false);
  });
});

describe("renderExportPreview", () => {
  it("runs the same render-at-size + encode-with-settings pipeline and returns the blob with the numbers", async () => {
    const canvas = { width: 1200, height: 800 };
    const blob = { size: 184203 };
    const render = vi.fn(async () => canvas);
    const encode = vi.fn(async () => blob);
    const preview = await renderExportPreview(
      "http://localhost/photo.jpg",
      { ...DEFAULT_EDIT },
      "webp",
      80,
      1200,
      // Fakes stand in for the DOM pipeline (node has no canvas/Image).
      { render: render as never, encode: encode as never },
    );
    expect(render).toHaveBeenCalledTimes(1);
    // No repair binding, like the estimate: the preview stays off the
    // worker heal path (blur fallback in the small repair regions).
    expect(render).toHaveBeenCalledWith("http://localhost/photo.jpg", expect.anything(), 1200);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(canvas, "webp", 80);
    // Same run feeds both consumers: the size line and the preview pixels.
    expect(preview).toEqual({ bytes: 184203, width: 1200, height: 800, blob });
    expect(preview.blob).toBe(blob);
  });

  it("propagates pipeline failures so the dialog can hide the preview", async () => {
    const render = vi.fn(async () => { throw new Error("decode failed"); });
    const encode = vi.fn(async () => ({ size: 0 }));
    await expect(
      renderExportPreview("bad", { ...DEFAULT_EDIT }, "jpeg", 90, 1200, {
        render: render as never,
        encode: encode as never,
      }),
    ).rejects.toThrow("decode failed");
    expect(encode).not.toHaveBeenCalled();
  });
});
