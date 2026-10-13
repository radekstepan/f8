// Server-side lightweight denoise for high-ISO shots: downsampled preview
// first, full working-res apply on demand.
//
// Like every neural path, the learned denoiser (DnCNN color-blind ONNX,
// ~2.6MB) runs here via onnxruntime-node, never in the browser. The client
// POSTs pixels and gets denoised pixels back (raw RGBA base64): /preview
// is capped at a 512px downsample (~1s on CPU) for the Inspector's
// before/after, /apply runs up to 2048px (~9s) for the canvas and export.
// Strength blends server-side, so preview and apply match exactly.
//
// Weights download once into the model dir on first warmup. Until they
// land — offline, download disabled, ORT missing — the built-in classical
// fallback (luminance bilateral + chroma smoothing) serves instead, so
// denoise never 503s for ML reasons; the response always names its source.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
import {
  DENOISE_DEFAULT_URL,
  DENOISE_FILE,
  DENOISE_FILE_SIZE,
  DENOISE_LICENSE,
  DENOISE_MAX_DIM,
  DENOISE_PREVIEW_WIDTH,
  denoiseClassic,
  packDenoiseInput,
  parseDenoiseOutput,
  type DenoiseSource,
} from "@f8/core";

export const DENOISE_MODEL_DIR_SUFFIX = path.join("models", "denoise");
/** Raw RGBA payload cap (~16MP); the client sends ≤512px previews / ≤2048px applies. */
export const DENOISE_MAX_BYTES = 2048 * 2048 * 4;
/** Minimum accepted weight file size (guards truncated downloads). */
const DENOISE_MIN_WEIGHT_BYTES = 1024 * 1024;

export interface DenoiseHealth {
  ok: boolean;
  /** Always true: the classical fallback serves with no weights. */
  ready: boolean;
  serving: boolean;
  weightsReady: boolean;
  sessionsWarm: boolean;
  downloading: boolean;
  /** 0..1 across the pending weight file (1 when idle). */
  downloadPct: number;
  /** "onnx" once DnCNN weights serve, else "classic". */
  source: DenoiseSource;
  model: { file: string; bytes: number; license: string; url: string };
  error: string | null;
}

export interface DenoiseBody {
  width: number;
  height: number;
  /** Base64 of raw RGBA bytes (width*height*4). */
  imageB64: string;
  /** Denoise strength 0..100 (blended server-side). */
  strength: number;
}

export interface DenoiseResult {
  /** Base64 of denoised raw RGBA bytes (width*height*4). */
  imageB64: string;
  width: number;
  height: number;
  strength: number;
  source: DenoiseSource;
}

export function denoiseDir(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env["F8_DENOISE_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(dataDir, DENOISE_MODEL_DIR_SUFFIX);
}

function denoiseUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env["F8_DENOISE_URL"];
  if (override && override.trim()) return override.trim();
  return DENOISE_DEFAULT_URL;
}

function denoiseOffline(): boolean {
  return process.env["F8_DENOISE_OFFLINE"] === "1";
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
  return path.join(denoiseDir(dataDir), DENOISE_FILE);
}

/**
 * Ensure the DnCNN weights exist on disk, downloading once when missing.
 * Shared by the warmup path and the `yarn setup` prefetch (fetch-models.ts).
 */
export async function ensureDenoiseWeights(dataDir: string): Promise<string> {
  if (!ortAvailable()) throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  if (denoiseOffline()) throw new Error("Denoise provisioning is disabled (F8_DENOISE_OFFLINE=1).");
  const url = denoiseUrl();
  const dir = denoiseDir(dataDir);
  const dest = path.join(dir, DENOISE_FILE);
  if (await filePresent(dest, DENOISE_MIN_WEIGHT_BYTES)) return dest;
  const progress = progressFor(dir);
  progress.active = true;
  progress.received = 0;
  progress.total = DENOISE_FILE_SIZE;
  console.log(`[denoise] Downloading DnCNN weights (~2.6MB, ${DENOISE_LICENSE}) from ${url}`);
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
    if (!stat || stat.size < DENOISE_MIN_WEIGHT_BYTES) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error(`Model download incomplete (${stat?.size ?? 0} bytes).`);
    }
    await fs.rename(tmp, dest);
  } finally {
    progress.active = false;
  }
  console.log("[denoise] DnCNN weights ready.");
  return dest;
}

/** Weights + session warm; rejects on download/session failure (routes answer 503). */
export async function ensureDenoiseReady(dataDir: string): Promise<void> {
  const dir = denoiseDir(dataDir);
  const pending = readyJobs.get(dir);
  if (pending) {
    await pending;
    return;
  }
  const job = (async (): Promise<void> => {
    const modelPath = await ensureDenoiseWeights(dataDir);
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
      // DnCNN) so URL overrides with renamed tensors still serve; the
      // 3-plane shape check below rejects non-denoiser models.
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      if (!inputName || !outputName) throw new Error("Denoise model exposes no input/output.");
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

export function kickDenoiseReady(dataDir: string): void {
  void ensureDenoiseReady(dataDir).catch((error: unknown) => {
    console.error("[denoise] Background readiness failed:", error instanceof Error ? error.message : error);
  });
}

export async function getDenoiseHealth(dataDir: string): Promise<DenoiseHealth> {
  const dir = denoiseDir(dataDir);
  const dest = path.join(dir, DENOISE_FILE);
  const weightsReady = await filePresent(dest, DENOISE_MIN_WEIGHT_BYTES);
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
    model: { file: DENOISE_FILE, bytes: DENOISE_FILE_SIZE, license: DENOISE_LICENSE, url: denoiseUrl() },
    error: readyErrors.get(dir) ?? null,
  };
}

export type DenoiseRoute = "preview" | "apply";

export function validateDenoiseBody(
  body: unknown,
  route: DenoiseRoute = "apply",
): { ok: true; value: DenoiseBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { width, height, imageB64, strength } = body as Record<string, unknown>;
  if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > DENOISE_MAX_DIM) {
    return { ok: false, error: "Invalid width." };
  }
  if (!Number.isInteger(height) || (height as number) < 1 || (height as number) > DENOISE_MAX_DIM) {
    return { ok: false, error: "Invalid height." };
  }
  // The preview route only accepts downsamples: the downsample-first flow
  // is enforced by the API, not just the client. Apply shares the global
  // 2048px ceiling (DENOISE_APPLY_WIDTH), enforced by the width/height
  // checks above.
  const longEdge = Math.max(width as number, height as number);
  if (route === "preview" && longEdge > DENOISE_PREVIEW_WIDTH) {
    return { ok: false, error: `Preview accepts downsamples up to ${DENOISE_PREVIEW_WIDTH}px — use apply for full resolution.` };
  }
  if (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0 || strength > 100) {
    return { ok: false, error: "Invalid strength (0..100)." };
  }
  if (typeof imageB64 !== "string" || imageB64.length === 0) return { ok: false, error: "Missing image." };
  const expected = (width as number) * (height as number) * 4;
  if (expected > DENOISE_MAX_BYTES) return { ok: false, error: "Image too large." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageB64, "base64");
  } catch {
    return { ok: false, error: "Invalid image encoding." };
  }
  if (bytes.length !== expected) return { ok: false, error: `Image bytes mismatch (got ${bytes.length}, expected ${expected}).` };
  return { ok: true, value: { width: width as number, height: height as number, imageB64, strength } };
}

async function runOnnxDenoise(
  modelPath: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  strength: number,
): Promise<DenoiseResult | null> {
  try {
    const session = nodeSessions.get(modelPath);
    if (!session) return null;
    const mod = require("onnxruntime-node") as {
      Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
    };
    const packed = packDenoiseInput({ width, height, data: rgba });
    const results = await session.run({ [session.inputName]: new mod.Tensor("float32", packed, [1, 3, height, width]) });
    const first = results[session.outputName]?.data as ArrayLike<number> | undefined;
    if (!first) return null;
    const denoised = parseDenoiseOutput(first, { width, height, data: rgba }, strength);
    return {
      imageB64: Buffer.from(denoised.data).toString("base64"),
      width,
      height,
      strength,
      source: "onnx",
    };
  } catch (error) {
    console.warn("[denoise] ONNX denoise failed, using classical fallback:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function runDenoise(dataDir: string, body: DenoiseBody): Promise<DenoiseResult> {
  const bytes = Buffer.from(body.imageB64, "base64");
  const rgba = new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  // Opportunistic ONNX: warmed sessions upgrade the answer; every failure
  // falls through to the classical fallback so denoise never 503s for ML reasons.
  const modelPath = weightsPath(dataDir);
  if (nodeSessions.has(modelPath)) {
    const onnx = await runOnnxDenoise(modelPath, body.width, body.height, rgba, body.strength);
    if (onnx) return onnx;
  }
  const denoised = denoiseClassic({ width: body.width, height: body.height, data: rgba }, body.strength);
  return {
    imageB64: Buffer.from(denoised.data).toString("base64"),
    width: body.width,
    height: body.height,
    strength: body.strength,
    source: "classic",
  };
}
