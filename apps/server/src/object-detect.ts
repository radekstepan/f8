// Server-side object detection for one-click removal: detect → mask → inpaint.
//
// Like every neural path, detection runs here via onnxruntime-node, never in
// the browser. The client POSTs a downsampled crop and gets normalized person
// boxes back; it turns them into repair strokes (one stroke id per detection)
// that the existing ROI→inpaint pipeline heals — no new inference path.
//
// Weights (YOLOv8n ONNX, ~12MB, AGPL-3.0) download once into the model dir on
// first warmup. Until they land — offline, download disabled, ORT missing —
// the built-in classical skin-tone proposer serves instead, so detection
// never 503s for ML reasons; the response always names its source.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
import {
  OBJECT_DETECT_DEFAULT_URL,
  OBJECT_DETECT_FILE,
  OBJECT_DETECT_FILE_SIZE,
  OBJECT_DETECT_LABELS,
  OBJECT_DETECT_LICENSE,
  OBJECT_DETECT_SIZE,
  packObjectDetectInput,
  parseYoloDetections,
  proposePersonCandidates,
  type DetectedObject,
  type ObjectDetectLabel,
  type ObjectDetectSource,
} from "@f8/core";

export const OBJECT_DETECT_MODEL_DIR_SUFFIX = path.join("models", "object-detect");
export const OBJECT_DETECT_MAX_DIM = 2048;
/** Raw RGBA payload cap (~8MP); the client sends a ≤640px downsample. */
export const OBJECT_DETECT_MAX_BYTES = 2048 * 2048 * 4;
/** Minimum accepted weight file size (guards truncated downloads). */
const OBJECT_DETECT_MIN_WEIGHT_BYTES = 1024 * 1024;

export interface ObjectDetectHealth {
  ok: boolean;
  /** Always true: the classical fallback serves with no weights. */
  ready: boolean;
  serving: boolean;
  weightsReady: boolean;
  sessionsWarm: boolean;
  downloading: boolean;
  /** 0..1 across the pending weight file (1 when idle). */
  downloadPct: number;
  /** "onnx" once YOLO weights serve, else "classic". */
  source: ObjectDetectSource;
  model: { file: string; bytes: number; license: string; url: string };
  error: string | null;
}

export interface ObjectDetectBody {
  width: number;
  height: number;
  /** Base64 of raw RGBA bytes (width*height*4). */
  imageB64: string;
  /** Removal targets; v1 supports ["person"] only. */
  labels?: ObjectDetectLabel[];
}

export interface ObjectDetectResult {
  detections: DetectedObject[];
  source: ObjectDetectSource;
  width: number;
  height: number;
}

export function objectDetectDir(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env["F8_OBJECT_DETECT_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(dataDir, OBJECT_DETECT_MODEL_DIR_SUFFIX);
}

function objectDetectUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env["F8_OBJECT_DETECT_URL"];
  if (override && override.trim()) return override.trim();
  return OBJECT_DETECT_DEFAULT_URL;
}

function detectOffline(): boolean {
  return process.env["F8_OBJECT_DETECT_OFFLINE"] === "1";
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
  return path.join(objectDetectDir(dataDir), OBJECT_DETECT_FILE);
}

async function downloadWeights(dataDir: string): Promise<string> {
  if (!ortAvailable()) throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  if (detectOffline()) throw new Error("Object-detect provisioning is disabled (F8_OBJECT_DETECT_OFFLINE=1).");
  const url = objectDetectUrl();
  const dir = objectDetectDir(dataDir);
  const dest = path.join(dir, OBJECT_DETECT_FILE);
  if (await filePresent(dest, OBJECT_DETECT_MIN_WEIGHT_BYTES)) return dest;
  const progress = progressFor(dir);
  progress.active = true;
  progress.received = 0;
  progress.total = OBJECT_DETECT_FILE_SIZE;
  console.log(`[object-detect] Downloading YOLOv8n weights (~12MB, ${OBJECT_DETECT_LICENSE}) from ${url}`);
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
    if (!stat || stat.size < OBJECT_DETECT_MIN_WEIGHT_BYTES) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error(`Model download incomplete (${stat?.size ?? 0} bytes).`);
    }
    await fs.rename(tmp, dest);
  } finally {
    progress.active = false;
  }
  console.log("[object-detect] YOLOv8n weights ready.");
  return dest;
}

/** Weights + session warm; rejects on download/session failure (routes answer 503). */
export async function ensureObjectDetectReady(dataDir: string): Promise<void> {
  const dir = objectDetectDir(dataDir);
  const pending = readyJobs.get(dir);
  if (pending) {
    await pending;
    return;
  }
  const job = (async (): Promise<void> => {
    const modelPath = await downloadWeights(dataDir);
    const mod = require("onnxruntime-node") as {
      InferenceSession: { create(p: string, o?: Record<string, unknown>): Promise<{ run(f: Record<string, unknown>): Promise<Record<string, { data: unknown }>> }> };
    };
    if (!nodeSessions.has(modelPath)) {
      const session = await mod.InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
      nodeSessions.set(modelPath, session);
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

export function kickObjectDetectReady(dataDir: string): void {
  void ensureObjectDetectReady(dataDir).catch((error: unknown) => {
    console.error("[object-detect] Background readiness failed:", error instanceof Error ? error.message : error);
  });
}

export async function getObjectDetectHealth(dataDir: string): Promise<ObjectDetectHealth> {
  const dir = objectDetectDir(dataDir);
  const dest = path.join(dir, OBJECT_DETECT_FILE);
  const weightsReady = await filePresent(dest, OBJECT_DETECT_MIN_WEIGHT_BYTES);
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
    model: { file: OBJECT_DETECT_FILE, bytes: OBJECT_DETECT_FILE_SIZE, license: OBJECT_DETECT_LICENSE, url: objectDetectUrl() },
    error: readyErrors.get(dir) ?? null,
  };
}

export function validateDetectBody(body: unknown): { ok: true; value: ObjectDetectBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { width, height, imageB64, labels } = body as Record<string, unknown>;
  if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > OBJECT_DETECT_MAX_DIM) {
    return { ok: false, error: "Invalid width." };
  }
  if (!Number.isInteger(height) || (height as number) < 1 || (height as number) > OBJECT_DETECT_MAX_DIM) {
    return { ok: false, error: "Invalid height." };
  }
  if (typeof imageB64 !== "string" || imageB64.length === 0) return { ok: false, error: "Missing image." };
  const expected = (width as number) * (height as number) * 4;
  if (expected > OBJECT_DETECT_MAX_BYTES) return { ok: false, error: "Image too large." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageB64, "base64");
  } catch {
    return { ok: false, error: "Invalid image encoding." };
  }
  if (bytes.length !== expected) return { ok: false, error: `Image bytes mismatch (got ${bytes.length}, expected ${expected}).` };
  if (labels !== undefined) {
    if (!Array.isArray(labels) || labels.length === 0) return { ok: false, error: "Invalid labels." };
    for (const label of labels) {
      if (!(OBJECT_DETECT_LABELS as readonly string[]).includes(label as string)) {
        return { ok: false, error: `Unsupported label "${String(label)}" (v1 supports "person").` };
      }
    }
  }
  return {
    ok: true,
    value: { width: width as number, height: height as number, imageB64, ...(labels === undefined ? {} : { labels: labels as ObjectDetectLabel[] }) },
  };
}

async function runOnnxDetect(modelPath: string, width: number, height: number, rgba: Uint8ClampedArray): Promise<DetectedObject[] | null> {
  try {
    const session = nodeSessions.get(modelPath);
    if (!session) return null;
    const mod = require("onnxruntime-node") as {
      Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
    };
    const packed = packObjectDetectInput({ width, height, data: rgba });
    const size = OBJECT_DETECT_SIZE;
    const results = await session.run({ images: new mod.Tensor("float32", packed.data, [1, 3, size, size]) });
    const first = Object.values(results)[0]?.data as ArrayLike<number> | undefined;
    if (!first || first.length !== 84 * 8400) return null;
    return parseYoloDetections(first, packed.letterbox);
  } catch (error) {
    console.warn("[object-detect] ONNX detect failed, using classical fallback:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function runObjectDetect(dataDir: string, body: ObjectDetectBody): Promise<ObjectDetectResult> {
  const bytes = Buffer.from(body.imageB64, "base64");
  const rgba = new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  // Opportunistic ONNX: warmed sessions upgrade the answer; every failure
  // falls through to the classical proposer so detect never 503s for ML reasons.
  const modelPath = weightsPath(dataDir);
  if (nodeSessions.has(modelPath)) {
    const onnx = await runOnnxDetect(modelPath, body.width, body.height, rgba);
    if (onnx) {
      const wanted = new Set(body.labels ?? OBJECT_DETECT_LABELS);
      return { detections: onnx.filter((d) => wanted.has(d.label)), source: "onnx", width: body.width, height: body.height };
    }
  }
  const detections = proposePersonCandidates({ width: body.width, height: body.height, data: rgba });
  return { detections, source: "classic", width: body.width, height: body.height };
}
