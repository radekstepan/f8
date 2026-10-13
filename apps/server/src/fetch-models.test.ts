import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DENOISE_FILE,
  DENOISE_FILE_SIZE,
  FACE_DETECT_FILE,
  FACE_DETECT_FILE_SIZE,
  ML_HEAL_LAMA_FILE_SIZE,
  ML_HEAL_MOEBIUS_FILE_SIZES,
  ML_HEAL_MOEBIUS_FILES,
  OBJECT_DETECT_FILE,
  OBJECT_DETECT_FILE_SIZE,
  SELECTIVE_MASK_FILE,
  SELECTIVE_MASK_FILE_SIZE,
  SEMANTIC_SEARCH_FILE,
  SEMANTIC_SEARCH_FILE_SIZE,
  STRAIGHTEN_ML_FILE,
  STRAIGHTEN_ML_FILE_SIZE,
  SUPERRES_FILE,
  SUPERRES_FILE_SIZE,
} from "@f8/core";
import { denoiseDir } from "./denoise.ts";
import { faceDetectDir } from "./face-detect.ts";
import { fetchAllModels, modelFetchPlan } from "./fetch-models.ts";
import { ML_HEAL_LAMA_FILE, mlHealDir } from "./ml-heal.ts";
import { objectDetectDir } from "./object-detect.ts";
import { selectiveMaskDir } from "./selective-mask.ts";
import { semanticSearchDir } from "./semantic-search.ts";
import { straightenMlDir } from "./straighten-ml.ts";
import { superresDir } from "./superres.ts";

// The prefetch reuses each module's ensure*Weights, so a fully populated
// data dir must fetch with zero network: stub fetch to throw and prove it.
// Sparse (truncated) files stand in for the real weights — full logical
// size, no bytes written.

/** Remove every F8_* override so the test is hermetic; returns a restore. */
function clearF8Env(): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("F8_")) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  }
  return () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("F8_")) delete process.env[key];
    }
    for (const [key, value] of saved) {
      if (value !== undefined) process.env[key] = value;
    }
  };
}

function stubFetchToThrow(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network disabled in test");
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

async function sparseFile(dir: string, file: string, size: number): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, file);
  await fs.writeFile(dest, Buffer.alloc(0));
  await fs.truncate(dest, size);
}

describe("modelFetchPlan", () => {
  it("covers every downloadable asset with its weight files", () => {
    const plan = modelFetchPlan({});
    expect(plan.map((entry) => entry.key)).toEqual([
      "ml-heal/lama",
      "ml-heal/moebius",
      "object-detect",
      "face-detect",
      "selective-mask",
      "denoise",
      "superres",
      "semantic-search",
    ]);
    const files = new Map(plan.map((entry) => [entry.key, entry.files]));
    expect(files.get("ml-heal/lama")).toEqual([ML_HEAL_LAMA_FILE]);
    expect(files.get("ml-heal/moebius")).toEqual([...ML_HEAL_MOEBIUS_FILES]);
    expect(files.get("object-detect")).toEqual([OBJECT_DETECT_FILE]);
    expect(files.get("face-detect")).toEqual([FACE_DETECT_FILE]);
    expect(files.get("selective-mask")).toEqual([SELECTIVE_MASK_FILE]);
    expect(files.get("denoise")).toEqual([DENOISE_FILE]);
    expect(files.get("superres")).toEqual([SUPERRES_FILE]);
    expect(files.get("semantic-search")).toEqual([SEMANTIC_SEARCH_FILE]);
  });

  it("adds straighten-ml only when a weight URL is configured", () => {
    expect(modelFetchPlan({}).some((entry) => entry.key === "straighten-ml")).toBe(false);
    const plan = modelFetchPlan({ F8_STRAIGHTEN_ML_URL: "https://example.invalid/straighten.onnx" });
    const straighten = plan.find((entry) => entry.key === "straighten-ml");
    expect(straighten?.files).toEqual([STRAIGHTEN_ML_FILE]);
  });
});

describe("fetchAllModels", () => {
  it("collects per-entry failures without throwing", async () => {
    const lines: string[] = [];
    const results = await fetchAllModels("/nonexistent-data-dir", {
      log: (line) => lines.push(line),
      plan: [
        {
          key: "boom",
          label: "Boom",
          files: ["boom.onnx"],
          ensure: async () => {
            throw new Error("host down");
          },
        },
        {
          key: "fine",
          label: "Fine",
          files: ["fine.onnx"],
          ensure: async () => "/nonexistent-data-dir/fine.onnx",
        },
      ],
    });
    expect(results).toEqual([
      { key: "boom", label: "Boom", ok: false, error: "host down" },
      { key: "fine", label: "Fine", ok: true },
    ]);
    expect(lines.join("\n")).toContain("FAILED: host down");
  });

  it("skips every entry without network when weights are cached", async () => {
    const restoreEnv = clearF8Env();
    const restoreFetch = stubFetchToThrow();
    const dataDir = await fs.mkdtemp(path.join(tmpdir(), "f8-fetch-models-"));
    try {
      await sparseFile(mlHealDir(dataDir), ML_HEAL_LAMA_FILE, ML_HEAL_LAMA_FILE_SIZE);
      for (const [index, file] of ML_HEAL_MOEBIUS_FILES.entries()) {
        await sparseFile(mlHealDir(dataDir), file, ML_HEAL_MOEBIUS_FILE_SIZES[index] ?? 0);
      }
      await sparseFile(objectDetectDir(dataDir), OBJECT_DETECT_FILE, OBJECT_DETECT_FILE_SIZE);
      await sparseFile(faceDetectDir(dataDir), FACE_DETECT_FILE, FACE_DETECT_FILE_SIZE);
      await sparseFile(selectiveMaskDir(dataDir), SELECTIVE_MASK_FILE, SELECTIVE_MASK_FILE_SIZE);
      await sparseFile(denoiseDir(dataDir), DENOISE_FILE, DENOISE_FILE_SIZE);
      await sparseFile(superresDir(dataDir), SUPERRES_FILE, SUPERRES_FILE_SIZE);
      await sparseFile(semanticSearchDir(dataDir), SEMANTIC_SEARCH_FILE, SEMANTIC_SEARCH_FILE_SIZE);
      // Straighten joins the plan once a URL is configured; its cached
      // weights must skip the network like every other entry.
      process.env["F8_STRAIGHTEN_ML_URL"] = "https://example.invalid/straighten.onnx";
      await sparseFile(straightenMlDir(dataDir), STRAIGHTEN_ML_FILE, STRAIGHTEN_ML_FILE_SIZE);

      const lines: string[] = [];
      const results = await fetchAllModels(dataDir, { log: (line) => lines.push(line) });
      expect(results).toHaveLength(9);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(lines.join("\n")).not.toContain("FAILED");
    } finally {
      restoreFetch();
      restoreEnv();
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reports all entries failed when provisioning is disabled", async () => {
    const restoreEnv = clearF8Env();
    const restoreFetch = stubFetchToThrow();
    const dataDir = await fs.mkdtemp(path.join(tmpdir(), "f8-fetch-models-offline-"));
    try {
      for (const name of [
        "F8_ML_HEAL_OFFLINE",
        "F8_OBJECT_DETECT_OFFLINE",
        "F8_FACE_DETECT_OFFLINE",
        "F8_SELECTIVE_MASK_OFFLINE",
        "F8_DENOISE_OFFLINE",
        "F8_SUPERRES_OFFLINE",
        "F8_SEMANTIC_SEARCH_OFFLINE",
      ]) {
        process.env[name] = "1";
      }
      const results = await fetchAllModels(dataDir);
      expect(results).toHaveLength(8);
      expect(results.every((result) => !result.ok)).toBe(true);
      expect(results.every((result) => (result.error?.length ?? 0) > 0)).toBe(true);
    } finally {
      restoreFetch();
      restoreEnv();
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});
