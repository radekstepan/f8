// Export-time super-resolution: pure, dependency-free helpers shared by the
// photo server and the web client.
//
// A Real-ESRGAN x2plus ONNX (~64MB, npuscale re-export) doubles export
// dimensions server-side; the export dialog offers it as "Export 2x" with
// live tile progress. Large frames run tiled (512px cores, 16px halos) so a
// 2048px export never holds the whole RRDB activation map at once. This
// module holds the deterministic pieces:
//
// - superresOutputSize / superresTilePlan: scale math and the halo-discard
//   tile layout (each tile keeps only its core; halos absorb seam artifacts).
// - packSuperresInput / parseSuperresOutput: the ONNX wire contract (RGB
//   float32 NCHW 0..1 in, 2x RGB image same layout out — verified against
//   the npuscale export, whose output is the upscaled image directly).
// - stitchSuperresTiles: halo-discard assembly of per-tile outputs.
//
// 2x is ML-only: with no weights the server fails the upscale with the
// real cause (no classical fallback), so the dialog shows the error.
//
// Inputs are never mutated.

import type { SuperresSource } from "../types.js";
import { assertValidImage, type PixelImage } from "./analyze.js";

/** Single-file ONNX weights, lazily downloaded once into the model dir. */
export const SUPERRES_FILE = "realesrgan_x2.onnx";
/** Exact download size in bytes (npuscale v1.1 release asset). */
export const SUPERRES_FILE_SIZE = 67_073_446;
/**
 * Default weights: Real-ESRGAN x2plus ONNX re-exported by npuscale
 * (upstream weights by Wang et al. / xinntao, BSD-3-Clause). Overridable at
 * runtime — any 2x super-resolver taking RGB float32 NCHW 0..1 and returning
 * the 2x image in the same layout serves.
 */
export const SUPERRES_DEFAULT_URL =
  "https://github.com/ikeno-web/npuscale/releases/download/v1.1/realesrgan_x2.onnx";
/** License of the default weights (Real-ESRGAN upstream). */
export const SUPERRES_LICENSE = "BSD-3-Clause";
/** Override env for the weight URL (mirrors F8_DENOISE_*). */
export const SUPERRES_URL_ENV = "F8_SUPERRES_URL";
export const SUPERRES_DIR_ENV = "F8_SUPERRES_DIR";
/** Set to "1" to disable weight downloads (2x upscales then fail hard until weights are cached). */
export const SUPERRES_OFFLINE_ENV = "F8_SUPERRES_OFFLINE";
/** Fixed upscale factor of the model. */
export const SUPERRES_SCALE = 2;
/** Core tile size in input px; frames above this run tiled. */
export const SUPERRES_TILE = 512;
/** Halo in input px around each core tile (absorbed, never stitched). */
export const SUPERRES_TILE_OVERLAP = 16;
/**
 * Hard ceiling for upscale payloads: inputs with a long edge above this are
 * rejected, so the dialog suggests a smaller export size instead of burning
 * minutes on a 24MP frame (even tiled, CPU ML at that size is out of reach).
 */
export const SUPERRES_MAX_INPUT_DIM = 2048;

/** Doubled dimensions for an input frame. */
export function superresOutputSize(width: number, height: number): { width: number; height: number } {
  return { width: width * SUPERRES_SCALE, height: height * SUPERRES_SCALE };
}

/**
 * One halo-discard tile: the padded input region runs through the model and
 * only the core lands in the output. All coordinates are integers; the core
 * always lies inside the padded region, which always lies inside the image.
 */
export interface SuperresTile {
  /** 0-based tile index in row-major order. */
  index: number;
  /** Core region in input px (what this tile contributes). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Padded model input in input px (core + clamped halo). */
  px0: number;
  py0: number;
  px1: number;
  py1: number;
  /** Core placement in output px (top-left). */
  outX: number;
  outY: number;
  /** Core size in output px. */
  outW: number;
  outH: number;
  /** Core offset inside the tile's own 2x output in output px. */
  keepX: number;
  keepY: number;
}

/**
 * Row-major tile plan covering width×height. Frames fitting one core tile
 * yield a single halo-less tile; larger frames tile at SUPERRES_TILE with a
 * SUPERRES_TILE_OVERLAP halo per side (clamped at image borders). Throws
 * RangeError on non-positive or over-cap dimensions.
 */
export function superresTilePlan(width: number, height: number): SuperresTile[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid super-resolution input ${width}x${height}.`);
  }
  if (Math.max(width, height) > SUPERRES_MAX_INPUT_DIM) {
    throw new RangeError(
      `Super-resolution caps at ${SUPERRES_MAX_INPUT_DIM}px on the long edge — pick a smaller export size.`,
    );
  }
  const tiles: SuperresTile[] = [];
  const step = SUPERRES_TILE;
  const halo = SUPERRES_TILE_OVERLAP;
  let index = 0;
  for (let y0 = 0; y0 < height; y0 += step) {
    for (let x0 = 0; x0 < width; x0 += step) {
      const x1 = Math.min(width, x0 + step);
      const y1 = Math.min(height, y0 + step);
      const single = tiles.length === 0 && x1 - x0 === width && y1 - y0 === height && width <= step && height <= step;
      const px0 = single ? x0 : Math.max(0, x0 - halo);
      const py0 = single ? y0 : Math.max(0, y0 - halo);
      const px1 = single ? x1 : Math.min(width, x1 + halo);
      const py1 = single ? y1 : Math.min(height, y1 + halo);
      tiles.push({
        index: index++,
        x0,
        y0,
        x1,
        y1,
        px0,
        py0,
        px1,
        py1,
        outX: x0 * SUPERRES_SCALE,
        outY: y0 * SUPERRES_SCALE,
        outW: (x1 - x0) * SUPERRES_SCALE,
        outH: (y1 - y0) * SUPERRES_SCALE,
        keepX: (x0 - px0) * SUPERRES_SCALE,
        keepY: (y0 - py0) * SUPERRES_SCALE,
      });
    }
  }
  return tiles;
}

/**
 * Pack an RGBA image to RGB float32 NCHW 0..1 (channel-major, row-major).
 * Real-ESRGAN takes no normalization beyond 0..1.
 */
export function packSuperresInput(image: PixelImage): Float32Array {
  assertValidImage(image);
  const { width, height, data } = image;
  const plane = width * height;
  const packed = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p += 1) {
    const i = p * 4;
    packed[p] = (data[i] ?? 0) / 255;
    packed[plane + p] = (data[i + 1] ?? 0) / 255;
    packed[2 * plane + p] = (data[i + 2] ?? 0) / 255;
  }
  return packed;
}

/**
 * Decode one raw super-resolution output (3-plane NCHW float32 at 2x the
 * input dims) into an upscaled image. The export ships the upscaled image
 * directly (verified: neutral-gray input yields ~0.5 outputs), so values are
 * clamped to 0..1 — non-finite sanitized toward the bilinearly upscaled
 * original — and alpha comes from the bilinearly upscaled original alpha.
 * Throws RangeError on shape mismatch.
 */
export function parseSuperresOutput(output: ArrayLike<number>, original: PixelImage): PixelImage {
  assertValidImage(original);
  const outW = original.width * SUPERRES_SCALE;
  const outH = original.height * SUPERRES_SCALE;
  const outPlane = outW * outH;
  if (output.length !== 3 * outPlane) {
    throw new RangeError(
      `Expected a 2x super-resolution output of ${3 * outPlane} values, got ${output.length}.`,
    );
  }
  const alpha = upscaleAlphaBilinear(original);
  const data = new Uint8ClampedArray(outPlane * 4);
  for (let p = 0; p < outPlane; p += 1) {
    const i = p * 4;
    const ox = p % outW;
    const oy = Math.floor(p / outW);
    for (let c = 0; c < 3; c += 1) {
      const raw = output[c * outPlane + p] ?? 0;
      const fallback = sampleBilinearChannel(original, c, ox / SUPERRES_SCALE, oy / SUPERRES_SCALE);
      const clean = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : fallback / 255;
      data[i + c] = Math.round(clean * 255);
    }
    data[i + 3] = alpha[p] ?? 255;
  }
  return { width: outW, height: outH, data };
}

/** Bilinear sample of one RGB channel at fractional input coordinates. */
function sampleBilinearChannel(image: PixelImage, channel: number, fx: number, fy: number): number {
  const { width, height, data } = image;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  const cx0 = Math.min(width - 1, Math.max(0, x0));
  const cy0 = Math.min(height - 1, Math.max(0, y0));
  const a = data[(cy0 * width + cx0) * 4 + channel] ?? 0;
  const b = data[(cy0 * width + x1) * 4 + channel] ?? 0;
  const c = data[(y1 * width + cx0) * 4 + channel] ?? 0;
  const d = data[(y1 * width + x1) * 4 + channel] ?? 0;
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Bilinear 2x of the alpha channel (one byte per output pixel). */
function upscaleAlphaBilinear(image: PixelImage): Uint8ClampedArray {
  const outW = image.width * SUPERRES_SCALE;
  const outH = image.height * SUPERRES_SCALE;
  const out = new Uint8ClampedArray(outW * outH);
  for (let oy = 0; oy < outH; oy += 1) {
    for (let ox = 0; ox < outW; ox += 1) {
      out[oy * outW + ox] = Math.round(sampleBilinearChannel(image, 3, ox / SUPERRES_SCALE, oy / SUPERRES_SCALE));
    }
  }
  return out;
}

/**
 * Assemble per-tile 2x outputs into the full frame by halo-discard: each
 * tile contributes only its core at its output placement. Tile outputs must
 * match the plan 1:1 (same order, padded dims × 2). Throws RangeError on
 * count, size, or placement mismatch.
 */
export function stitchSuperresTiles(
  tiles: readonly SuperresTile[],
  outputs: readonly PixelImage[],
  width: number,
  height: number,
): PixelImage {
  if (tiles.length !== outputs.length) {
    throw new RangeError(`Super-resolution stitch count mismatch: ${tiles.length} tiles vs ${outputs.length} outputs.`);
  }
  const outW = width * SUPERRES_SCALE;
  const outH = height * SUPERRES_SCALE;
  const data = new Uint8ClampedArray(outW * outH * 4);
  tiles.forEach((tile, index) => {
    const output = outputs[index];
    if (!output) throw new RangeError(`Super-resolution stitch is missing tile ${index}.`);
    assertValidImage(output);
    const expectW = (tile.px1 - tile.px0) * SUPERRES_SCALE;
    const expectH = (tile.py1 - tile.py0) * SUPERRES_SCALE;
    if (output.width !== expectW || output.height !== expectH) {
      throw new RangeError(
        `Super-resolution tile ${index} is ${output.width}x${output.height}, expected ${expectW}x${expectH}.`,
      );
    }
    for (let y = 0; y < tile.outH; y += 1) {
      const srcRow = (tile.keepY + y) * output.width + tile.keepX;
      const dstRow = (tile.outY + y) * outW + tile.outX;
      for (let x = 0; x < tile.outW; x += 1) {
        const s = (srcRow + x) * 4;
        const d = (dstRow + x) * 4;
        data[d] = output.data[s] ?? 0;
        data[d + 1] = output.data[s + 1] ?? 0;
        data[d + 2] = output.data[s + 2] ?? 0;
        data[d + 3] = output.data[s + 3] ?? 255;
      }
    }
  });
  return { width: outW, height: outH, data };
}

/** Progress callback for the 2x run: fraction 0..1 plus a human stage. */
export type SuperresProgress = (fraction: number, stage: string) => void;

/**
 * Map a polled server tile count to client progress: tiles land in the
 * 0.15..0.95 band (the POST's upload/download own the edges). Single-tile
 * runs report no tile counts, so they hold a steady "Upscaling…" instead
 * of a stalled bar. Pure so the web transport and its tests share it.
 */
export function superresTileProgress(tile: number, totalTiles: number): { fraction: number; stage: string } {
  if (!Number.isInteger(totalTiles) || totalTiles <= 1 || !Number.isFinite(tile) || tile < 0) {
    return { fraction: 0.4, stage: "Upscaling…" };
  }
  const done = Math.min(tile, totalTiles);
  return {
    fraction: 0.15 + (done / totalTiles) * 0.8,
    stage: `Upscaling tile ${Math.min(tile + 1, totalTiles)} of ${totalTiles}…`,
  };
}

export interface SuperresRunOptions {
  onProgress?: SuperresProgress;
  signal?: AbortSignal;
}

export interface SuperresRunResult {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  source: SuperresSource;
}

export interface SuperresHealthSnapshot {
  /** True only once the Real-ESRGAN session serves — 2x is ML-only. */
  ready: boolean;
  source: SuperresSource;
  downloading: boolean;
  downloadPct: number;
  /**
   * True when the weight file is cached on disk, even while the ONNX
   * session is still cold — this is what distinguishes "run yarn setup"
   * (weights absent) from "first export warms the engine" (cached).
   */
  weightsReady: boolean;
  error: string | null;
}

/** Dialog engine note: tone picks the styling, text renders verbatim. */
export interface SuperresEngineNote {
  tone: "ready" | "busy" | "error" | "missing";
  text: string;
}

/**
 * One health snapshot → the export dialog's engine note. Errors surface
 * verbatim (hard fail, no fallback); a quiet not-ready box splits on
 * weightsReady — cached weights with a cold session (the normal state
 * right after `yarn setup`) say so and promise a warm-on-export, while
 * only truly absent weights point at setup. Never blame setup when the
 * weights are already on disk.
 */
export function superresEngineNote(snapshot: SuperresHealthSnapshot): SuperresEngineNote {
  if (snapshot.ready && snapshot.source === "onnx") {
    return { tone: "ready", text: "Real-ESRGAN 2x is ready on the photo server." };
  }
  if (snapshot.downloading) {
    return {
      tone: "busy",
      text: `Downloading Real-ESRGAN weights… ${Math.round(snapshot.downloadPct * 100)}% — the ML upscale starts once they land.`,
    };
  }
  if (snapshot.error) return { tone: "error", text: snapshot.error };
  if (snapshot.weightsReady) {
    return {
      tone: "ready",
      text: "Real-ESRGAN weights are cached — the first export warms the engine, then upscales.",
    };
  }
  return {
    tone: "missing",
    text: "ML weights are missing — run yarn setup, or export once to download them (~64MB).",
  };
}

/**
 * Parse one GET /api/superres/health payload into a dialog snapshot.
 * Pure so the web transport and its tests share it: server errors and a
 * wrong engine reject with the message the dialog shows, while a missing
 * weightsReady reads as false (older servers predate the field). Mirrors
 * the server's validateSuperresBody ok/error shape.
 */
export function parseSuperresHealthSnapshot(
  payload: unknown,
): { ok: true; value: SuperresHealthSnapshot } | { ok: false; error: string } {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Photo server returned bad health." };
  }
  const snapshot = payload as Record<string, unknown>;
  if (typeof snapshot["error"] === "string" && snapshot["error"]) {
    return { ok: false, error: (snapshot["error"] as string).slice(0, 220) };
  }
  if (snapshot["source"] !== "onnx") {
    return { ok: false, error: "Photo server returned an unexpected upscale engine." };
  }
  const downloadPct =
    typeof snapshot["downloadPct"] === "number" && Number.isFinite(snapshot["downloadPct"])
      ? Math.max(0, Math.min(1, snapshot["downloadPct"] as number))
      : 1;
  return {
    ok: true,
    value: {
      ready: snapshot["ready"] === true || snapshot["serving"] === true,
      source: "onnx",
      downloading: snapshot["downloading"] === true,
      downloadPct,
      weightsReady: snapshot["weightsReady"] === true,
      error: null,
    },
  };
}

/**
 * UI-facing 2x transport, injected by the app (core and UI never touch the
 * server directly) — the same seam as RepairInpaintBinding for inpainting.
 */
export interface SuperresExportBinding {
  run(image: PixelImage, options?: SuperresRunOptions): Promise<SuperresRunResult>;
  health(): Promise<SuperresHealthSnapshot>;
}
