// Server-side subject segmentation for ML selective (masked) adjustments:
// segment → mask → masked exposure/contrast/saturation.
//
// Like every neural path, segmentation runs here via onnxruntime-node, never
// in the browser. The client POSTs a downsampled crop and gets a soft
// subject mask back (base64 8-bit at <=160px long edge, ready to store in
// the recipe); it composites masked adjustments through the mask or its
// inverse for the subject/background target.
//
// Weights (U^2-Net portrait "u2netp" ONNX, ~4.6MB, Apache-2.0) download once
// into the model dir on first warmup. Until they land — offline, download
// disabled, ORT missing — the built-in classical proposer (face-box-derived
// head-and-shoulders, else center-prior skin saliency) serves instead, so
// segmentation never 503s for ML reasons; the response always names its
// source.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
import {
  SELECTIVE_MASK_DEFAULT_URL,
  SELECTIVE_MASK_FILE,
  SELECTIVE_MASK_FILE_SIZE,
  SELECTIVE_MASK_LICENSE,
  SELECTIVE_MASK_MAX_COVERAGE,
  SELECTIVE_MASK_MIN_COVERAGE,
  SELECTIVE_MASK_RECIPE_WIDTH,
  SELECTIVE_MASK_SIZE,
  downsampleSelectiveMask,
  encodeSelectiveMask,
  packSelectiveMaskInput,
  parseSelectiveMaskOutput,
  proposeClassicSubjectMask,
  proposeFaceCandidates,
  selectiveMaskCoverage,
  type SelectiveMaskSource,
} from "@f8/core";

export const SELECTIVE_MASK_MODEL_DIR_SUFFIX = path.join("models", "selective-mask");
export const SELECTIVE_MASK_MAX_DIM = 2048;
/** Raw RGBA payload cap (~8MP); the client sends a ≤320px downsample. */
export const SELECTIVE_MASK_MAX_BYTES = 2048 * 2048 * 4;
/** Minimum accepted weight file size (guards truncated downloads). */
const SELECTIVE_MASK_MIN_WEIGHT_BYTES = 1024 * 1024;

export interface SelectiveMaskHealth {
  ok: boolean;
  /** Always true: the classical fallback serves with no weights. */
  ready: boolean;
  serving: boolean;
  weightsReady: boolean;
  sessionsWarm: boolean;
  downloading: boolean;
  /** 0..1 across the pending weight file (1 when idle). */
  downloadPct: number;
  /** "onnx" once u2netp weights serve, else "classic". */
  source: SelectiveMaskSource;
  model: { file: string; bytes: number; license: string; url: string };
  error: string | null;
}

export interface SelectiveMaskBody {
  width: number;
  height: number;
  /** Base64 of raw RGBA bytes (width*height*4). */
  imageB64: string;
}

/** Stored-shape mask (<=160px long edge), ready for the recipe. */
export interface SelectiveMaskWire {
  maskB64: string;
  maskWidth: number;
  maskHeight: number;
}

export interface SelectiveMaskResult {
  /** Null when no usable subject was found (empty or full-frame mask). */
  mask: SelectiveMaskWire | null;
  /** Subject fraction 0..1 (reported even when the mask is null). */
  coverage: number;
  source: SelectiveMaskSource;
  width: number;
  height: number;
}

export function selectiveMaskDir(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env["F8_SELECTIVE_MASK_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(dataDir, SELECTIVE_MASK_MODEL_DIR_SUFFIX);
}

function selectiveMaskUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env["F8_SELECTIVE_MASK_URL"];
  if (override && override.trim()) return override.trim();
  return SELECTIVE_MASK_DEFAULT_URL;
}

function segmentOffline(): boolean {
  return process.env["F8_SELECTIVE_MASK_OFFLINE"] === "1";
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
  return path.join(selectiveMaskDir(dataDir), SELECTIVE_MASK_FILE);
}

/**
 * Ensure the u2netp weights exist on disk, downloading once when missing.
 * Shared by the warmup path and the `yarn setup` prefetch (fetch-models.ts).
 */
export async function ensureSelectiveMaskWeights(dataDir: string): Promise<string> {
  if (!ortAvailable()) throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  if (segmentOffline()) throw new Error("Selective-mask provisioning is disabled (F8_SELECTIVE_MASK_OFFLINE=1).");
  const url = selectiveMaskUrl();
  const dir = selectiveMaskDir(dataDir);
  const dest = path.join(dir, SELECTIVE_MASK_FILE);
  if (await filePresent(dest, SELECTIVE_MASK_MIN_WEIGHT_BYTES)) return dest;
  const progress = progressFor(dir);
  progress.active = true;
  progress.received = 0;
  progress.total = SELECTIVE_MASK_FILE_SIZE;
  console.log(`[selective-mask] Downloading u2netp weights (~4.6MB, ${SELECTIVE_MASK_LICENSE}) from ${url}`);
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
    if (!stat || stat.size < SELECTIVE_MASK_MIN_WEIGHT_BYTES) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error(`Model download incomplete (${stat?.size ?? 0} bytes).`);
    }
    await fs.rename(tmp, dest);
  } finally {
    progress.active = false;
  }
  console.log("[selective-mask] u2netp weights ready.");
  return dest;
}

/** Weights + session warm; rejects on download/session failure (routes answer 503). */
export async function ensureSelectiveMaskReady(dataDir: string): Promise<void> {
  const dir = selectiveMaskDir(dataDir);
  const pending = readyJobs.get(dir);
  if (pending) {
    await pending;
    return;
  }
  const job = (async (): Promise<void> => {
    const modelPath = await ensureSelectiveMaskWeights(dataDir);
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
      // First input/output by session order (verified: input.1, 1959 on
      // u2netp) so URL overrides with renamed tensors still serve; the
      // square-shape check below rejects non-mask models.
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      if (!inputName || !outputName) throw new Error("Segmentation model exposes no input/output.");
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

export function kickSelectiveMaskReady(dataDir: string): void {
  void ensureSelectiveMaskReady(dataDir).catch((error: unknown) => {
    console.error("[selective-mask] Background readiness failed:", error instanceof Error ? error.message : error);
  });
}

export async function getSelectiveMaskHealth(dataDir: string): Promise<SelectiveMaskHealth> {
  const dir = selectiveMaskDir(dataDir);
  const dest = path.join(dir, SELECTIVE_MASK_FILE);
  const weightsReady = await filePresent(dest, SELECTIVE_MASK_MIN_WEIGHT_BYTES);
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
    model: { file: SELECTIVE_MASK_FILE, bytes: SELECTIVE_MASK_FILE_SIZE, license: SELECTIVE_MASK_LICENSE, url: selectiveMaskUrl() },
    error: readyErrors.get(dir) ?? null,
  };
}

export function validateSelectiveMaskBody(body: unknown): { ok: true; value: SelectiveMaskBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { width, height, imageB64 } = body as Record<string, unknown>;
  if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > SELECTIVE_MASK_MAX_DIM) {
    return { ok: false, error: "Invalid width." };
  }
  if (!Number.isInteger(height) || (height as number) < 1 || (height as number) > SELECTIVE_MASK_MAX_DIM) {
    return { ok: false, error: "Invalid height." };
  }
  if (typeof imageB64 !== "string" || imageB64.length === 0) return { ok: false, error: "Missing image." };
  const expected = (width as number) * (height as number) * 4;
  if (expected > SELECTIVE_MASK_MAX_BYTES) return { ok: false, error: "Image too large." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageB64, "base64");
  } catch {
    return { ok: false, error: "Invalid image encoding." };
  }
  if (bytes.length !== expected) return { ok: false, error: `Image bytes mismatch (got ${bytes.length}, expected ${expected}).` };
  return { ok: true, value: { width: width as number, height: height as number, imageB64 } };
}

function toWireMask(
  mask: { width: number; height: number; data: Float32Array },
): { wire: SelectiveMaskWire; coverage: number } | null {
  const coverage = selectiveMaskCoverage(mask);
  if (coverage < SELECTIVE_MASK_MIN_COVERAGE || coverage > SELECTIVE_MASK_MAX_COVERAGE) return null;
  const stored = downsampleSelectiveMask(mask, SELECTIVE_MASK_RECIPE_WIDTH);
  return {
    wire: { maskB64: encodeSelectiveMask(stored), maskWidth: stored.width, maskHeight: stored.height },
    coverage,
  };
}

async function runOnnxSegment(
  modelPath: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Promise<{ wire: SelectiveMaskWire; coverage: number } | { empty: true; coverage: number } | null> {
  try {
    const session = nodeSessions.get(modelPath);
    if (!session) return null;
    const mod = require("onnxruntime-node") as {
      Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
    };
    const packed = packSelectiveMaskInput({ width, height, data: rgba });
    const size = SELECTIVE_MASK_SIZE;
    const results = await session.run({ [session.inputName]: new mod.Tensor("float32", packed.data, [1, 3, size, size]) });
    const first = results[session.outputName]?.data as ArrayLike<number> | undefined;
    if (!first) return null;
    const outWidth = Math.min(width, SELECTIVE_MASK_RECIPE_WIDTH * 2);
    const outHeight = Math.max(1, Math.round((outWidth * height) / width));
    const mask = parseSelectiveMaskOutput(first, outWidth, outHeight);
    const coverage = selectiveMaskCoverage(mask);
    const wired = toWireMask(mask);
    if (!wired) return { empty: true, coverage };
    return wired;
  } catch (error) {
    console.warn("[selective-mask] ONNX segment failed, using classical fallback:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function runSelectiveMaskDetect(dataDir: string, body: SelectiveMaskBody): Promise<SelectiveMaskResult> {
  const bytes = Buffer.from(body.imageB64, "base64");
  const rgba = new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  // Opportunistic ONNX: warmed sessions upgrade the answer; every failure
  // falls through to the classical proposer so detect never 503s for ML reasons.
  const modelPath = weightsPath(dataDir);
  if (nodeSessions.has(modelPath)) {
    const onnx = await runOnnxSegment(modelPath, body.width, body.height, rgba);
    if (onnx) {
      if ("empty" in onnx) {
        return { mask: null, coverage: onnx.coverage, source: "onnx", width: body.width, height: body.height };
      }
      return { mask: onnx.wire, coverage: onnx.coverage, source: "onnx", width: body.width, height: body.height };
    }
  }
  const faces = proposeFaceCandidates({ width: body.width, height: body.height, data: rgba });
  const classic = proposeClassicSubjectMask({ width: body.width, height: body.height, data: rgba }, faces);
  if (!classic) {
    return { mask: null, coverage: 0, source: "classic", width: body.width, height: body.height };
  }
  const wired = toWireMask(classic);
  if (!wired) {
    return { mask: null, coverage: selectiveMaskCoverage(classic), source: "classic", width: body.width, height: body.height };
  }
  return { mask: wired.wire, coverage: wired.coverage, source: "classic", width: body.width, height: body.height };
}
