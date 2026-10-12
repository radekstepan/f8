// Server-side export-time super-resolution: the 2x Real-ESRGAN pass runs
// here via onnxruntime-node, never in the browser.
//
// The client POSTs the rendered export canvas and gets doubled pixels back
// (raw RGBA base64). Large frames run tiled (512px cores, 16px halos) with
// per-tile progress on GET /api/superres/progress, so multi-minute 2048px
// exports show real progress instead of sitting still. Inputs cap at a
// 2048px long edge — beyond that the dialog suggests a smaller export size.
//
// Weights download once into the model dir on first warmup. Until they
// land — offline, download disabled, ORT missing — the built-in classical
// fallback (Lanczos-3) serves instead, so upscale never 503s for ML reasons;
// the response always names its source.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
import {
  SUPERRES_DEFAULT_URL,
  SUPERRES_FILE,
  SUPERRES_FILE_SIZE,
  SUPERRES_LICENSE,
  SUPERRES_MAX_INPUT_DIM,
  packSuperresInput,
  parseSuperresOutput,
  stitchSuperresTiles,
  superresOutputSize,
  superresTilePlan,
  upscaleClassic2x,
  type PixelImage,
  type SuperresSource,
} from "@f8/core";

export const SUPERRES_MODEL_DIR_SUFFIX = path.join("models", "superres");
/** Raw RGBA payload cap (~16MP at the 2048px ceiling). */
export const SUPERRES_MAX_BYTES = 2048 * 2048 * 4;
/** Minimum accepted weight file size (guards truncated downloads). */
const SUPERRES_MIN_WEIGHT_BYTES = 32 * 1024 * 1024;

export interface SuperresHealth {
  ok: boolean;
  /** Always true: the classical fallback serves with no weights. */
  ready: boolean;
  serving: boolean;
  weightsReady: boolean;
  sessionsWarm: boolean;
  downloading: boolean;
  /** 0..1 across the pending weight file (1 when idle). */
  downloadPct: number;
  /** "onnx" once Real-ESRGAN weights serve, else "classic". */
  source: SuperresSource;
  model: { file: string; bytes: number; license: string; url: string };
  error: string | null;
}

export interface SuperresBody {
  width: number;
  height: number;
  /** Base64 of raw RGBA bytes (width*height*4). */
  imageB64: string;
}

export interface SuperresResult {
  /** Base64 of upscaled raw RGBA bytes (2w*2h*4). */
  imageB64: string;
  width: number;
  height: number;
  /** Tiles the ML path ran (1 when untiled, 0 for classical). */
  tiles: number;
  source: SuperresSource;
}

/** Live inference progress for the current (single-user, local) upscale job. */
export interface SuperresJobProgress {
  active: boolean;
  /** Human stage: idle, upscale, done. */
  stage: string;
  /** Completed ML tiles (0 until the loop starts, or for classical runs). */
  tile: number;
  totalTiles: number;
  startedAt: number | null;
  updatedAt: number | null;
}

const IDLE_PROGRESS: SuperresJobProgress = {
  active: false,
  stage: "idle",
  tile: 0,
  totalTiles: 0,
  startedAt: null,
  updatedAt: null,
};

const superresProgress: SuperresJobProgress = { ...IDLE_PROGRESS };

function setJobProgress(patch: Partial<SuperresJobProgress>): void {
  Object.assign(superresProgress, patch, { updatedAt: Date.now() });
}

/** Snapshot of the current upscale job for progress polling. Always safe to call. */
export function getSuperresProgress(): SuperresJobProgress {
  return { ...superresProgress };
}

/** Reset progress to idle (job end, tests). */
export function resetSuperresProgress(): void {
  Object.assign(superresProgress, IDLE_PROGRESS, { updatedAt: Date.now() });
}

export function superresDir(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env["F8_SUPERRES_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(dataDir, SUPERRES_MODEL_DIR_SUFFIX);
}

function superresUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env["F8_SUPERRES_URL"];
  if (override && override.trim()) return override.trim();
  return SUPERRES_DEFAULT_URL;
}

function superresOffline(): boolean {
  return process.env["F8_SUPERRES_OFFLINE"] === "1";
}

function ortAvailable(): boolean {
  try {
    require.resolve("onnxruntime-node");
    return true;
  } catch {
    return false;
  }
}

async function filePresent(filePath: string, minSize: number): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size >= minSize;
  } catch {
    return false;
  }
}

interface DownloadProgress {
  active: boolean;
  received: number;
  total: number;
}

const downloadProgress = new Map<string, DownloadProgress>();

function progressFor(dir: string): DownloadProgress {
  let progress = downloadProgress.get(dir);
  if (!progress) {
    progress = { active: false, received: 0, total: 0 };
    downloadProgress.set(dir, progress);
  }
  return progress;
}

interface NodeSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
  inputName: string;
  outputName: string;
}

const readyErrors = new Map<string, string>();
const readyJobs = new Map<string, Promise<void>>();
const nodeSessions = new Map<string, NodeSession>();

function weightsPath(dataDir: string): string {
  return path.join(superresDir(dataDir), SUPERRES_FILE);
}

async function downloadWeights(dataDir: string): Promise<string> {
  if (!ortAvailable()) throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  if (superresOffline()) throw new Error("Super-resolution provisioning is disabled (F8_SUPERRES_OFFLINE=1).");
  const url = superresUrl();
  const dir = superresDir(dataDir);
  const dest = path.join(dir, SUPERRES_FILE);
  if (await filePresent(dest, SUPERRES_MIN_WEIGHT_BYTES)) return dest;
  const progress = progressFor(dir);
  progress.active = true;
  progress.received = 0;
  progress.total = SUPERRES_FILE_SIZE;
  console.log(`[superres] Downloading Real-ESRGAN x2 weights (~64MB, ${SUPERRES_LICENSE}) from ${url}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}.`);
    const tmp = `${dest}.part-${process.pid}`;
    const file = await fs.open(tmp, "w");
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await file.write(value);
          progress.received += value.length;
        }
      }
    } finally {
      await file.close();
    }
    const stat = await fs.stat(tmp).catch(() => null);
    if (!stat || stat.size < SUPERRES_MIN_WEIGHT_BYTES) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error(`Model download incomplete (${stat?.size ?? 0} bytes).`);
    }
    await fs.rename(tmp, dest);
  } finally {
    progress.active = false;
  }
  console.log("[superres] Real-ESRGAN x2 weights ready.");
  return dest;
}

/** Weights + session warm; rejects on download/session failure (routes answer 503). */
export async function ensureSuperresReady(dataDir: string): Promise<void> {
  const dir = superresDir(dataDir);
  const pending = readyJobs.get(dir);
  if (pending) {
    await pending;
    return;
  }
  const job = (async (): Promise<void> => {
    const modelPath = await downloadWeights(dataDir);
    const mod = require("onnxruntime-node") as {
      InferenceSession: {
        create(
          p: string,
          o?: Record<string, unknown>,
        ): Promise<{
          run(f: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
          inputNames: string[];
          outputNames: string[];
        }>;
      };
    };
    if (!nodeSessions.has(modelPath)) {
      const session = await mod.InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
      // First input/output by session order (verified: input, output on
      // Real-ESRGAN x2) so URL overrides with renamed tensors still serve;
      // the 2x shape check below rejects non-upscaler models.
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      if (!inputName || !outputName) throw new Error("Super-resolution model exposes no input/output.");
      nodeSessions.set(modelPath, { run: (feeds) => session.run(feeds), inputName, outputName });
    }
    readyErrors.delete(dir);
  })();
  readyJobs.set(dir, job);
  try {
    await job;
  } catch (error) {
    readyErrors.set(dir, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    readyJobs.delete(dir);
  }
}

export function kickSuperresReady(dataDir: string): void {
  void ensureSuperresReady(dataDir).catch((error: unknown) => {
    console.error("[superres] Background readiness failed:", error instanceof Error ? error.message : error);
  });
}

export async function getSuperresHealth(dataDir: string): Promise<SuperresHealth> {
  const dir = superresDir(dataDir);
  const dest = path.join(dir, SUPERRES_FILE);
  const weightsReady = await filePresent(dest, SUPERRES_MIN_WEIGHT_BYTES);
  const sessionsWarm = nodeSessions.has(dest);
  const progress = downloadProgress.get(dir);
  const downloading = progress?.active ?? false;
  return {
    ok: true,
    ready: true,
    serving: true,
    weightsReady,
    sessionsWarm,
    downloading,
    downloadPct: downloading && progress && progress.total > 0 ? Math.min(1, progress.received / progress.total) : downloading ? 0 : 1,
    source: weightsReady && sessionsWarm ? "onnx" : "classic",
    model: { file: SUPERRES_FILE, bytes: SUPERRES_FILE_SIZE, license: SUPERRES_LICENSE, url: superresUrl() },
    error: readyErrors.get(dir) ?? null,
  };
}

export function validateSuperresBody(
  body: unknown,
): { ok: true; value: SuperresBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { width, height, imageB64 } = body as Record<string, unknown>;
  if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > SUPERRES_MAX_INPUT_DIM) {
    return { ok: false, error: "Invalid width." };
  }
  if (!Number.isInteger(height) || (height as number) < 1 || (height as number) > SUPERRES_MAX_INPUT_DIM) {
    return { ok: false, error: "Invalid height." };
  }
  const longEdge = Math.max(width as number, height as number);
  if (longEdge > SUPERRES_MAX_INPUT_DIM) {
    return { ok: false, error: `Upscale caps at ${SUPERRES_MAX_INPUT_DIM}px on the long edge — pick a smaller export size.` };
  }
  if (typeof imageB64 !== "string" || imageB64.length === 0) return { ok: false, error: "Missing image." };
  const expected = (width as number) * (height as number) * 4;
  if (expected > SUPERRES_MAX_BYTES) return { ok: false, error: "Image too large." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageB64, "base64");
  } catch {
    return { ok: false, error: "Invalid image encoding." };
  }
  if (bytes.length !== expected) return { ok: false, error: `Image bytes mismatch (got ${bytes.length}, expected ${expected}).` };
  return { ok: true, value: { width: width as number, height: height as number, imageB64 } };
}

function cropRgba(rgba: Uint8ClampedArray, width: number, x0: number, y0: number, x1: number, y1: number): PixelImage {
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const srcRow = ((y0 + y) * width + x0) * 4;
    data.set(rgba.subarray(srcRow, srcRow + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

async function runOnnxUpscale(
  modelPath: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Promise<SuperresResult | null> {
  try {
    const session = nodeSessions.get(modelPath);
    if (!session) return null;
    const mod = require("onnxruntime-node") as {
      Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
    };
    const plan = superresTilePlan(width, height);
    setJobProgress({ active: true, stage: "upscale", tile: 0, totalTiles: plan.length, startedAt: Date.now() });
    const outputs: PixelImage[] = [];
    for (const tile of plan) {
      const input = cropRgba(rgba, width, tile.px0, tile.py0, tile.px1, tile.py1);
      const packed = packSuperresInput(input);
      const results = await session.run({
        [session.inputName]: new mod.Tensor("float32", packed, [1, 3, input.height, input.width]),
      });
      const first = results[session.outputName]?.data as ArrayLike<number> | undefined;
      if (!first) return null;
      outputs.push(parseSuperresOutput(first, input));
      setJobProgress({ tile: outputs.length });
      if (plan.length > 1) console.log(`[superres] tile ${outputs.length}/${plan.length} done.`);
    }
    const stitched = stitchSuperresTiles(plan, outputs, width, height);
    const size = superresOutputSize(width, height);
    setJobProgress({ active: false, stage: "done" });
    return {
      imageB64: Buffer.from(stitched.data).toString("base64"),
      width: size.width,
      height: size.height,
      tiles: plan.length,
      source: "onnx",
    };
  } catch (error) {
    console.warn("[superres] ONNX upscale failed, using classical fallback:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function runSuperres(dataDir: string, body: SuperresBody): Promise<SuperresResult> {
  const bytes = Buffer.from(body.imageB64, "base64");
  const rgba = new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  // Opportunistic ONNX: warmed sessions upgrade the answer; every failure
  // falls through to the classical fallback so upscale never 503s for ML reasons.
  const modelPath = weightsPath(dataDir);
  if (nodeSessions.has(modelPath)) {
    const onnx = await runOnnxUpscale(modelPath, body.width, body.height, rgba);
    if (onnx) return onnx;
    resetSuperresProgress();
  }
  const upscaled = upscaleClassic2x({ width: body.width, height: body.height, data: rgba });
  return {
    imageB64: Buffer.from(upscaled.data).toString("base64"),
    width: upscaled.width,
    height: upscaled.height,
    tiles: 0,
    source: "classic",
  };
}
