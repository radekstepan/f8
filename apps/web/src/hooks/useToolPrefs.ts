import { useCallback, useState } from "react";
import {
  BLEND_FEATHER_PX,
  HEAL_DEFAULT_QUALITY,
  INPAINT_DEFAULT_METHOD,
  type HealQuality,
  type InpaintMethod,
} from "@f8/core";

export const TOOL_PREFS_KEY = "f8.tool-prefs-v1";
/** Pre-rename prefs key; read once as a fallback, then migrated forward and cleared. */
export const LEGACY_TOOL_PREFS_KEY = "photomator.tool-prefs-v2";

/** Raw stored prefs object: the new key wins, the pre-rename key is a one-shot fallback. */
export function readToolPrefsRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(TOOL_PREFS_KEY) ?? localStorage.getItem(LEGACY_TOOL_PREFS_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/** Merge a patch into the stored prefs, migrating any pre-rename entry forward. */
export function writeToolPrefsRaw(patch: Record<string, unknown>): void {
  try {
    const current = readToolPrefsRaw();
    localStorage.setItem(TOOL_PREFS_KEY, JSON.stringify({ ...current, ...patch }));
    localStorage.removeItem(LEGACY_TOOL_PREFS_KEY);
  } catch {
    /* Private mode / quota — prefs stay session-only. */
  }
}

export interface ToolPrefs {
  brushSize: number;
  brushStrength: number;
  repairMethod: InpaintMethod;
  repairQuality: HealQuality;
  seamlessLight: boolean;
  featherPx: number;
  cropRatio: string;
  presetsOpen: boolean;
  filmstripOpen: boolean;
}

const DEFAULTS: ToolPrefs = {
  brushSize: 45,
  brushStrength: 100,
  repairMethod: INPAINT_DEFAULT_METHOD,
  repairQuality: HEAL_DEFAULT_QUALITY,
  seamlessLight: false,
  featherPx: BLEND_FEATHER_PX,
  cropRatio: "Original",
  presetsOpen: true,
  filmstripOpen: true,
};

/** Fast has no ML tier: ml-heal requests for it resolve to Balanced. */
export function coercePrefQuality(method: InpaintMethod, quality: HealQuality): HealQuality {
  return method === "ml-heal" && quality === "fast" ? "balanced" : quality;
}

const METHODS: InpaintMethod[] = ["ml-heal", "heal", "telea", "ns"];
const QUALITIES: HealQuality[] = ["fast", "balanced", "best"];

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function sanitize(raw: unknown): ToolPrefs {
  if (!raw || typeof raw !== "object") return DEFAULTS;
  const r = raw as Partial<Record<keyof ToolPrefs, unknown>>;
  const method: InpaintMethod = METHODS.includes(r.repairMethod as InpaintMethod)
    ? (r.repairMethod as InpaintMethod)
    : DEFAULTS.repairMethod;
  const qualityRaw: HealQuality = QUALITIES.includes(r.repairQuality as HealQuality)
    ? (r.repairQuality as HealQuality)
    : DEFAULTS.repairQuality;
  return {
    brushSize: clampNum(r.brushSize, 5, 160, DEFAULTS.brushSize),
    brushStrength: clampNum(r.brushStrength, 1, 100, DEFAULTS.brushStrength),
    repairMethod: method,
    repairQuality: coercePrefQuality(method, qualityRaw),
    seamlessLight: typeof r.seamlessLight === "boolean" ? r.seamlessLight : DEFAULTS.seamlessLight,
    featherPx: clampNum(r.featherPx, 0, 8, DEFAULTS.featherPx),
    cropRatio: typeof r.cropRatio === "string" && r.cropRatio ? r.cropRatio : DEFAULTS.cropRatio,
    presetsOpen: typeof r.presetsOpen === "boolean" ? r.presetsOpen : DEFAULTS.presetsOpen,
    filmstripOpen: typeof r.filmstripOpen === "boolean" ? r.filmstripOpen : DEFAULTS.filmstripOpen,
  };
}

export function readToolPrefs(): ToolPrefs {
  const raw = readToolPrefsRaw();
  return Object.keys(raw).length ? sanitize(raw) : DEFAULTS;
}

function writeToolPrefs(prefs: ToolPrefs): void {
  try {
    localStorage.setItem(TOOL_PREFS_KEY, JSON.stringify(prefs));
    localStorage.removeItem(LEGACY_TOOL_PREFS_KEY);
  } catch {
    /* Private mode / quota — prefs stay session-only. */
  }
}

/**
 * Tool preferences shared across App (brush size, panel visibility) and the
 * repair hook (method/quality/feather). Adjust sliders are deliberately
 * excluded: those persist per-photo on the server.
 */
export function useToolPrefs() {
  const [prefs, setPrefs] = useState<ToolPrefs>(readToolPrefs);

  const update = useCallback((patch: Partial<ToolPrefs>) => {
    setPrefs((current) => {
      const next: ToolPrefs = { ...current, ...patch };
      if (patch.repairMethod !== undefined || patch.repairQuality !== undefined) {
        next.repairQuality = coercePrefQuality(next.repairMethod, next.repairQuality);
      }
      writeToolPrefs(next);
      return next;
    });
  }, []);

  return [prefs, update] as const;
}
