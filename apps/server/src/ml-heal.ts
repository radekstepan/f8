// Server-side ML heal: every neural engine runs here, never in the browser.
//
// The browser paths hung multi-area jobs (WebGPU VAE-encode buffer failures,
// poisoned sessions, heartbeats re-arming the sliding timeout forever), so
// all ML tiers are server-required: the web client POSTs a square ROI crop
// and this module returns a 512x512 model output (0..255 RGB) that the client
// composites with the existing compositeMlHealOutput.
//
// Engines, same contract:
// - lama-remote (Balanced): single-pass LaMa via onnxruntime-node CPU.
//   Weights (~208MB) download once into the model dir on first use.
// - moebius-remote (Best): full diffusion via onnxruntime-node CPU when the
//   three .onnx weights are present in the model dir (manual drop).
// - remote-fallback: exemplar healRepair at 512 when Moebius weights are
//   absent, so Best never hangs. Health reports which engine will serve.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
import {
  ML_HEAL_LAMA_DEFAULT_URL,
  ML_HEAL_MOEBIUS_DEFAULT_BASE,
  ML_HEAL_MOEBIUS_FILE_SIZES,
  ML_HEAL_MOEBIUS_FILES,
  MOEBIUS_GUIDANCE,
  MOEBIUS_PREVIEW_INFERENCE_STEPS,
  MOEBIUS_SEED,
  MOEBIUS_STRENGTH,
  MOEBIUS_VAE_SCALE,
  downsampleMaskToLatent,
  makeSeededGaussian,
  maskMlHealInputForEncode,
  moebiusAlphasCumprod,
  moebiusBetas,
  moebiusTimesteps,
  packMlHealInput,
  seedMoebiusLatents,
  type MlHealRoi,
} from "@photomator/core";
import { MOEBIUS_LATENT_SIZE } from "@photomator/core";

export const ML_HEAL_MODEL_DIR_SUFFIX = path.join("models", "ml-heal");
export const ML_HEAL_ROI_MAX_SIZE = 2048;
export const ML_HEAL_LAMA_FILE = "lama_fp32.onnx";
const ML_HEAL_512 = 512;

export type RemoteHealEngine = "lama" | "moebius";

export interface MlHealHealth {
  ok: boolean;
  ready: boolean;
  ortAvailable: boolean;
  lamaReady: boolean;
  lamaCached: boolean;
  moebiusReady: boolean;
  modelsCached: boolean;
  device: string;
  detail: string;
  engines: Record<RemoteHealEngine, EngineReadiness>;
}

/** Live provisioning state for one engine: weights download + session warm. */
export interface EngineReadiness {
  weightsReady: boolean;
  sessionsWarm: boolean;
  /** True when this engine can serve inference right now. */
  serving: boolean;
  downloading: boolean;
  /** 0..1 across all pending files (1 when nothing pending). */
  downloadPct: number;
  error: string | null;
}

export interface RemoteInpaintBody {
  /** Neural engine: "lama" (Balanced) or "moebius" (Best). Defaults to "moebius". */
  engine?: RemoteHealEngine;
  roi: MlHealRoi;
  srcWidth: number;
  srcHeight: number;
  /** Base64 of raw ROI RGBA bytes (size*size*4). */
  imageB64: string;
  /** Base64 of raw ROI mask bytes (size*size, 0 = keep). */
  maskB64: string;
  steps?: number;
  seed?: number;
}

export function mlHealDir(dataDir: string, env: Record<string, string | undefined> = process.env): string {
  const override = env["PHOTOMATOR_ML_HEAL_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(dataDir, ML_HEAL_MODEL_DIR_SUFFIX);
}

/**
 * Default Moebius diffusion steps when the client sends none. Fewer steps is
 * a near-linear speedup of the denoise loop (~3.7s/step on M1 Pro), at some
 * quality cost. Out-of-range values fall back to the preview default.
 */
export function defaultMoebiusSteps(env: Record<string, string | undefined> = process.env): number {
  const raw = env["PHOTOMATOR_ML_HEAL_STEPS"];
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) return parsed;
  }
  return MOEBIUS_PREVIEW_INFERENCE_STEPS;
}

/**
 * ORT intra-op thread override. Unset (the default) lets onnxruntime pick,
 * which measured fastest on M1 Pro (1.79–1.89s/UNet run vs 2.37s forced to
 * 10 threads — the E-cores add contention). Set PHOTOMATOR_ML_THREADS to
 * experiment on other machines.
 */
function ortThreads(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env["PHOTOMATOR_ML_THREADS"];
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 256) return null;
  return parsed;
}

/** One-line runtime summary for the startup log. */
export function mlRuntimeSummary(env: Record<string, string | undefined> = process.env): string {
  const threads = ortThreads(env);
  return `ep=${moebiusEPLabel()} threads=${threads ?? `default (ncpus=${os.availableParallelism()})`} steps=${defaultMoebiusSteps(env)}`;
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

/** Expected Moebius sizes, paired with names; ~10% tolerance for revisions. */
function moebiusExpectations(): { file: string; minSize: number }[] {
  return ML_HEAL_MOEBIUS_FILES.map((file, i) => ({
    file,
    minSize: Math.floor((ML_HEAL_MOEBIUS_FILE_SIZES[i] ?? 0) * 0.9),
  }));
}

async function modelsPresent(dir: string): Promise<boolean> {
  for (const { file, minSize } of moebiusExpectations()) {
    if (!(await filePresent(path.join(dir, file), minSize))) return false;
  }
  return true;
}

function moebiusBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env["PHOTOMATOR_ML_HEAL_MOEBIUS_BASE"];
  const base = override && override.trim() ? override.trim() : ML_HEAL_MOEBIUS_DEFAULT_BASE;
  return base.endsWith("/") ? base : `${base}/`;
}

function provisioningOffline(): boolean {
  return process.env["PHOTOMATOR_ML_HEAL_OFFLINE"] === "1";
}

/** Live download progress, shared by health polling and concurrent strokes. */
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

async function downloadToFile(url: string, dest: string, minSize: number, progress: DownloadProgress): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: HTTP ${response.status} for ${url}.`);
  }
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
  if (!stat || stat.size < minSize) {
    await fs.unlink(tmp).catch(() => undefined);
    throw new Error(`Model download incomplete for ${url} (${stat?.size ?? 0} bytes).`);
  }
  await fs.rename(tmp, dest);
}

/** In-flight Moebius provisions, one per model dir. */
const moebiusProvisions = new Map<string, Promise<void>>();

/**
 * Ensure all Moebius weights exist on disk, downloading what's missing
 * (~1.3GB total, once). Shared across concurrent strokes; rejects when
 * offline or the download fails so routes can answer 503 — never a silent
 * fallback to exemplar fill.
 */
export async function ensureMoebiusWeights(dataDir: string): Promise<string> {
  if (!ortAvailable()) {
    throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  }
  if (provisioningOffline()) {
    throw new Error("Model provisioning is disabled (PHOTOMATOR_ML_HEAL_OFFLINE=1).");
  }
  const dir = mlHealDir(dataDir);
  if (await modelsPresent(dir)) return dir;
  const pending = moebiusProvisions.get(dir);
  if (pending) {
    await pending;
    return dir;
  }
  const job = (async (): Promise<void> => {
    await fs.mkdir(dir, { recursive: true });
    const base = moebiusBaseUrl();
    const missing: { file: string; minSize: number }[] = [];
    for (const { file, minSize } of moebiusExpectations()) {
      if (!(await filePresent(path.join(dir, file), minSize))) missing.push({ file, minSize });
    }
    const total = missing.reduce((sum, { file }) => sum + expectedSizeOf(file), 0);
    const progress = progressFor(dir);
    progress.active = true;
    progress.received = 0;
    progress.total = total;
    console.log(`[ml-heal] Downloading Moebius weights (${missing.length} files, ~${Math.round(total / 1048576)}MB) from ${base}`);
    try {
      for (const { file, minSize } of missing) {
        const dest = path.join(dir, file);
        if (await filePresent(dest, minSize)) continue;
        await downloadToFile(`${base}${file}`, dest, minSize, progress);
        console.log(`[ml-heal] Moebius ${file} ready.`);
      }
    } finally {
      progress.active = false;
    }
    if (!(await modelsPresent(dir))) {
      throw new Error("Moebius weights still incomplete after download.");
    }
    console.log("[ml-heal] Moebius weights ready.");
  })();
  moebiusProvisions.set(dir, job);
  try {
    await job;
    return dir;
  } finally {
    moebiusProvisions.delete(dir);
  }
}

function expectedSizeOf(file: string): number {
  const index = (ML_HEAL_MOEBIUS_FILES as readonly string[]).indexOf(file);
  return ML_HEAL_MOEBIUS_FILE_SIZES[index] ?? 0;
}

function lamaUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env["PHOTOMATOR_ML_HEAL_LAMA_URL"];
  if (override && override.trim()) return override.trim();
  return ML_HEAL_LAMA_DEFAULT_URL;
}

/** In-flight LaMa downloads, one per model dir: concurrent first strokes share it. */
const lamaDownloads = new Map<string, Promise<string>>();

/**
 * Ensure the LaMa weights exist on disk, downloading once (~208MB) on first
 * use. Resolves to the model path. Rejects when ORT or the download is
 * unavailable so routes can answer 503.
 */
export async function ensureLamaWeights(dataDir: string): Promise<string> {
  if (!ortAvailable()) {
    throw new Error("onnxruntime-node is not installed — run yarn install in apps/server.");
  }
  const dir = mlHealDir(dataDir);
  const dest = path.join(dir, ML_HEAL_LAMA_FILE);
  if (await filePresent(dest, 1024 * 1024)) return dest;
  const pending = lamaDownloads.get(dir);
  if (pending) return pending;
  const job = (async (): Promise<string> => {
    await fs.mkdir(dir, { recursive: true });
    const url = lamaUrl();
    console.log(`[ml-heal] Downloading LaMa weights (~208MB) from ${url}`);
    const progress = progressFor(dir);
    progress.active = true;
    progress.received = 0;
    progress.total = 208 * 1024 * 1024;
    try {
      await downloadToFile(url, dest, 1024 * 1024, progress);
    } finally {
      progress.active = false;
    }
    const stat = await fs.stat(dest).catch(() => null);
    console.log(`[ml-heal] LaMa weights ready (${Math.round((stat?.size ?? 0) / 1048576)}MB).`);
    return dest;
  })();
  lamaDownloads.set(dir, job);
  try {
    return await job;
  } finally {
    lamaDownloads.delete(dir);
  }
}

/** Last readiness failure per engine key (`${dir}:${engine}`), cleared on success. */
const readyErrors = new Map<string, string>();

/** In-flight readiness jobs (weights + sessions), one per engine key. */
const readyJobs = new Map<string, Promise<void>>();

function readinessFor(dir: string, engine: RemoteHealEngine, weightsReady: boolean, sessionsWarm: boolean): EngineReadiness {
  const progress = downloadProgress.get(dir);
  const downloading = progress?.active ?? false;
  return {
    weightsReady,
    sessionsWarm,
    serving: weightsReady && sessionsWarm,
    downloading,
    downloadPct: downloading && progress && progress.total > 0 ? Math.min(1, progress.received / progress.total) : downloading ? 0 : 1,
    error: readyErrors.get(`${dir}:${engine}`) ?? null,
  };
}

/**
 * Full readiness for one engine: weights on disk plus warm sessions, so the
 * first stroke infers immediately. Concurrent callers share one job. Rejects
 * on download/session failure (routes answer 503); the error is recorded for
 * health polling and cleared on the next success.
 */
export async function ensureEngineReady(dataDir: string, engine: RemoteHealEngine): Promise<void> {
  const dir = mlHealDir(dataDir);
  const key = `${dir}:${engine}`;
  const pending = readyJobs.get(key);
  if (pending) {
    await pending;
    return;
  }
  const job = (async (): Promise<void> => {
    if (engine === "lama") {
      const modelPath = await ensureLamaWeights(dataDir);
      await getNodeSession(modelPath, ["cpu"]);
    } else {
      await ensureMoebiusWeights(dataDir);
      const eps = moebiusProviders();
      const [unetFile, encFile, decFile] = ML_HEAL_MOEBIUS_FILES;
      await getNodeSession(path.join(dir, unetFile), eps, "moebius");
      await getNodeSession(path.join(dir, encFile), eps, "moebius");
      await getNodeSession(path.join(dir, decFile), eps, "moebius");
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

/**
 * Kick readiness into the background (warmup path): returns immediately so
 * the client can poll health for download/session progress.
 */
export function kickEngineReady(dataDir: string, engine: RemoteHealEngine): void {
  void ensureEngineReady(dataDir, engine).catch((error: unknown) => {
    console.error(`[ml-heal] Background readiness failed for ${engine}:`, error instanceof Error ? error.message : error);
  });
}

export async function getMlHealHealth(dataDir: string): Promise<MlHealHealth> {
  const dir = mlHealDir(dataDir);
  const moebiusCached = await modelsPresent(dir);
  const lamaCached = await filePresent(path.join(dir, ML_HEAL_LAMA_FILE), 1024 * 1024);
  const ort = ortAvailable();
  const moebiusReady = moebiusCached && ort;
  const lamaReady = lamaCached && ort;
  const engines: Record<RemoteHealEngine, EngineReadiness> = {
    lama: readinessFor(dir, "lama", lamaReady, hasSession(path.join(dir, ML_HEAL_LAMA_FILE))),
    moebius: readinessFor(dir, "moebius", moebiusReady, moebiusSessionsWarm(dir)),
  };
  return {
    ok: true,
    ready: ort,
    ortAvailable: ort,
    lamaReady,
    lamaCached,
    moebiusReady,
    modelsCached: moebiusCached,
    device: ort ? moebiusEPLabel() : "none (onnxruntime-node missing)",
    detail: "Photo server ML.",
    engines,
  };
}

export function validateRemoteBody(body: unknown): { ok: true; value: RemoteInpaintBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  const v = body as Record<string, unknown>;
  const roi = v["roi"] as MlHealRoi | undefined;
  const srcWidth = v["srcWidth"];
  const srcHeight = v["srcHeight"];
  const imageB64 = v["imageB64"];
  const maskB64 = v["maskB64"];
  if (!roi || typeof roi.x0 !== "number" || typeof roi.y0 !== "number" || typeof roi.size !== "number") {
    return { ok: false, error: "Missing roi {x0,y0,size}." };
  }
  if (
    !Number.isInteger(roi.x0) || !Number.isInteger(roi.y0) || !Number.isInteger(roi.size) ||
    roi.size <= 0 || roi.size > ML_HEAL_ROI_MAX_SIZE || roi.x0 < 0 || roi.y0 < 0
  ) {
    return { ok: false, error: `Invalid roi size (1..${ML_HEAL_ROI_MAX_SIZE}).` };
  }
  if (!Number.isInteger(srcWidth) || (srcWidth as number) <= 0 || !Number.isInteger(srcHeight) || (srcHeight as number) <= 0) {
    return { ok: false, error: "Invalid src dimensions." };
  }
  const engine = v["engine"];
  if (engine !== undefined && engine !== "lama" && engine !== "moebius") {
    return { ok: false, error: 'Invalid engine (expected "lama" or "moebius").' };
  }
  if (typeof imageB64 !== "string" || typeof maskB64 !== "string" || !imageB64 || !maskB64) {
    return { ok: false, error: "Missing imageB64/maskB64." };
  }
  // Raw-byte length guard before decode (base64 ~4/3 overhead).
  const maxRaw = roi.size * roi.size;
  if (imageB64.length > Math.ceil((maxRaw * 4 * 4) / 3) + 64 || maskB64.length > Math.ceil((maxRaw * 4) / 3) + 64) {
    return { ok: false, error: "Payload larger than roi allows." };
  }
  const steps = v["steps"];
  if (steps !== undefined && (!Number.isInteger(steps) || (steps as number) < 1 || (steps as number) > 50)) {
    return { ok: false, error: "Invalid steps (1..50)." };
  }
  const seed = v["seed"];
  if (seed !== undefined && (!Number.isInteger(seed) || Math.abs(seed as number) > 2 ** 31)) {
    return { ok: false, error: "Invalid seed." };
  }
  return { ok: true, value: { engine: (engine ?? "moebius") as RemoteHealEngine, roi, srcWidth: srcWidth as number, srcHeight: srcHeight as number, imageB64, maskB64, ...(steps === undefined ? {} : { steps: steps as number }), ...(seed === undefined ? {} : { seed: seed as number }) } };
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function firstTensorData(results: Record<string, { data: unknown }>): Float32Array {
  const tensor = (results["output"] ?? results[Object.keys(results)[0] as string]) as { data: unknown } | undefined;
  if (!tensor) throw new Error("empty model output");
  return tensor.data as Float32Array;
}

type OrtNodeModule = {
  InferenceSession: {
    create(path: string, options?: Record<string, unknown>): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
    }>;
  };
  Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
};

const nodeSessions = new Map<string, { run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>> }>();

/**
 * Winning Moebius providers, determined once. Measured on M1 Max (Oct 2026):
 * CPU ≈46s/area vs CoreML ≈95s/area — CoreML splits the UNet into ~289
 * partitions and the ANE↔CPU copies cost more than the acceleration saves.
 * So CPU is the default; CoreML is opt-in via PHOTOMATOR_ML_EP=coreml.
 */
let moebiusEPWinner: string[] | null = null;

function moebiusProviders(): string[] {
  if (process.env["PHOTOMATOR_ML_EP"] === "coreml") return moebiusEPWinner ?? ["coreml", "cpu"];
  return ["cpu"];
}

export function moebiusEPLabel(): string {
  return (moebiusEPWinner ?? ["cpu"]).join("+");
}

async function createSession(
  mod: OrtNodeModule,
  modelPath: string,
  eps: string[],
): Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>> }> {
  const threads = ortThreads();
  const startedAt = Date.now();
  const session = await mod.InferenceSession.create(modelPath, {
    executionProviders: eps,
    graphOptimizationLevel: "all",
    // Sequential graph: inter-op parallelism only adds scheduling overhead.
    ...(threads === null ? {} : { intraOpNumThreads: threads, interOpNumThreads: 1 }),
  });
  console.log(
    `[ml-heal] Session ready: ${path.basename(modelPath)} ` +
      `(${((Date.now() - startedAt) / 1000).toFixed(1)}s, ep=${eps.join("+")}, threads=${threads ?? "default"}).`,
  );
  return session;
}

/** Live inference progress for the current (single-user, local) heal job. */
export interface HealJobProgress {
  active: boolean;
  engine: RemoteHealEngine | null;
  /** Human stage: encode, denoise, decode, infer, done. */
  stage: string;
  /** Completed denoise steps (0 until the loop starts). */
  step: number;
  totalSteps: number;
  startedAt: number | null;
  updatedAt: number | null;
}

const IDLE_PROGRESS: HealJobProgress = {
  active: false,
  engine: null,
  stage: "idle",
  step: 0,
  totalSteps: 0,
  startedAt: null,
  updatedAt: null,
};

const healProgress: HealJobProgress = { ...IDLE_PROGRESS };

function setProgress(patch: Partial<HealJobProgress>): void {
  Object.assign(healProgress, patch, { updatedAt: Date.now() });
}

/** Snapshot of the current heal job for progress polling. Always safe to call. */
export function getHealProgress(): HealJobProgress {
  return { ...healProgress };
}

/** Reset progress to idle (job end, tests). */
export function resetHealProgress(): void {
  Object.assign(healProgress, IDLE_PROGRESS, { updatedAt: Date.now() });
}

async function getNodeSession(
  modelPath: string,
  eps: string[] = ["cpu"],
  tag?: "moebius",
): Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>> }> {
  const hit = nodeSessions.get(modelPath);
  if (hit) return hit;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("onnxruntime-node") as OrtNodeModule;
  try {
    const session = await createSession(mod, modelPath, eps);
    nodeSessions.set(modelPath, session);
    if (tag === "moebius" && moebiusEPWinner === null) moebiusEPWinner = eps;
    return session;
  } catch (error) {
    // CoreML partitioning can reject a graph (unsupported ops/shapes):
    // fall back to CPU rather than failing the heal.
    if (eps.includes("coreml")) {
      console.warn(`[ml-heal] CoreML session failed for ${path.basename(modelPath)}, retrying on CPU:`, error instanceof Error ? error.message : error);
      const session = await createSession(mod, modelPath, ["cpu"]);
      nodeSessions.set(modelPath, session);
      if (tag === "moebius") moebiusEPWinner = ["cpu"];
      return session;
    }
    throw error;
  }
}

/** True once a session exists for every Moebius graph (set on success). */
function moebiusSessionsWarm(dir: string): boolean {
  return ML_HEAL_MOEBIUS_FILES.every((file) => nodeSessions.has(path.join(dir, file)));
}

function hasSession(modelPath: string): boolean {
  return nodeSessions.has(modelPath);
}

function newTensor(mod: OrtNodeModule, type: string, data: unknown, dims: number[]): unknown {
  return new mod.Tensor(type, data, dims);
}

/**
 * Single-pass LaMa fill at 512: identical feeds to the former browser path
 * (image 1x3x512x512 in 0..1, mask 1x1x512x512). Output is LaMa-convention
 * 0..255 RGB, ready for compositeMlHealOutput.
 */
async function lama512(
  modelPath: string,
  image01: Float32Array,
  mask01: Float32Array,
): Promise<Float32Array> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("onnxruntime-node") as OrtNodeModule;
  const session = await getNodeSession(modelPath);
  const startedAt = Date.now();
  const results = await session.run({
    image: newTensor(mod, "float32", image01, [1, 3, ML_HEAL_512, ML_HEAL_512]),
    mask: newTensor(mod, "float32", mask01, [1, 1, ML_HEAL_512, ML_HEAL_512]),
  });
  console.log(`[ml-heal] lama single pass: ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
  return firstTensorData(results);
}

async function moebius512(
  dir: string,
  image01: Float32Array,
  mask01: Float32Array,
  steps: number,
  seed: number,
): Promise<Float32Array> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("onnxruntime-node") as OrtNodeModule;
  const [unetFile, encFile, decFile] = ML_HEAL_MOEBIUS_FILES;
  const eps = moebiusProviders();
  const unet = await getNodeSession(path.join(dir, unetFile), eps, "moebius");
  const enc = await getNodeSession(path.join(dir, encFile), eps, "moebius");
  const dec = await getNodeSession(path.join(dir, decFile), eps, "moebius");

  const jobStartedAt = Date.now();
  setProgress({ stage: "encode", step: 0, totalSteps: 0 });
  const vaeIn = maskMlHealInputForEncode(image01, mask01);
  const encStartedAt = Date.now();
  const encOut = await enc.run({ image: newTensor(mod, "float32", vaeIn, [1, 3, 512, 512]) });
  console.log(`[ml-heal] moebius encode: ${((Date.now() - encStartedAt) / 1000).toFixed(1)}s.`);
  const moments = firstTensorData(encOut);
  const latentN = MOEBIUS_LATENT_SIZE * MOEBIUS_LATENT_SIZE;
  const maskedLatent = new Float32Array(4 * latentN);
  for (let c = 0; c < 4; c += 1) {
    for (let i = 0; i < latentN; i += 1) {
      maskedLatent[c * latentN + i] = (moments[c * latentN + i] ?? 0) * MOEBIUS_VAE_SCALE;
    }
  }
  const fillLatent = downsampleMaskToLatent(mask01);
  const alphas = moebiusAlphasCumprod(moebiusBetas());
  const timesteps = moebiusTimesteps(steps, MOEBIUS_STRENGTH);
  const condData = BigInt64Array.from({ length: 10 }, (_, i) => BigInt(i));
  const uncondData = BigInt64Array.from({ length: 10 }, (_, i) => BigInt(10 + i));
  // Prompt ids never change: build the int64 tensors once, not per step.
  const condIds = newTensor(mod, "int64", condData, [1, 10]);
  const uncondIds = newTensor(mod, "int64", uncondData, [1, 10]);
  let latentF32 = seedMoebiusLatents(makeSeededGaussian, seed);
  const unetIn = new Float32Array(9 * latentN);
  setProgress({ stage: "denoise", step: 0, totalSteps: timesteps.length });
  for (let step = 0; step < timesteps.length; step += 1) {
    const stepStartedAt = Date.now();
    const t = timesteps[step] ?? 0;
    const tPrev = step + 1 < timesteps.length ? (timesteps[step + 1] ?? -1) : -1;
    const aT = alphas[t] ?? 1;
    const aPrev = tPrev < 0 ? 1 : (alphas[tPrev] ?? 1);
    unetIn.set(latentF32, 0);
    unetIn.set(fillLatent, 4 * latentN);
    unetIn.set(maskedLatent, 5 * latentN);
    // One snapshot per step, shared by both runs: the awaits are sequential
    // and ORT never mutates its inputs, so the double slice was pure garbage.
    const latentPayload = unetIn.slice();
    const latentTensor = newTensor(mod, "float32", latentPayload, [1, 9, MOEBIUS_LATENT_SIZE, MOEBIUS_LATENT_SIZE]);
    const stepTensor = newTensor(mod, "int64", BigInt64Array.from([BigInt(t)]), [1]);
    const condOut = await unet.run({ latent: latentTensor, timesteps: stepTensor, input_ids: condIds });
    const uncondOut = await unet.run({ latent: latentTensor, timesteps: stepTensor, input_ids: uncondIds });
    const cond = firstTensorData(condOut);
    const uncond = firstTensorData(uncondOut);
    const sqrtAT = Math.sqrt(aT);
    const sqrt1mAT = Math.sqrt(Math.max(0, 1 - aT));
    const sqrtAPrev = Math.sqrt(aPrev);
    const sqrt1mAPrev = Math.sqrt(Math.max(0, 1 - aPrev));
    const next = new Float32Array(4 * latentN);
    for (let i = 0; i < next.length; i += 1) {
      const eps = (uncond[i] ?? 0) + MOEBIUS_GUIDANCE * ((cond[i] ?? 0) - (uncond[i] ?? 0));
      const predX0 = ((latentF32[i] ?? 0) - sqrt1mAT * eps) / Math.max(1e-8, sqrtAT);
      next[i] = sqrtAPrev * predX0 + sqrt1mAPrev * eps;
    }
    latentF32 = next;
    const stepMs = Date.now() - stepStartedAt;
    const elapsedS = (Date.now() - jobStartedAt) / 1000;
    console.log(
      `[ml-heal] moebius step ${step + 1}/${timesteps.length} (t=${t}): ${(stepMs / 1000).toFixed(1)}s (elapsed ${elapsedS.toFixed(0)}s).`,
    );
    setProgress({ stage: "denoise", step: step + 1, totalSteps: timesteps.length });
  }
  setProgress({ stage: "decode", step: timesteps.length, totalSteps: timesteps.length });
  const decoded = new Float32Array(latentF32.length);
  for (let i = 0; i < decoded.length; i += 1) decoded[i] = (latentF32[i] ?? 0) / MOEBIUS_VAE_SCALE;
  const decStartedAt = Date.now();
  const decOut = await dec.run({ latent: newTensor(mod, "float32", decoded, [1, 4, MOEBIUS_LATENT_SIZE, MOEBIUS_LATENT_SIZE]) });
  console.log(`[ml-heal] moebius decode: ${((Date.now() - decStartedAt) / 1000).toFixed(1)}s.`);
  const rgb = firstTensorData(decOut);
  const output = new Float32Array(3 * 512 * 512);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Math.max(0, Math.min(255, ((rgb[i] ?? 0) * 0.5 + 0.5) * 255));
  }
  return output;
}

export interface RemoteHealResult {
  engine: string;
  width: number;
  height: number;
  /** RGB 0..255, 3*512*512 floats. */
  output: Float32Array;
}

/**
 * Run one ROI heal on the server. Throws RangeError on malformed pixels so
 * routes can answer 400; throws Error on inference failure (503).
 */
export async function runRemoteHeal(dataDir: string, body: RemoteInpaintBody): Promise<RemoteHealResult> {
  const size = body.roi.size;
  const imageBytes = b64ToBytes(body.imageB64);
  const maskBytes = b64ToBytes(body.maskB64);
  if (imageBytes.length !== size * size * 4 || maskBytes.length !== size * size) {
    throw new RangeError(`ROI bytes mismatch roi size ${size}.`);
  }
  // The crop IS the working image: roi covers it fully, so pack resizes it
  // to the fixed 512 model grid (identical math to the browser path).
  const { image: image01, mask: mask01 } = packMlHealInput(
    { width: size, height: size, data: new Uint8ClampedArray(imageBytes) },
    { width: size, height: size, data: new Uint8ClampedArray(maskBytes) },
    { x0: 0, y0: 0, size },
  );
  const dir = mlHealDir(dataDir);
  const engine = body.engine ?? "moebius";
  const steps = body.steps ?? defaultMoebiusSteps();
  const seed = body.seed ?? MOEBIUS_SEED;
  const jobStartedAt = Date.now();
  setProgress({ active: true, engine, stage: "warmup", step: 0, totalSteps: 0, startedAt: jobStartedAt });
  console.log(
    `[ml-heal] Heal start: engine=${engine} roi=${size}px src=${body.srcWidth}x${body.srcHeight}` +
      (engine === "moebius" ? ` steps=${steps} seed=${seed}` : ""),
  );
  try {
    await ensureEngineReady(dataDir, engine);
    if (engine === "lama") {
      // Balanced: single-pass neural fill. Inference failure is terminal
      // (503) — no silent quality drop.
      setProgress({ stage: "infer" });
      const modelPath = path.join(dir, ML_HEAL_LAMA_FILE);
      try {
        const output = await lama512(modelPath, image01, mask01);
        console.log(`[ml-heal] Heal done: lama-remote in ${((Date.now() - jobStartedAt) / 1000).toFixed(1)}s.`);
        return { engine: "lama-remote", width: 512, height: 512, output };
      } catch (error) {
        nodeSessions.delete(modelPath);
        console.error("[ml-heal remote] LaMa failed:", error);
        throw new Error(`LaMa inference failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Best: full diffusion. Every failure is terminal (503) with a readable
    // message — exemplar fallback silently returning poor fills is what made
    // Best look broken.
    try {
      const output = await moebius512(dir, image01, mask01, steps, seed);
      console.log(`[ml-heal] Heal done: moebius-remote in ${((Date.now() - jobStartedAt) / 1000).toFixed(1)}s.`);
      return { engine: "moebius-remote", width: 512, height: 512, output };
    } catch (error) {
      // Poisoned sessions must never stick: drop so the next stroke retries
      // from a clean session instead of replaying the same failure.
      resetRemoteHeal();
      console.error("[ml-heal remote] Moebius failed:", error);
      throw new Error(`Moebius inference failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    setProgress({ active: false, stage: "done" });
  }
}

/** Drop cached Node sessions (tests, memory pressure). */
export function resetRemoteHeal(): void {
  nodeSessions.clear();
}
