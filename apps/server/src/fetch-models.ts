// `yarn setup`: prefetch every downloadable ML asset into the server data
// dir ahead of time, so first use never waits on (or fails from) an
// on-demand download.
//
// Each entry reuses the owning module's ensure*Weights — the same function
// the warmup path calls — so the prefetch can never drift from what the
// server would fetch itself: same URLs (including F8_* overrides), same
// dirs, same truncated-download guards. Entries already on disk are
// skipped; failures are collected and reported, never silent.
//
// Not in the plan: dust spots (its tiny classifier ships embedded in
// @f8/core — F8_DUST_SPOTS_WEIGHTS is operator-supplied) and straighten-ml
// by default (regressor weights are unpublished; the entry appears only
// when F8_STRAIGHTEN_ML_URL is configured).

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DENOISE_FILE,
  FACE_DETECT_FILE,
  ML_HEAL_MOEBIUS_FILES,
  OBJECT_DETECT_FILE,
  SELECTIVE_MASK_FILE,
  SEMANTIC_SEARCH_FILE,
  STRAIGHTEN_ML_FILE,
  SUPERRES_FILE,
} from "@f8/core";
import { loadConfig } from "./config.ts";
import { ensureDenoiseWeights } from "./denoise.ts";
import { ensureFaceDetectWeights } from "./face-detect.ts";
import { ML_HEAL_LAMA_FILE, ensureLamaWeights, ensureMoebiusWeights } from "./ml-heal.ts";
import { ensureObjectDetectWeights } from "./object-detect.ts";
import { ensureSelectiveMaskWeights } from "./selective-mask.ts";
import { ensureSemanticSearchWeights } from "./semantic-search.ts";
import { ensureStraightenWeights, straightenMlUrl } from "./straighten-ml.ts";
import { ensureSuperresWeights } from "./superres.ts";

export interface ModelFetchEntry {
  /** Stable key for reports (e.g. "object-detect", "ml-heal/moebius"). */
  key: string;
  /** Human label with the approximate download size. */
  label: string;
  /** Weight files this entry provides (for the summary, not for probing). */
  files: string[];
  /** Ensure the weights exist, downloading what's missing. */
  ensure: (dataDir: string) => Promise<string>;
}

export function modelFetchPlan(env: Record<string, string | undefined> = process.env): ModelFetchEntry[] {
  const plan: ModelFetchEntry[] = [
    { key: "ml-heal/lama", label: "ML Repair LaMa fill (~208MB)", files: [ML_HEAL_LAMA_FILE], ensure: ensureLamaWeights },
    {
      key: "ml-heal/moebius",
      label: "ML Repair Moebius diffusion (~1.2GB)",
      files: [...ML_HEAL_MOEBIUS_FILES],
      ensure: ensureMoebiusWeights,
    },
    { key: "object-detect", label: "Person removal YOLOv8n (~12MB)", files: [OBJECT_DETECT_FILE], ensure: ensureObjectDetectWeights },
    { key: "face-detect", label: "Face detect YuNet (~227KB)", files: [FACE_DETECT_FILE], ensure: ensureFaceDetectWeights },
    { key: "selective-mask", label: "Selective mask u2netp (~4.6MB)", files: [SELECTIVE_MASK_FILE], ensure: ensureSelectiveMaskWeights },
    { key: "denoise", label: "Denoise DnCNN (~2.6MB)", files: [DENOISE_FILE], ensure: ensureDenoiseWeights },
    { key: "superres", label: "Super-res Real-ESRGAN x2 (~64MB)", files: [SUPERRES_FILE], ensure: ensureSuperresWeights },
    {
      key: "semantic-search",
      label: "Semantic search CLIP vision (~85MB)",
      files: [SEMANTIC_SEARCH_FILE],
      ensure: ensureSemanticSearchWeights,
    },
  ];
  if (straightenMlUrl(env)) {
    plan.push({
      key: "straighten-ml",
      label: "Straighten tilt regressor",
      files: [STRAIGHTEN_ML_FILE],
      ensure: ensureStraightenWeights,
    });
  }
  return plan;
}

export interface ModelFetchResult {
  key: string;
  label: string;
  ok: boolean;
  error?: string;
}

export interface FetchAllModelsOptions {
  plan?: ModelFetchEntry[];
  log?: (line: string) => void;
}

/**
 * Fetch every plan entry in order. One bad host must not starve the rest,
 * so failures are collected per entry and the caller decides the exit
 * code — use the returned results, not the absence of a throw.
 */
export async function fetchAllModels(dataDir: string, opts: FetchAllModelsOptions = {}): Promise<ModelFetchResult[]> {
  const plan = opts.plan ?? modelFetchPlan();
  const log = opts.log ?? ((): void => undefined);
  const results: ModelFetchResult[] = [];
  for (const [index, entry] of plan.entries()) {
    const tag = `[${index + 1}/${plan.length}]`;
    log(`${tag} ${entry.label} …`);
    try {
      await entry.ensure(dataDir);
      log(`${tag} ${entry.label} ready.`);
      results.push({ key: entry.key, label: entry.label, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`${tag} ${entry.label} FAILED: ${message}`);
      results.push({ key: entry.key, label: entry.label, ok: false, error: message });
    }
  }
  return results;
}

const invokedAsCli = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  const config = loadConfig();
  console.log(`[setup] Prefetching ML weights into ${config.dataDir} …`);
  const results = await fetchAllModels(config.dataDir, { log: (line) => console.log(`[setup] ${line}`) });
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`[setup] ${failed.length} of ${results.length} failed: ${failed.map((result) => result.key).join(", ")}`);
    for (const result of failed) console.error(`[setup] ${result.key}: ${result.error ?? "unknown error"}`);
    process.exitCode = 1;
  } else {
    console.log(`[setup] All ${results.length} model packs ready.`);
  }
}
