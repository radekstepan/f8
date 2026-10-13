// Server-side face detection for ML face-aware exposure: detect → correct.
//
// Like every neural path, detection runs here via onnxruntime-node, never in
// the browser. The client POSTs a downsampled crop and gets normalized face
// boxes with eye landmarks back; it anchors white balance on the skin tones
// inside the boxes, lifts underexposed faces through a masked exposure
// recipe, and suppresses red-eye pupils around the landmarks.
//
// Weights (YuNet 2023mar ONNX, ~227KB, Apache-2.0) download once into the
// model dir on first warmup. Until they land — offline, download disabled,
// ORT missing — the built-in classical skin-tone proposer serves instead, so
// detection never 503s for ML reasons; the response always names its source.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
import {
  FACE_DETECT_DEFAULT_URL,
  FACE_DETECT_FILE,
  FACE_DETECT_FILE_SIZE,
  FACE_DETECT_LICENSE,
  FACE_DETECT_SIZE,
  FACE_DETECT_STRIDES,
  packFaceDetectInput,
  parseYuNetFaces,
  proposeFaceCandidates,
  type DetectedFace,
  type FaceDetectSource,
} from "@f8/core";

export const FACE_DETECT_MODEL_DIR_SUFFIX = path.join("models", "face-detect");
export const FACE_DETECT_MAX_DIM = 2048;
/** Raw RGBA payload cap (~8MP); the client sends a ≤640px downsample. */
export const FACE_DETECT_MAX_BYTES = 2048 * 2048 * 4;
/** Minimum accepted weight file size (guards truncated downloads). */
const FACE_DETECT_MIN_WEIGHT_BYTES = 100 * 1024;

export interface FaceDetectHealth {
  ok: boolean;
  /** Always true: the classical fallback serves with no weights. */
  ready: boolean;
  serving: boolean;
  weightsReady: boolean;
  sessionsWarm: boolean;
  downloading: boolean;
  /** 0..1 across the pending weight file (1 when idle). */
  downloadPct: number;
  /** "onnx" once YuNet weights serve, else "classic". */
  source: FaceDetectSource;
  model: { file: string; bytes: number; license: string; url: string };
  error: string | null;
}

export interface FaceDetectBody {
  width: number;
  height: number;
  /** Base64 of raw RGBA bytes (width*height*4). */
  imageB64: string;
}

export interface FaceDetectResult {
  faces: DetectedFace[];
  source: FaceDetectSource;
  width: number;
  height: number;
}

export function faceDetectDir(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env["F8_FACE_DETECT_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(dataDir, FACE_DETECT_MODEL_DIR_SUFFIX);
}

function faceDetectUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env["F8_FACE_DETECT_URL"];
  if (override && override.trim()) return override.trim();
  return FACE_DETECT_DEFAULT_URL;
}

function detectOffline(): boolean {
  return process.env["F8_FACE_DETECT_OFFLINE"] === "1";
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
  return path.join(faceDetectDir(dataDir), FACE_DETECT_FILE);
}

/**
 * Ensure the YuNet weights exist on disk, downloading once when missing.
 * Shared by the warmup path and the `yarn setup` prefetch (fetch-models.ts).
 */
export async function ensureFaceDetectWeights(dataDir: string): Promise<string> {
  if (!ortAvailable()) throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  if (detectOffline()) throw new Error("Face-detect provisioning is disabled (F8_FACE_DETECT_OFFLINE=1).");
  const url = faceDetectUrl();
  const dir = faceDetectDir(dataDir);
  const dest = path.join(dir, FACE_DETECT_FILE);
  if (await filePresent(dest, FACE_DETECT_MIN_WEIGHT_BYTES)) return dest;
  const progress = progressFor(dir);
  progress.active = true;
  progress.received = 0;
  progress.total = FACE_DETECT_FILE_SIZE;
  console.log(`[face-detect] Downloading YuNet weights (~227KB, ${FACE_DETECT_LICENSE}) from ${url}`);
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
    if (!stat || stat.size < FACE_DETECT_MIN_WEIGHT_BYTES) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error(`Model download incomplete (${stat?.size ?? 0} bytes).`);
    }
    await fs.rename(tmp, dest);
  } finally {
    progress.active = false;
  }
  console.log("[face-detect] YuNet weights ready.");
  return dest;
}

/** Weights + session warm; rejects on download/session failure (routes answer 503). */
export async function ensureFaceDetectReady(dataDir: string): Promise<void> {
  const dir = faceDetectDir(dataDir);
  const pending = readyJobs.get(dir);
  if (pending) {
    await pending;
    return;
  }
  const job = (async (): Promise<void> => {
    const modelPath = await ensureFaceDetectWeights(dataDir);
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

export function kickFaceDetectReady(dataDir: string): void {
  void ensureFaceDetectReady(dataDir).catch((error: unknown) => {
    console.error("[face-detect] Background readiness failed:", error instanceof Error ? error.message : error);
  });
}

export async function getFaceDetectHealth(dataDir: string): Promise<FaceDetectHealth> {
  const dir = faceDetectDir(dataDir);
  const dest = path.join(dir, FACE_DETECT_FILE);
  const weightsReady = await filePresent(dest, FACE_DETECT_MIN_WEIGHT_BYTES);
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
    model: { file: FACE_DETECT_FILE, bytes: FACE_DETECT_FILE_SIZE, license: FACE_DETECT_LICENSE, url: faceDetectUrl() },
    error: readyErrors.get(dir) ?? null,
  };
}

export function validateFaceDetectBody(body: unknown): { ok: true; value: FaceDetectBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request." };
  const { width, height, imageB64 } = body as Record<string, unknown>;
  if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > FACE_DETECT_MAX_DIM) {
    return { ok: false, error: "Invalid width." };
  }
  if (!Number.isInteger(height) || (height as number) < 1 || (height as number) > FACE_DETECT_MAX_DIM) {
    return { ok: false, error: "Invalid height." };
  }
  if (typeof imageB64 !== "string" || imageB64.length === 0) return { ok: false, error: "Missing image." };
  const expected = (width as number) * (height as number) * 4;
  if (expected > FACE_DETECT_MAX_BYTES) return { ok: false, error: "Image too large." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageB64, "base64");
  } catch {
    return { ok: false, error: "Invalid image encoding." };
  }
  if (bytes.length !== expected) return { ok: false, error: `Image bytes mismatch (got ${bytes.length}, expected ${expected}).` };
  return { ok: true, value: { width: width as number, height: height as number, imageB64 } };
}

async function runOnnxDetect(modelPath: string, width: number, height: number, rgba: Uint8ClampedArray): Promise<DetectedFace[] | null> {
  try {
    const session = nodeSessions.get(modelPath);
    if (!session) return null;
    const mod = require("onnxruntime-node") as {
      Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
    };
    const packed = packFaceDetectInput({ width, height, data: rgba });
    const size = FACE_DETECT_SIZE;
    const results = await session.run({ input: new mod.Tensor("float32", packed.data, [1, 3, size, size]) });
    const strides = [...FACE_DETECT_STRIDES];
    const head = (kind: string, stride: number): ArrayLike<number> | undefined =>
      results[`${kind}_${stride}`]?.data as ArrayLike<number> | undefined;
    const cls = strides.map((s) => head("cls", s));
    const obj = strides.map((s) => head("obj", s));
    const bbox = strides.map((s) => head("bbox", s));
    const kps = strides.map((s) => head("kps", s));
    if ([...cls, ...obj, ...bbox, ...kps].some((h) => !h)) return null;
    return parseYuNetFaces(
      { cls: cls as ArrayLike<number>[], obj: obj as ArrayLike<number>[], bbox: bbox as ArrayLike<number>[], kps: kps as ArrayLike<number>[] },
      packed.geometry,
    );
  } catch (error) {
    console.warn("[face-detect] ONNX detect failed, using classical fallback:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function runFaceDetect(dataDir: string, body: FaceDetectBody): Promise<FaceDetectResult> {
  const bytes = Buffer.from(body.imageB64, "base64");
  const rgba = new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  // Opportunistic ONNX: warmed sessions upgrade the answer; every failure
  // falls through to the classical proposer so detect never 503s for ML reasons.
  const modelPath = weightsPath(dataDir);
  if (nodeSessions.has(modelPath)) {
    const onnx = await runOnnxDetect(modelPath, body.width, body.height, rgba);
    if (onnx) {
      return { faces: onnx, source: "onnx", width: body.width, height: body.height };
    }
  }
  const faces = proposeFaceCandidates({ width: body.width, height: body.height, data: rgba });
  return { faces, source: "classic", width: body.width, height: body.height };
}
