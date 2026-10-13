// Server-side straighten fallback: runs when the on-device Hough vote
// reports low confidence. Every neural engine for heal runs here via
// onnxruntime-node, so the straighten ML fallback lives here too.
//
// Today this serves a built-in Sobel gradient vote (OpenCV-free, pure TS in
// @f8/core) which complements Hough: long segments vs all strong
// horizontal edges. The module is ML-ready: when STRAIGHTEN_ML weights are
// published, drop `straighten_regressor.onnx` into the model dir (or set
// F8_STRAIGHTEN_ML_URL) and estimates upgrade to `source: "onnx"`
// with zero client changes. Health/warmup/download polling mirrors ml-heal
// so the client reuses the same progress UI.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
import {
  STRAIGHTEN_ML_FILE,
  estimateStraightenGradient,
  packStraightenInput,
  parseStraightenOutput,
} from "@f8/core";

export const STRAIGHTEN_ML_MODEL_DIR_SUFFIX = path.join("models", "straighten-ml");
export const STRAIGHTEN_ML_MAX_DIM = 2048;
/** Raw RGBA payload cap (~8MP): the client sends a ≤512px downsample. */
export const STRAIGHTEN_ML_MAX_BYTES = 2048 * 2048 * 4;

export interface StraightenHealth {
  ok: boolean;
  /** Always true: the gradient fallback serves with no weights. */
  ready: boolean;
  serving: boolean;
  weightsReady: boolean;
  sessionsWarm: boolean;
  downloading: boolean;
  /** 0..1 across the pending weight file (1 when idle). */
  downloadPct: number;
  /** "onnx" once regressor weights serve, else "gradient". */
  source: "onnx" | "gradient";
  error: string | null;
}

export interface StraightenEstimateBody {
  width: number;
  height: number;
  /** Base64 of raw RGBA bytes (width*height*4). */
  imageB64: string;
}

export function straightenMlDir(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env["F8_STRAIGHTEN_ML_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(dataDir, STRAIGHTEN_ML_MODEL_DIR_SUFFIX);
}

/** Configured regressor weight URL, or null when unpublished (the default). Exported for the `yarn setup` prefetch. */
export function straightenMlUrl(env: Record<string, string | undefined> = process.env): string | null {
  const override = env["F8_STRAIGHTEN_ML_URL"];
  if (override !== undefined) return override.trim() ? override.trim() : null;
  // No published default yet: gradient fallback serves until weights land.
  return null;
}

function straightenOffline(): boolean {
  return process.env["F8_STRAIGHTEN_ML_OFFLINE"] === "1";
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

const readyErrors = new Map<string, string>();
const readyJobs = new Map<string, Promise<void>>();
const nodeSessions = new Map<string, { run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>> }>();

function weightsPath(dataDir: string): string {
  return path.join(straightenMlDir(dataDir), STRAIGHTEN_ML_FILE);
}

/**
 * Ensure the tilt-regressor weights exist on disk, downloading once when
 * missing. Rejects when no weight URL is configured (the default: weights
 * are unpublished, so the prefetch skips this entry). Shared by the warmup
 * path and the `yarn setup` prefetch (fetch-models.ts).
 */
export async function ensureStraightenWeights(dataDir: string): Promise<string> {
  const url = straightenMlUrl();
  if (!url) throw new Error("Straighten ML weights are not published yet (no URL configured).");
  if (straightenOffline()) throw new Error("Straighten provisioning is disabled (F8_STRAIGHTEN_ML_OFFLINE=1).");
  if (!ortAvailable()) throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  const dir = straightenMlDir(dataDir);
  const dest = path.join(dir, STRAIGHTEN_ML_FILE);
  if (await filePresent(dest, 1024 * 1024)) return dest;
  const progress = progressFor(dir);
  progress.active = true;
  progress.received = 0;
  progress.total = 15 * 1024 * 1024;
  console.log(`[straighten-ml] Downloading weights from ${url}`);
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
    if (!stat || stat.size < 1024 * 1024) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error(`Model download incomplete (${stat?.size ?? 0} bytes).`);
    }
    await fs.rename(tmp, dest);
  } finally {
    progress.active = false;
  }
  return dest;
}

/** Weights + session warm. No URL configured → no-op (gradient serves). */
export async function ensureStraightenReady(dataDir: string): Promise<void> {
  const dir = straightenMlDir(dataDir);
  const key = dir;
  const pending = readyJobs.get(key);
  if (pending) {
    await pending;
    return;
  }
  const job = (async (): Promise<void> => {
    const url = straightenMlUrl();
    if (!url) return;
    const modelPath = await ensureStraightenWeights(dataDir);
    if (!ortAvailable()) throw new Error("onnxruntime-node is not installed.");
    const mod = require("onnxruntime-node") as {
      InferenceSession: { create(p: string, o?: Record<string, unknown>): Promise<{ run(f: Record<string, unknown>): Promise<Record<string, { data: unknown }>> }> };
    };
    if (!nodeSessions.has(modelPath)) {
      const session = await mod.InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
      nodeSessions.set(modelPath, session);
    }
    readyErrors.delete(key);
  })();
  readyJobs.set(key, job);
  try {
    await job;
  } catch (error) {
    readyErrors.set(key, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    readyJobs.delete(key);
  }
}

export function kickStraightenReady(dataDir: string): void {
  void ensureStraightenReady(dataDir).catch((error: unknown) => {
    console.error("[straighten-ml] Background readiness failed:", error instanceof Error ? error.message : error);
  });
}

export async function getStraightenHealth(dataDir: string): Promise<StraightenHealth> {
  const dir = straightenMlDir(dataDir);
  const dest = path.join(dir, STRAIGHTEN_ML_FILE);
  const weightsReady = await filePresent(dest, 1024 * 1024);
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
    source: weightsReady && sessionsWarm ? "onnx" : "gradient",
    error: readyErrors.get(dir) ?? null,
  };
}

export function validateStraightenBody(body: unknown): { ok: true; value: StraightenEstimateBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { width, height, imageB64 } = body as Record<string, unknown>;
  if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > STRAIGHTEN_ML_MAX_DIM) {
    return { ok: false, error: "Invalid width." };
  }
  if (!Number.isInteger(height) || (height as number) < 1 || (height as number) > STRAIGHTEN_ML_MAX_DIM) {
    return { ok: false, error: "Invalid height." };
  }
  if (typeof imageB64 !== "string" || imageB64.length === 0) return { ok: false, error: "Missing image." };
  const expected = (width as number) * (height as number) * 4;
  if (expected > STRAIGHTEN_ML_MAX_BYTES) return { ok: false, error: "Image too large." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageB64, "base64");
  } catch {
    return { ok: false, error: "Invalid image encoding." };
  }
  if (bytes.length !== expected) return { ok: false, error: `Image bytes mismatch (got ${bytes.length}, expected ${expected}).` };
  return { ok: true, value: { width: width as number, height: height as number, imageB64 } };
}

async function runOnnxEstimate(modelPath: string, width: number, height: number, rgba: Uint8ClampedArray): Promise<{ angle: number; confidence: number } | null> {
  try {
    const session = nodeSessions.get(modelPath);
    if (!session) return null;
    const mod = require("onnxruntime-node") as {
      Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
    };
    const packed = packStraightenInput({ width, height, data: rgba });
    const results = await session.run({ input: new mod.Tensor("float32", packed, [1, 3, 224, 224]) });
    const first = Object.values(results)[0]?.data as ArrayLike<number> | undefined;
    if (!first || first.length < 1) return null;
    const angle = Number(first[0]);
    const spread = first.length > 1 ? Number(first[1]) : 0;
    return parseStraightenOutput(angle, Number.isFinite(spread) ? Math.abs(spread) : 0);
  } catch (error) {
    console.warn("[straighten-ml] ONNX estimate failed, using gradient fallback:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function runStraightenEstimate(
  dataDir: string,
  body: StraightenEstimateBody,
): Promise<{ angle: number; confidence: number; source: "onnx" | "gradient" }> {
  const bytes = Buffer.from(body.imageB64, "base64");
  const rgba = new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  // Opportunistic ONNX: warmed sessions upgrade the answer; every failure
  // falls through to the gradient vote so estimates never 503 for ML reasons.
  const modelPath = weightsPath(dataDir);
  if (nodeSessions.has(modelPath)) {
    const onnx = await runOnnxEstimate(modelPath, body.width, body.height, rgba);
    if (onnx) return { ...onnx, source: "onnx" };
  }
  const vote = estimateStraightenGradient({ width: body.width, height: body.height, data: rgba });
  return { ...vote, source: "gradient" };
}
