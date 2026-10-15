import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, ChevronsLeftRight, Columns2, Copy, Heart, ImageOff, Info, Maximize, Minus, Plus, Star } from 'lucide-react';
import { DEFAULT_EDIT, isDefaultEdit } from '@f8/core';
import { CULL_LABEL_BLURRY, LibraryError, ZOOM_LENS_MAGNIFICATION, ZOOM_LENS_SIZE_PX, applyInpaintRepair, clearTestHealCalls, clockwiseStepsForRotation, createHealQueue, createLibraryClient, drawEffects, enforceHealCacheLimit, frameAspectForPhoto, geometryCanvas, geometryKeyForHealCache, groupRetouchStrokes, isLiveRepairDrag, loadImage, loadPreviewRender, loadStoredHealOverlays, mergeFetchedHealOverlays, nextRetouchStrokeId, overlayBodyFromPatch, panScrollFromDrag, partitionHealGroups, pasteHealPatches, planHealOrphanSweep, previewBlobFromCanvas, repairedBaseForHealJob, previewFrameGeometry, previewRenderKey, readTestHealCalls, renderAdjustedCanvas, resampleHealPatchForStraighten, resolveCanvasDrag, reusableOverlayForGroup, rotateHealPatch, savePreviewRender, separateOriginalSrc, shouldDockZoomLensOutside, signatureForHealGroup, straightenResampleAllowed, strokeIdForPoint, zoomLensBrushRadius, zoomLensDestPoint, zoomLensOriginalOverlay, zoomLensSourceRect } from '@f8/core';
import type { CachedHealPatch, ChangeEdit, DetectionPreview, EditState, HealCacheParams, InpaintMethod, Photo, RepairInpaintBinding, RetouchPoint, RetouchStrokeGroup, RunInpaint, StoredHealPatch, Tool, ZoomLensMagnification } from '@f8/core';
import { BlurryBadge, IconButton } from './EditorUI.js';
import { ToolHint } from './ToolHint.js';
import { copyTextToClipboard } from '../utils/clipboard.js';

/** How long the filename button shows its "Copied" confirmation. */
export const FILENAME_COPIED_MS = 1500;

/** Same-origin library client for persisted heal overlays (fire-and-forget cache I/O). */
const overlayClient = createLibraryClient();

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEPS = Array.from({ length: 11 }, (_, index) => 0.5 + index * 0.25);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

interface LatestHealState {
  edit: EditState;
  method: InpaintMethod | null;
  quality: RepairInpaintBinding['quality'] | undefined;
  seamlessLight: boolean | undefined;
  featherPx: number | undefined;
  run: RunInpaint | null;
}

export type HistogramData = { red: number[]; green: number[]; blue: number[] };

interface PhotoCanvasProps {
  photo: Photo;
  edit: EditState;
  tool: Tool;
  zoom: number;
  compare: boolean;
  showOriginal: boolean;
  /** True-original src for the Compare "Original" layer; omit when photo.src already is the original. */
  originalSrc?: string;
  brushSize: number;
  brushStrength: number;
  /** Worker inpainting for repair strokes; absent means blur repair only. */
  inpaintRepair?: RepairInpaintBinding | null;
  /** Stroke group highlighted from the inspector list (red overlay). */
  highlightStroke?: number | null;
  /** ML removal candidate hovered in the inspector list (red preview). */
  highlightRegion?: DetectionPreview | null;
  /** True while the straighten slider is dragged: the crop grid turns into a fine mesh. */
  fineGrid?: boolean;
  /** Transient no-horizon notice: flashed over the photo through the shared tool-hint overlay. */
  straightenFlash?: { runId: number; message: string } | null;
  /** Zoom-in-view preview: while true a fixed square shows the region under the cursor magnified — docked right of the photo when the stage has room, else in the photo's bottom-right corner. Defaults to false. */
  zoomLens?: boolean;
  /** Zoom-in-view magnification from the View submenu. Defaults to 8. */
  zoomLensMagnification?: ZoomLensMagnification;
  onHighlightStroke?: (stroke: number | null) => void;
  onZoom: (zoom: number) => void;
  onCompare: () => void;
  onFavorite: () => void;
  onRating: (rating: number) => void;
  onInfo: () => void;
  onChange: ChangeEdit;
  onEndMerge?: () => void;
  onHistogram: (data: HistogramData) => void;
}

export function PhotoCanvas({ photo, edit, tool, zoom, compare, showOriginal, originalSrc, brushSize, brushStrength, inpaintRepair, highlightStroke = null, highlightRegion = null, fineGrid = false, straightenFlash = null, zoomLens = false, zoomLensMagnification = ZOOM_LENS_MAGNIFICATION, onHighlightStroke, onZoom, onCompare, onFavorite, onRating, onInfo, onChange, onEndMerge, onHistogram }: PhotoCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<HTMLCanvasElement>(null);
  const lensCanvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  /** Active drag-pan gesture: press point + stage scroll it is measured from. */
  const panDrag = useRef<{ pointerId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [panning, setPanning] = useState(false);
  /** Space held with the canvas focused: the grab-tool override that pans even in the repair brush. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const points = useRef<RetouchPoint[]>([]);
  const lastStamp = useRef<{ x: number; y: number } | null>(null);
  const strokeCounter = useRef(1);
  const activeStrokeRef = useRef<number | null>(null);
  const [activeStroke, setActiveStroke] = useState<number | null>(null);
  const repairGeneration = useRef(0);
  const inpaintRun = useRef<RunInpaint | null>(null);
  inpaintRun.current = inpaintRepair?.run ?? null;
  /** In-memory heal patches per stroke group; cleared on photo change. */
  const healCache = useRef(new Map<number, CachedHealPatch>());
  const healCachePhoto = useRef<string | null>(null);
  /** Geometry the heal cache was built at; a pure quarter-turn rotates patches instead of rehealing. */
  const healGeometry = useRef<{ rotation: number; cropRatio: string; flipH: boolean; flipV: boolean; straighten: number; width: number; height: number } | null>(null);
  /**
   * Pre-straighten anchor patch per group: every straighten tick single-hops
   * from this fixed patch with the total angle instead of chaining
   * tick-to-tick (integer bboxes forget sub-pixel growth every hop, so a
   * naive chain would freeze while the stamps track on). Anchors always sit
   * on the current quarter-turn geometry (rotated eagerly with the cache),
   * carry the softening budget at anchor time, and are settled alongside
   * their cache entry — a cached group never reads a stale anchor. Cleared
   * on photo change; pruned with deleted strokes; harmless when the cache
   * entry is gone (seeds and completions always re-anchor).
   */
  const healStraightenAnchor = useRef(new Map<number, { straighten: number; patch: CachedHealPatch }>());
  /** Ring of recent main-canvas paints: which path painted each frame (test hook only). */
  const paintLog = useRef<{ source: string; key: string; at: number }[]>([]);
  /** Serial heal job queue: one group at a time, repeat clicks schedule follow-ups. */
  const healQueue = useRef<ReturnType<typeof createHealQueue> | null>(null);
  if (!healQueue.current) healQueue.current = createHealQueue();
  /** Persisted overlays fetched at photo open, plus every group saved since. */
  const overlayStore = useRef<StoredHealPatch[]>([]);
  /**
   * Overlay group ids already purged (DELETE fired) for the open photo.
   * Merges skip these so the stale shared fetch can never resurrect them,
   * and sweeps never re-delete them — steady-state slider drags then issue
   * zero heal-overlay requests. Cleared on photo change; a fresh PUT for
   * the id re-arms it (undo can restore a swept stroke).
   */
  const purgedOverlayIds = useRef<Set<number>>(new Set());
  /** Latest committed edit + repair binding, read by deferred jobs at start time. */
  const latestHealState = useRef<LatestHealState | null>(null);
  latestHealState.current = {
    edit,
    method: inpaintRepair?.method ?? null,
    quality: inpaintRepair?.quality,
    seamlessLight: inpaintRepair?.seamlessLight,
    featherPx: inpaintRepair?.featherPx,
    run: inpaintRepair?.run ?? null,
  };
  /** Bumped on photo change/unmount: queued groups abort between groups, never mid-group. */
  const healEpoch = useRef(0);
  const photoIdRef = useRef(photo.id);
  photoIdRef.current = photo.id;
  const [stageSize, setStageSize] = useState({ width: 800, height: 520 });
  const [aspect, setAspect] = useState(1200 / 627);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [split, setSplit] = useState(50);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  /** Filename just copied: the heading button flashes its confirmation. */
  const [filenameCopied, setFilenameCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyFilename = useCallback(() => {
    void copyTextToClipboard(photo.name).then((ok) => {
      if (!ok) return;
      setFilenameCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        copyTimer.current = null;
        setFilenameCopied(false);
      }, FILENAME_COPIED_MS);
    });
  }, [photo.name]);
  /** Repair stroke groups with a heal still in flight (clean canvas + red overlay, never blur). */
  const [pendingRepairIds, setPendingRepairIds] = useState<number[]>([]);
  /** In-flight overlay fetch for the open photo; the main effect awaits it before first paint. */
  const overlayPromise = useRef<Promise<StoredHealPatch[]> | null>(null);
  /**
   * Content key of the last canvas paint (photo + full edit). The instant
   * preview shows whenever the cached key matches current state but differs
   * from what's on screen — robust even if edits arrive in phases.
   */
  const paintedKey = useRef<string | null>(null);
  /** Photo id the last canvas paint belongs to; paired with paintedKey for the switch-flush below. */
  const paintedPhotoId = useRef<string | null>(null);
  /** Last decoded full-res inputs, kept so the Compare "Original" layer can paint on demand (see below). */
  const originalSource = useRef<{ image: HTMLImageElement; trueOriginal: HTMLImageElement | null } | null>(null);
  /** Geometry key the Compare "Original" canvas currently holds; avoids repainting it for non-geometry edits. */
  const originalPaintedKey = useRef<string | null>(null);
  /** Object URL of the cached last render shown instantly while the pipeline prepares. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const setPreviewUrlTracked = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  };
  /** Last preview-cache key written, so repeat paints of one state save once. */
  const lastSavedPreviewKey = useRef<string | null>(null);
  /** Bumped on every canvas paint so the idle-save effect re-evaluates. */
  const [paintCount, setPaintCount] = useState(0);
  const isBrush = tool === 'repair';
  /** Mirror of pendingRepairIds for the read-only e2e hook (state is async). */
  const pendingRef = useRef<number[]>([]);
  pendingRef.current = pendingRepairIds;
  /** Mirror of the ML repair binding: specs wait on readiness, never pixels. */
  const repairReadiness = useRef<{ method: string | null; engine: string | null; ready: boolean | null; warming: boolean }>({ method: null, engine: null, ready: null, warming: false });
  repairReadiness.current = {
    method: inpaintRepair?.method ?? null,
    engine: inpaintRepair?.mlEngine ?? null,
    ready: inpaintRepair?.mlReady ?? null,
    warming: inpaintRepair?.mlWarming ?? false,
  };
  // Read-only Playwright observability: queue depth, cached group ids,
  // pending (still-healing) group ids, persisted overlay group ids, ML tier
  // readiness, and the recorded transport calls. No behavior change; specs
  // read, never write.
  useEffect(() => {
    (window as unknown as { __f8Test?: unknown }).__f8Test = {
      healCalls: () => readTestHealCalls(),
      clearHealCalls: () => clearTestHealCalls(),
      queue: () => ({ active: healQueue.current?.active ?? false, pendingJobs: healQueue.current?.pendingJobs ?? 0 }),
      cacheKeys: () => [...healCache.current.keys()],
      pendingRepairIds: () => [...pendingRef.current],
      overlayGroupIds: () => overlayStore.current.map((entry) => entry.groupId),
      mlReady: () => ({ ...repairReadiness.current }),
      paintLog: () => [...paintLog.current],
      clearPaintLog: () => { paintLog.current = []; },
    };
  }, []);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Flush the previous photo's final pixels into the preview cache on the
  // way out: fast arrowing never idles 2 s on one photo, so the idle save
  // below would never run for visited photos and arrowing back would always
  // re-render. The canvas still holds the previous photo here (the new run
  // has not painted yet), and stale runs can never overwrite the stashed key
  // afterwards — every one of their paints is generation-guarded — so the
  // stashed pair always describes exactly these pixels.
  const flushPreviewCache = () => {
    const key = paintedKey.current;
    const id = paintedPhotoId.current;
    const canvas = canvasRef.current;
    if (!key || !id || !canvas || !canvas.width || !canvas.height) return;
    if (lastSavedPreviewKey.current === key) return;
    lastSavedPreviewKey.current = key;
    void previewBlobFromCanvas(canvas).then((blob) => {
      if (blob) void savePreviewRender(id, key, blob);
    });
  };
  useEffect(() => { flushPreviewCache(); setLoading(true); setError(''); setPendingRepairIds([]); strokeCounter.current = 1; activeStrokeRef.current = null; setActiveStroke(null); healCache.current.clear(); healCachePhoto.current = null; healGeometry.current = null; healStraightenAnchor.current.clear(); paintLog.current = []; overlayStore.current = []; purgedOverlayIds.current = new Set(); healEpoch.current += 1; healQueue.current?.clear(); paintedKey.current = null; paintedPhotoId.current = null; originalSource.current = null; originalPaintedKey.current = null; lastSavedPreviewKey.current = null; setPreviewUrlTracked(null); const myPhotoId = photo.id; overlayPromise.current = loadStoredHealOverlays(overlayClient, myPhotoId); return () => { healEpoch.current += 1; setPreviewUrlTracked(null); if (overlayPromise.current) { const stale = overlayPromise.current; void stale.then(() => { if (overlayPromise.current === stale) overlayPromise.current = null; }); } }; }, [photo.id, photo.src, retry]);

  // A new photo clears any stale "Copied" flash; unmount clears the timer.
  useEffect(() => { setFilenameCopied(false); }, [photo.id]);
  useEffect(() => () => { if (copyTimer.current !== null) clearTimeout(copyTimer.current); }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const generation = repairGeneration.current + 1;
    repairGeneration.current = generation;
    // Live repair drag: skip every bit of canvas work — decode, geometry,
    // render, histogram, and heal scheduling. The base canvas excludes
    // repair stamps so it cannot change mid-drag; only the red SVG overlay
    // (a pure render of the edit state) needs to update, and it paints on
    // the same React render without waiting on the pipeline. Previously
    // every pointermove re-ran the full-res repaint synchronously, blocking
    // the main thread so the patch visibly lagged behind the cursor. The
    // release flips the active stroke back to null, which re-runs this
    // effect and schedules the post-release heal — nothing is lost.
    if (isLiveRepairDrag(tool, activeStroke)) {
      setPendingRepairIds((prev) => (prev.length ? [] : prev));
      return () => { cancelled = true; };
    }
    void (async () => {
      // Content key of the state this run will paint; doubles as the
      // preview-cache key.
      const runKey = previewRenderKey(photo.id, photo.src, edit);
      // Image decode starts immediately so it overlaps the cache read below.
      const imagePromise = loadImage(photo.src);
      // While a derived base (denoised pixels) is on screen, the Compare
      // "Original" side decodes the true original alongside — otherwise both
      // sides would show denoised pixels and Compare would show nothing.
      const extraOriginalSrc = separateOriginalSrc(photo.src, originalSrc);
      const trueOriginalPromise = extraOriginalSrc ? loadImage(extraOriginalSrc) : null;
      // Instant preview: the cached last render is pixel-identical when its
      // version key matches, so it shows immediately while the pipeline
      // prepares behind it and swaps in invisibly. Shows whenever the canvas
      // doesn't already hold this exact state — even if an earlier run
      // painted something else first. Every photo reads it, not just
      // repaired ones: arrowing back to a visited photo skips the visible
      // re-render either way (the key still has to match exactly). Loading
      // stays true until the real paint lands: clearing it here would unhide
      // the stale canvas (the previous photo's pixels, CSS-stretched into
      // this frame, visible until the <img> blob decodes) and flip the frame
      // to the previous photo's measured aspect — a stretched flash that
      // snaps correct on paint. The spinner pill hides behind the preview
      // instead (see the render below), so the instant pixels stay clean.
      const repairsAtStart = edit.retouches.filter((point) => point.kind === 'repair');
      if (paintedKey.current !== runKey && canvasRef.current) {
        try {
          const cached = await loadPreviewRender(photo.id, runKey);
          if (cached && !cancelled && repairGeneration.current === generation && paintedKey.current !== runKey && canvasRef.current) {
            setPreviewUrlTracked(URL.createObjectURL(cached));
            paintLog.current.push({ source: 'preview-cache', key: runKey, at: Date.now() });
            if (paintLog.current.length > 60) paintLog.current.splice(0, paintLog.current.length - 60);
          }
        } catch { /* The pipeline paint below is the fallback. */ }
      }
      let image: HTMLImageElement;
      try {
        image = await imagePromise;
      } catch (reason) {
        if (!cancelled && repairGeneration.current === generation) {
          setError(reason instanceof Error ? reason.message : 'This photo could not be loaded. Check your connection and try again.');
          setLoading(false);
        }
        return;
      }
      // The true original is best-effort: a decode failure falls back to the
      // display image (the old Compare behavior) rather than failing the run.
      let trueOriginal: HTMLImageElement | null = null;
      if (trueOriginalPromise) {
        try {
          trueOriginal = await trueOriginalPromise;
        } catch { trueOriginal = null; }
      }
      // Best-effort: drop server overlays for deleted strokes. Safe to call
      // from any branch — only entries with no live stroke are deleted, and
      // each id is deleted at most once per photo (the planner evicts
      // already-purged ids locally without re-firing DELETE).
      const sweepOrphanOverlays = (live: Set<number>) => {
        const planned = planHealOrphanSweep(overlayStore.current, live, purgedOverlayIds.current);
        if (planned.keep.length === overlayStore.current.length) return;
        overlayStore.current = planned.keep;
        for (const groupId of planned.deleteIds) {
          purgedOverlayIds.current.add(groupId);
          void overlayClient.deleteHealOverlay(photo.id, groupId).catch(() => undefined);
        }
      };
      // Heal-then-rotate reuses pixels: a pure quarter-turn rotates the
      // in-memory patches and persisted overlays (bbox + pixels + signatures)
      // instead of re-running inference, and a straighten-only change
      // resamples them the same way (single-hopping from the fixed anchor
      // with the total angle, never chaining tick-to-tick). Any other
      // geometry change, a crop-window resize, an exhausted resample budget,
      // or a corrupt patch skips the transform and that group reheals below.
      // Returns the transformed overlays so the caller persists the new
      // geometry to the server; a reload otherwise reheals.
      const snapshotAnchor = (id: number, straighten: number, patch: CachedHealPatch) => {
        healStraightenAnchor.current.set(id, { straighten, patch: { ...patch, data: patch.data.slice() } });
      };
      const rotateHealCachesForGeometry = (
        baseEdit: { cropRatio: string; rotation: number; flipH: boolean; flipV: boolean; straighten: number },
        width: number,
        height: number,
        groups: RetouchStrokeGroup[],
        params: HealCacheParams,
        sourceAspect: number,
      ): StoredHealPatch[] => {
        const prev = healGeometry.current;
        const next = { rotation: baseEdit.rotation, cropRatio: baseEdit.cropRatio, flipH: baseEdit.flipH, flipV: baseEdit.flipV, straighten: baseEdit.straighten, width, height };
        if (!prev) {
          healGeometry.current = next;
          return [];
        }
        if (prev.cropRatio !== next.cropRatio || prev.flipH !== next.flipH || prev.flipV !== next.flipV) {
          healStraightenAnchor.current.clear();
          healGeometry.current = next;
          return [];
        }
        if (!Number.isFinite(prev.straighten) || !Number.isFinite(next.straighten)) {
          healStraightenAnchor.current.clear();
          healGeometry.current = next;
          return [];
        }
        const rotChanged = prev.rotation !== next.rotation;
        const straightDelta = next.straighten - prev.straighten;
        const straightChanged = straightDelta !== 0;
        if (rotChanged && straightChanged) {
          healStraightenAnchor.current.clear();
          healGeometry.current = next;
          return [];
        }
        if (!rotChanged && !straightChanged) {
          if (prev.width !== width || prev.height !== height) healStraightenAnchor.current.clear();
          healGeometry.current = next;
          return [];
        }
        const groupById = new Map(groups.map((group) => [group.id, group]));
        for (const id of [...healStraightenAnchor.current.keys()]) {
          if (!groupById.has(id)) healStraightenAnchor.current.delete(id);
        }
        const rotatedOverlays: StoredHealPatch[] = [];
        if (rotChanged) {
          const steps = clockwiseStepsForRotation(prev.rotation, next.rotation);
          if (steps === null || steps === 0) {
            healGeometry.current = next;
            return [];
          }
          const nextOverlays: StoredHealPatch[] = [];
          for (const overlay of overlayStore.current) {
            const group = groupById.get(overlay.groupId);
            if (!group) {
              nextOverlays.push(overlay);
              continue;
            }
            // Already current (a drifted completion landed ahead of this run):
            // the signature embeds the full geometry key, so equality means no
            // rotation is needed. Without this the patch would be turned twice.
            if (overlay.signature === signatureForHealGroup(group, params) && overlay.canvasWidth === width && overlay.canvasHeight === height) {
              nextOverlays.push(overlay);
              continue;
            }
            const rotated = rotateHealPatch(overlay, overlay.canvasWidth, overlay.canvasHeight, width, height, steps);
            if (!rotated) continue;
            const fresh: StoredHealPatch = { ...rotated, groupId: overlay.groupId, geometryKey: params.geometryKey, canvasWidth: width, canvasHeight: height, signature: signatureForHealGroup(group, params) };
            nextOverlays.push(fresh);
            rotatedOverlays.push(fresh);
          }
          overlayStore.current = nextOverlays;
          for (const [id, patch] of [...healCache.current.entries()]) {
            const group = groupById.get(id);
            if (!group) continue;
            const sig = signatureForHealGroup(group, params);
            if (patch.signature === sig) continue;
            const rotated = rotateHealPatch(patch, prev.width, prev.height, width, height, steps);
            if (!rotated) {
              healCache.current.delete(id);
              healStraightenAnchor.current.delete(id);
              continue;
            }
            rotated.signature = sig;
            healCache.current.set(id, rotated);
            // The anchor turns losslessly with the pixels, keeping its
            // straighten angle and softening budget; a missing anchor
            // snapshots the rotated patch (single-hopping from the current
            // state stays exact).
            const anchor = healStraightenAnchor.current.get(id);
            if (anchor) {
              const turnedAnchor = rotateHealPatch(anchor.patch, prev.width, prev.height, width, height, steps);
              if (turnedAnchor) healStraightenAnchor.current.set(id, { straighten: anchor.straighten, patch: turnedAnchor });
              else healStraightenAnchor.current.delete(id);
            } else {
              snapshotAnchor(id, next.straighten, rotated);
            }
          }
          healGeometry.current = next;
          return rotatedOverlays;
        }
        // Straighten-only: the canvas dims are identical on both sides, so a
        // mismatch means something else moved and the group must reheal.
        if (prev.width !== width || prev.height !== height) {
          healStraightenAnchor.current.clear();
          healGeometry.current = next;
          return [];
        }
        // Anchor protocol: every tick single-hops from the fixed pre-drag
        // anchor with the total angle. Chaining tick-to-tick would freeze:
        // integer bboxes forget sub-pixel growth every hop, so the patch
        // would stop tracking the turn while the stamps (floats) move on.
        for (const [id, patch] of [...healCache.current.entries()]) {
          const group = groupById.get(id);
          if (!group) continue;
          const sig = signatureForHealGroup(group, params);
          if (patch.signature === sig) continue;
          const anchor = healStraightenAnchor.current.get(id);
          const source = anchor?.patch ?? patch;
          const fromAngle = anchor?.straighten ?? prev.straighten;
          const totalDelta = next.straighten - fromAngle;
          if (!straightenResampleAllowed(source.resampleDeg, totalDelta)) {
            healCache.current.delete(id);
            healStraightenAnchor.current.delete(id);
            continue;
          }
          const resampled = resampleHealPatchForStraighten(source, width, height, {
            fromStraighten: fromAngle,
            toStraighten: next.straighten,
            sourceAspect,
          });
          if (!resampled) {
            healCache.current.delete(id);
            healStraightenAnchor.current.delete(id);
            continue;
          }
          resampled.signature = sig;
          healCache.current.set(id, resampled);
          if (!anchor) snapshotAnchor(id, prev.straighten, patch);
        }
        const resampleOpts = { fromStraighten: prev.straighten, toStraighten: next.straighten, sourceAspect };
        const nextOverlays: StoredHealPatch[] = [];
        for (const overlay of overlayStore.current) {
          const group = groupById.get(overlay.groupId);
          if (!group) {
            nextOverlays.push(overlay);
            continue;
          }
          if (overlay.signature === signatureForHealGroup(group, params) && overlay.canvasWidth === width && overlay.canvasHeight === height) {
            nextOverlays.push(overlay);
            continue;
          }
          const cached = healCache.current.get(overlay.groupId);
          if (cached && cached.signature === signatureForHealGroup(group, params)) {
            // Cached groups persist the sharp single-hop result, never a
            // progressive re-resample of the stored bytes.
            const fresh: StoredHealPatch = { ...cached, data: cached.data.slice(), groupId: overlay.groupId, geometryKey: params.geometryKey, canvasWidth: width, canvasHeight: height };
            nextOverlays.push(fresh);
            rotatedOverlays.push(fresh);
            continue;
          }
          // Cache-missing groups (e.g. LRU-evicted) resample the stored bytes
          // so they can still seed without inference; a failure drops the
          // entry and the group reheals below.
          if (overlay.canvasWidth !== width || overlay.canvasHeight !== height) continue;
          if (!straightenResampleAllowed(overlay.resampleDeg, straightDelta)) continue;
          const resampled = resampleHealPatchForStraighten(overlay, width, height, resampleOpts);
          if (!resampled) continue;
          const fresh: StoredHealPatch = { ...resampled, groupId: overlay.groupId, geometryKey: params.geometryKey, canvasWidth: width, canvasHeight: height, signature: signatureForHealGroup(group, params) };
          nextOverlays.push(fresh);
          rotatedOverlays.push(fresh);
        }
        overlayStore.current = nextOverlays;
        healGeometry.current = next;
        return rotatedOverlays;
      };
      // First paint waits for saved work: no clean flash, no pop-in. Photos
      // without repairs skip the wait (nothing to composite, and an offline
      // hang must never block them).
      if (repairsAtStart.length > 0) {
        let fetched: StoredHealPatch[] = [];
        try {
          fetched = (await overlayPromise.current) ?? [];
        } catch { fetched = []; }
        // Session-saved groups win over the fetch (a PUT may have landed
        // after the GET started); purged ids stay dead so overlapping runs
        // sharing this fetch never resurrect them.
        if (fetched.length || overlayStore.current.length) {
          overlayStore.current = mergeFetchedHealOverlays(fetched, overlayStore.current, purgedOverlayIds.current);
        }
        // Current generation only: a stale run's live set predates newer
        // strokes, so sweeping with it could purge work that is live again.
        if (!cancelled && repairGeneration.current === generation) {
          sweepOrphanOverlays(new Set(repairsAtStart.map((point) => strokeIdForPoint(point))));
        }
      } else if (overlayPromise.current) {
        // One shot per photo: the ref clears when the fetch settles, so
        // later slider ticks don't reseed the store from the stale list and
        // re-delete the same orphans. The promise object is captured, so a
        // run cancelled before settle still leaves every waiter holding the
        // data — clearing the ref only stops future schedulers.
        const pending = overlayPromise.current;
        void pending.then((patches) => {
          if (overlayPromise.current === pending) overlayPromise.current = null;
          if (cancelled) return;
          if (patches.length && !overlayStore.current.length) {
            overlayStore.current = mergeFetchedHealOverlays(patches, overlayStore.current, purgedOverlayIds.current);
          }
          sweepOrphanOverlays(new Set());
        }).catch(() => undefined);
      }
      if (cancelled || repairGeneration.current !== generation || !canvasRef.current || !originalRef.current) return;
      const notePaint = (source: string) => {
        paintLog.current.push({ source, key: runKey, at: Date.now() });
        if (paintLog.current.length > 60) paintLog.current.splice(0, paintLog.current.length - 60);
      };
      const renderBase = (base: HTMLCanvasElement, source: string) => {
        notePaint(source);
        const canvas = canvasRef.current!;
        const adjusted = renderAdjustedCanvas(base, edit);
        canvas.width = adjusted.width;
        canvas.height = adjusted.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(adjusted, 0, 0);
        drawEffects(ctx, adjusted.width, adjusted.height, edit);
        setAspect(adjusted.width / adjusted.height);

        const sampler = document.createElement('canvas');
        sampler.width = 160;
        sampler.height = 100;
        const sampleCtx = sampler.getContext('2d', { willReadFrequently: true })!;
        sampleCtx.drawImage(canvas, 0, 0, 160, 100);
        const pixels = sampleCtx.getImageData(0, 0, 160, 100).data;
        const histogram: HistogramData = { red: Array(64).fill(0), green: Array(64).fill(0), blue: Array(64).fill(0) };
        for (let i = 0; i < pixels.length; i += 4) {
          const r = (pixels[i] ?? 0) >> 2;
          const g = (pixels[i + 1] ?? 0) >> 2;
          const b = (pixels[i + 2] ?? 0) >> 2;
          histogram.red[r] = (histogram.red[r] ?? 0) + 1;
          histogram.green[g] = (histogram.green[g] ?? 0) + 1;
          histogram.blue[b] = (histogram.blue[b] ?? 0) + 1;
        }
        onHistogram(histogram);
      };
      // Live drags never reach this run (the early return above owns them),
      // so the single paint below already contains the final healed pixels
      // — saved work is composited before anything becomes visible, so
      // reloads never flash clean first.
      const repairs = edit.retouches.filter((point) => point.kind === 'repair');
      const run = inpaintRun.current;
      const method = inpaintRepair?.method;
      // Distinct heal groups (strokes) covered by this pass, for progress
      // copy ("Repairing 3 areas…"). Points share a stroke id per drag.
      const areas = new Set(repairs.map((point) => strokeIdForPoint(point))).size;
      const repairOptions = {
        quality: inpaintRepair?.quality,
        seamlessLight: inpaintRepair?.seamlessLight,
        featherPx: inpaintRepair?.featherPx,
        areas,
      };
      // Single clean base for this run: repairs excluded, healed patches
      // composited below before the only paint. One geometry
      // pass feeds seeding, partitioning, and rendering alike.
      const baseEditSync = { ...edit, retouches: edit.retouches.filter((point) => point.kind !== 'repair') };
      // The Compare "Original" layer paints on demand (the effect below owns
      // it): while Compare and Show Original are off the layer is clipped to
      // zero width, so the pipeline skips its geometry pass on every
      // navigation and only stashes the decoded inputs here.
      originalSource.current = { image, trueOriginal };
      const finishPaint = () => {
        paintedKey.current = runKey;
        paintedPhotoId.current = photo.id;
        setPreviewUrlTracked(null);
        setLoading(false);
        setPaintCount((count) => count + 1);
      };
      const maybeSavePreview = (key: string) => {
        // Stash the final on-screen pixels for instant reloads. Only the
        // latest pipeline state may write (a newer run owns its own save).
        if (lastSavedPreviewKey.current === key || !canvasRef.current || repairGeneration.current !== generation) return;
        lastSavedPreviewKey.current = key;
        const canvas = canvasRef.current;
        void previewBlobFromCanvas(canvas).then((blob) => {
          if (blob && repairGeneration.current === generation) void savePreviewRender(photo.id, key, blob);
        });
      };
      // True when the queue below must run; false once everything is cached —
      // the single paint above already shows the final state.
      let needsQueue = true;
      if ((method === 'ml-heal' || method === 'heal') && repairs.length && canvasRef.current) {
        // Finished groups stay visibly healed while follow-up groups heal:
        // valid patches composite here, dirty areas stay clean with a red
        // mask until their group heals. Pending ids drive the red overlay:
        // dirty groups only, so finished work is never covered.
        try {
          if (healCachePhoto.current !== photo.src) {
            healCache.current.clear();
            healCachePhoto.current = photo.src;
            healGeometry.current = null;
          }
          const cleanOne = geometryCanvas(image, baseEditSync);
          const syncWidth = cleanOne.width;
          const syncHeight = cleanOne.height;
          if (Number.isInteger(syncWidth) && Number.isInteger(syncHeight) && syncWidth > 0 && syncHeight > 0) {
            const syncParams = {
              method,
              quality: inpaintRepair?.quality,
              seamlessLight: inpaintRepair?.seamlessLight,
              featherPx: inpaintRepair?.featherPx,
              geometryKey: geometryKeyForHealCache(photo.src, baseEditSync, syncWidth, syncHeight),
            };
            const syncGroups = groupRetouchStrokes(repairs).filter((group) => group.kind === 'repair');
            const rotatedSync = rotateHealCachesForGeometry(baseEditSync, syncWidth, syncHeight, syncGroups, syncParams, photo.width / photo.height);
            if (rotatedSync.length) {
              // Fire-and-forget: the paint below must not wait for the
              // network, or a straighten drag's overlapping runs partition
              // against a newer cache and flash clean frames between healed
              // paints (flicker). Dispatch order is still tick order; only
              // the paint stops waiting.
              void Promise.all(rotatedSync.map((entry) => overlayClient.saveHealOverlay(photo.id, entry.groupId, overlayBodyFromPatch(entry, { geometryKey: entry.geometryKey, canvasWidth: entry.canvasWidth, canvasHeight: entry.canvasHeight, method, quality: syncParams.quality, featherPx: syncParams.featherPx })).catch((reason: unknown) => {
                if (reason instanceof LibraryError && reason.status >= 400 && reason.status < 500) {
                  console.warn(`[heal] Overlay rotate rejected for group ${entry.groupId}: ${reason.message}`);
                }
              })));
            }
            if (cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
            for (const group of syncGroups) {
              if (healCache.current.has(group.id)) continue;
              const overlay = reusableOverlayForGroup(overlayStore.current, group, syncParams);
              if (!overlay || overlay.canvasWidth !== syncWidth || overlay.canvasHeight !== syncHeight) continue;
              healCache.current.set(group.id, { signature: signatureForHealGroup(group, syncParams), x0: overlay.x0, y0: overlay.y0, width: overlay.width, height: overlay.height, data: overlay.data.slice(), resampleDeg: overlay.resampleDeg });
              const seeded = healCache.current.get(group.id);
              if (seeded) snapshotAnchor(group.id, baseEditSync.straighten, seeded);
            }
            // Best-effort: drop server overlays for deleted strokes.
            sweepOrphanOverlays(new Set(syncGroups.map((group) => group.id)));
            const syncPart = partitionHealGroups(repairs, healCache.current, syncParams, syncWidth, syncHeight);
            const syncPatches = syncPart.valid.flatMap((group) => {
              const entry = healCache.current.get(group.id);
              return entry ? [entry] : [];
            });
            if (syncPatches.length) {
              const syncCtx = cleanOne.getContext('2d')!;
              const syncPixels = syncCtx.getImageData(0, 0, syncWidth, syncHeight);
              const syncSource = { width: syncWidth, height: syncHeight, data: new Uint8ClampedArray(syncPixels.data) };
              const composited = pasteHealPatches(syncSource, syncPatches);
              const bytes = new Uint8ClampedArray(composited.data.length);
              bytes.set(composited.data);
              syncCtx.putImageData(new ImageData(bytes, syncWidth, syncHeight), 0, 0);
            }
            renderBase(cleanOne, 'sync-heal');
            // Only still-dirty groups stay red; cached groups already show healed.
            const dirtyIds = syncPart.dirty.map((group) => group.id);
            setPendingRepairIds((prev) => (prev.length === dirtyIds.length && prev.every((id) => dirtyIds.includes(id)) ? prev : dirtyIds));
            finishPaint();
            if (!syncPart.dirty.length) {
              needsQueue = false;
              // Undo/redo can restore strokes from the in-memory cache after
              // their server overlays were purged as orphans: re-persist the
              // missing ones so a reload never reheals finished work.
              const storedSync = new Set(overlayStore.current.map((entry) => entry.groupId));
              for (const group of syncPart.valid) {
                if (storedSync.has(group.id)) continue;
                const patch = healCache.current.get(group.id);
                if (!patch) continue;
                // A fresh save re-arms the id (undo can restore a swept
                // stroke): a later delete must DELETE it again.
                purgedOverlayIds.current.delete(group.id);
                overlayStore.current.push({ ...patch, data: patch.data.slice(), groupId: group.id, geometryKey: syncParams.geometryKey, canvasWidth: syncWidth, canvasHeight: syncHeight });
                storedSync.add(group.id);
                await overlayClient.saveHealOverlay(photo.id, group.id, overlayBodyFromPatch(patch, { geometryKey: syncParams.geometryKey, canvasWidth: syncWidth, canvasHeight: syncHeight, method, quality: syncParams.quality, featherPx: syncParams.featherPx })).catch((reason: unknown) => {
                  if (reason instanceof LibraryError && reason.status >= 400 && reason.status < 500) {
                    console.warn(`[heal] Overlay re-persist rejected for group ${group.id}: ${reason.message}`);
                  }
                });
              }
              if (syncPatches.length) maybeSavePreview(runKey);
            }
          } else {
            const fallbackIds = [...new Set(repairs.map((point) => strokeIdForPoint(point)))];
            setPendingRepairIds((prev) => (prev.length === fallbackIds.length && prev.every((id) => fallbackIds.includes(id)) ? prev : fallbackIds));
            finishPaint();
          }
        } catch {
          // Leave previous pixels up (spinner/preview covers photo opens);
          // mark areas red instead of flashing a blurry placeholder.
          const fallbackIds = [...new Set(repairs.map((point) => strokeIdForPoint(point)))];
          setPendingRepairIds((prev) => (prev.length === fallbackIds.length && prev.every((id) => fallbackIds.includes(id)) ? prev : fallbackIds));
        }
      } else if (method && method !== 'ml-heal' && method !== 'heal' && repairs.length && run) {
        // Telea/NS keep the single full-pass path: clean single paint now,
        // worker upgrade when it lands.
        renderBase(geometryCanvas(image, baseEditSync), 'sync-fullpass');
        const allIds = [...new Set(repairs.map((point) => strokeIdForPoint(point)))];
        setPendingRepairIds((prev) => (prev.length === allIds.length && prev.every((id) => allIds.includes(id)) ? prev : allIds));
        finishPaint();
      } else {
        // Undo/reset/clear-all land here with zero repairs, and the heal
        // branches above never run to sweep — drop orphan overlays now so
        // the server never keeps pixels for strokes that no longer exist.
        // With live repairs (e.g. no repair method bound) this is a noop.
        sweepOrphanOverlays(new Set(edit.retouches.filter((point) => point.kind === 'repair').map((point) => strokeIdForPoint(point))));
        renderBase(geometryCanvas(image, edit), 'sync-fallback');
        setPendingRepairIds((prev) => (prev.length ? [] : prev));
        finishPaint();
      }
      // The single paint above already shows the final state when nothing is
      // dirty, so the queue only runs for groups that still need inference.
      if (needsQueue && repairs.length && run && method) {
        timer = window.setTimeout(() => {
          if (cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
          // heal/ml-heal heals each stroke group once, saves the overlay,
          // and caches the patch, so adding another area only heals the
          // new group with the current settings — saved groups are never
          // re-healed. Jobs run strictly one at a time through the serial
          // queue: repeat clicks schedule follow-up jobs (planned at start
          // time against the latest cache), never parallel inferences.
          // The running group is never cancelled; only a photo change or
          // unmount aborts between groups. Telea/NS keep the single
          // full-pass path.
          if (method === 'ml-heal' || method === 'heal') {
            const methodAtEnqueue = method;
            const myPhotoId = photo.id;
            const myPhotoSrc = photo.src;
            const myEpoch = healEpoch.current;
            const queue = healQueue.current;
            timer = window.setTimeout(() => {
              if (cancelled || repairGeneration.current !== generation || !canvasRef.current || !queue) return;
              void queue.enqueue({
                shouldAbort: () => healEpoch.current !== myEpoch || photoIdRef.current !== myPhotoId,
                prepare: () => {
                  if (healEpoch.current !== myEpoch || photoIdRef.current !== myPhotoId || !canvasRef.current) return null;
                  const latest = latestHealState.current;
                  // Method switched while queued: drop, the other path owns it now.
                  if (!latest || latest.method !== methodAtEnqueue || !latest.run) return null;
                  const currentRepairs = latest.edit.retouches.filter((point) => point.kind === 'repair');
                  if (!currentRepairs.length) return null;
                  const baseEdit = { ...latest.edit, retouches: latest.edit.retouches.filter((point) => point.kind !== 'repair') };
                  const clean = geometryCanvas(image, baseEdit);
                  const width = clean.width;
                  const height = clean.height;
                  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
                  if (healCachePhoto.current !== myPhotoSrc) {
                    healCache.current.clear();
                    healCachePhoto.current = myPhotoSrc;
                    healGeometry.current = null;
                  }
                  const cacheParams = {
                    method: methodAtEnqueue,
                    quality: latest.quality,
                    seamlessLight: latest.seamlessLight,
                    featherPx: latest.featherPx,
                    geometryKey: geometryKeyForHealCache(myPhotoSrc, baseEdit, width, height),
                  };
                  // Seed from persisted overlays so reopening never reheals
                  // saved work: reuse ignores heal settings, so a method
                  // switch never invalidates finished groups. Preview dims
                  // are stable per edit, so only exact-size overlays seed
                  // here (export rescales instead).
                  const groups = groupRetouchStrokes(currentRepairs).filter((group) => group.kind === 'repair');
                  const rotatedQueued = rotateHealCachesForGeometry(baseEdit, width, height, groups, cacheParams, photo.width / photo.height);
                  for (const entry of rotatedQueued) {
                    void overlayClient.saveHealOverlay(myPhotoId, entry.groupId, overlayBodyFromPatch(entry, { geometryKey: entry.geometryKey, canvasWidth: entry.canvasWidth, canvasHeight: entry.canvasHeight, method: methodAtEnqueue, quality: latest.quality, featherPx: latest.featherPx })).catch((reason: unknown) => {
                      if (reason instanceof LibraryError && reason.status >= 400 && reason.status < 500) {
                        console.warn(`[heal] Overlay rotate rejected for group ${entry.groupId}: ${reason.message}`);
                      }
                    });
                  }
                  for (const group of groups) {
                    if (healCache.current.has(group.id)) continue;
                    const overlay = reusableOverlayForGroup(overlayStore.current, group, cacheParams);
                    if (!overlay || overlay.canvasWidth !== width || overlay.canvasHeight !== height) continue;
                    healCache.current.set(group.id, { signature: signatureForHealGroup(group, cacheParams), x0: overlay.x0, y0: overlay.y0, width: overlay.width, height: overlay.height, data: overlay.data.slice(), resampleDeg: overlay.resampleDeg });
                    const seeded = healCache.current.get(group.id);
                    if (seeded) snapshotAnchor(group.id, baseEdit.straighten, seeded);
                  }
                  // Best-effort: drop server overlays for deleted strokes.
                  // Each id is deleted at most once per photo, like the
                  // effect sweep above.
                  const planned = planHealOrphanSweep(overlayStore.current, new Set(groups.map((group) => group.id)), purgedOverlayIds.current);
                  if (planned.keep.length !== overlayStore.current.length) {
                    overlayStore.current = planned.keep;
                    for (const groupId of planned.deleteIds) {
                      purgedOverlayIds.current.add(groupId);
                      void overlayClient.deleteHealOverlay(myPhotoId, groupId).catch(() => undefined);
                    }
                  }
                  const { valid, dirty } = partitionHealGroups(currentRepairs, healCache.current, cacheParams, width, height);
                  const validPatches = valid.flatMap((group) => {
                    const entry = healCache.current.get(group.id);
                    return entry ? [entry] : [];
                  });
                  const cleanCtx = clean.getContext('2d')!;
                  const cleanPixels = cleanCtx.getImageData(0, 0, width, height);
                  const source = { width, height, data: new Uint8ClampedArray(cleanPixels.data) };
                  // Stacked sourcing: dirty groups heal against the
                  // repaired-so-far image — finished patches over the clean
                  // base — so a touch-up overlapping an older repair sees
                  // repaired pixels, not the original blemish. Display
                  // compositing (renderPatches) still pastes over the clean
                  // base; only the inference input changes.
                  const healSource = repairedBaseForHealJob(source, validPatches);
                  const renderPatches = (patches: CachedHealPatch[]) => {
                    if (healEpoch.current !== myEpoch || photoIdRef.current !== myPhotoId || !canvasRef.current) return;
                    if (!patches.length) return;
                    const composited = pasteHealPatches(source, patches);
                    const bytes = new Uint8ClampedArray(composited.data.length);
                    bytes.set(composited.data);
                    cleanCtx.putImageData(new ImageData(bytes, width, height), 0, 0);
                    renderBase(clean, 'queue');
                  };
                  if (!dirty.length) {
                    // Everything cached (e.g. seeded from the server):
                    // composite with no inference and no progress flash.
                    renderPatches(validPatches);
                    return null;
                  }
                  const fresh: CachedHealPatch[] = [];
                  // The effect's clean base (and a just-finished prior
                  // job's stale render) both hide already-healed groups.
                  // Recomposite them now so the new job starts from
                  // finished work instead of flashing it away until the
                  // first new group lands.
                  renderPatches(validPatches);
                  return {
                    source: healSource,
                    groups: dirty,
                    method: methodAtEnqueue,
                    runInpaint: latest.run,
                    options: { quality: latest.quality, seamlessLight: latest.seamlessLight, featherPx: latest.featherPx, areas: dirty.length },
                    shouldAbort: () => healEpoch.current !== myEpoch || photoIdRef.current !== myPhotoId,
                    onGroupDone: async (patch, group) => {
                      if (healEpoch.current !== myEpoch || photoIdRef.current !== myPhotoId) return;
                      // A stroke deleted mid-heal leaves no overlay behind.
                      const liveIds = new Set((latestHealState.current?.edit.retouches ?? []).map((point) => strokeIdForPoint(point)));
                      if (!liveIds.has(group.id)) { setPendingRepairIds((prev) => (prev.includes(group.id) ? prev.filter((id) => id !== group.id) : prev)); return; }
                      // Geometry drifted mid-heal (e.g. rotated while this job
                      // ran): job-geometry pixels must never be cached,
                      // persisted, or painted as current — that clobbers the
                      // turned state and forces a reheal. A pure quarter-turn
                      // rotates the fresh patch onto the current geometry and
                      // a straighten-only drift resamples it (the queued newer
                      // job paints it); anything else drops it so the newer
                      // job reheals. Either way this handler must not render:
                      // its source is job-geometry sized.
                      const curEdit = latestHealState.current?.edit;
                      const jobGeo = { rotation: baseEdit.rotation, cropRatio: baseEdit.cropRatio, flipH: baseEdit.flipH, flipV: baseEdit.flipV, straighten: baseEdit.straighten };
                      const drifted = !curEdit || curEdit.rotation !== jobGeo.rotation || curEdit.cropRatio !== jobGeo.cropRatio || curEdit.flipH !== jobGeo.flipH || curEdit.flipV !== jobGeo.flipV || curEdit.straighten !== jobGeo.straighten;
                      if (drifted) {
                        if (curEdit) {
                          const sameCropFlips = curEdit.cropRatio === jobGeo.cropRatio && curEdit.flipH === jobGeo.flipH && curEdit.flipV === jobGeo.flipV;
                          const rotChanged = curEdit.rotation !== jobGeo.rotation;
                          const straightDelta = Number.isFinite(curEdit.straighten) && Number.isFinite(jobGeo.straighten) ? curEdit.straighten - jobGeo.straighten : Number.NaN;
                          const straightChanged = straightDelta !== 0;
                          if (sameCropFlips && (rotChanged !== straightChanged)) {
                            const curRepairs = curEdit.retouches.filter((point) => point.kind === 'repair');
                            const curGroup = groupRetouchStrokes(curRepairs).filter((entry) => entry.kind === 'repair').find((entry) => entry.id === group.id);
                            if (curGroup) {
                              const curBase = { ...curEdit, retouches: curEdit.retouches.filter((point) => point.kind !== 'repair') };
                              const curClean = geometryCanvas(image, curBase);
                              const curKey = geometryKeyForHealCache(myPhotoSrc, curBase, curClean.width, curClean.height);
                              const curParams = { method: methodAtEnqueue, quality: latest.quality, seamlessLight: latest.seamlessLight, featherPx: latest.featherPx, geometryKey: curKey };
                              let turned: CachedHealPatch | null = null;
                              if (rotChanged) {
                                const turnSteps = clockwiseStepsForRotation(jobGeo.rotation, curEdit.rotation);
                                if (turnSteps !== null && turnSteps !== 0) {
                                  turned = rotateHealPatch(patch, width, height, curClean.width, curClean.height, turnSteps);
                                }
                              } else if (curClean.width === width && curClean.height === height && straightenResampleAllowed(patch.resampleDeg, straightDelta)) {
                                turned = resampleHealPatchForStraighten(patch, width, height, { fromStraighten: jobGeo.straighten, toStraighten: curEdit.straighten, sourceAspect: photo.width / photo.height });
                              }
                              if (turned) {
                                turned.signature = signatureForHealGroup(curGroup, curParams);
                                healCache.current.set(group.id, turned);
                                snapshotAnchor(group.id, curEdit.straighten, turned);
                                enforceHealCacheLimit(healCache.current);
                                overlayStore.current = overlayStore.current.filter((entry) => entry.groupId !== group.id && healCache.current.has(entry.groupId));
                                purgedOverlayIds.current.delete(group.id);
                                overlayStore.current.push({ ...turned, data: turned.data.slice(), groupId: group.id, geometryKey: curKey, canvasWidth: curClean.width, canvasHeight: curClean.height });
                                await overlayClient.saveHealOverlay(myPhotoId, group.id, overlayBodyFromPatch(turned, { geometryKey: curKey, canvasWidth: curClean.width, canvasHeight: curClean.height, method: methodAtEnqueue, quality: latest.quality, featherPx: latest.featherPx })).catch((reason: unknown) => {
                                  if (reason instanceof LibraryError && reason.status >= 400 && reason.status < 500) {
                                    console.warn(`[heal] Overlay drift persist rejected for group ${group.id}: ${reason.message}`);
                                  }
                                });
                              }
                            }
                          }
                        }
                        return;
                      }
                      patch.signature = signatureForHealGroup(group, cacheParams);
                      healCache.current.set(group.id, patch);
                      snapshotAnchor(group.id, baseEdit.straighten, patch);
                      fresh.push(patch);
                      renderPatches([...validPatches, ...fresh]);
                      setPendingRepairIds((prev) => (prev.includes(group.id) ? prev.filter((id) => id !== group.id) : prev));
                      enforceHealCacheLimit(healCache.current);
                      overlayStore.current = overlayStore.current.filter((entry) => entry.groupId !== group.id && healCache.current.has(entry.groupId));
                      purgedOverlayIds.current.delete(group.id);
                      overlayStore.current.push({ ...patch, data: patch.data.slice(), groupId: group.id, geometryKey: cacheParams.geometryKey, canvasWidth: width, canvasHeight: height });
                      // Persist before the next group starts: reopening can
                      // never lose a finished group. Transient failures keep
                      // the in-memory patch for this session; a 4xx is our
                      // own malformed payload (a bug), so it warns instead
                      // of vanishing silently.
                      await overlayClient.saveHealOverlay(myPhotoId, group.id, overlayBodyFromPatch(patch, { geometryKey: cacheParams.geometryKey, canvasWidth: width, canvasHeight: height, method: methodAtEnqueue, quality: latest.quality, featherPx: latest.featherPx })).catch((reason: unknown) => {
                        if (reason instanceof LibraryError && reason.status >= 400 && reason.status < 500) {
                          console.warn(`[heal] Overlay persist rejected for group ${group.id}: ${reason.message}`);
                        }
                      });
                      // Stash the final on-screen pixels once every group is
                      // healed, so the next open shows instantly. Only the
                      // latest pipeline state may write.
                      const cur = latestHealState.current;
                      const liveGroups = groupRetouchStrokes(cur?.edit.retouches ?? []).filter((g) => g.kind === 'repair');
                      if (cur && canvasRef.current && repairGeneration.current === generation && liveGroups.length > 0 && liveGroups.every((g) => healCache.current.has(g.id))) {
                        const doneKey = previewRenderKey(myPhotoId, myPhotoSrc, cur.edit);
                        if (lastSavedPreviewKey.current !== doneKey) {
                          lastSavedPreviewKey.current = doneKey;
                          const doneCanvas = canvasRef.current;
                          void previewBlobFromCanvas(doneCanvas).then((blob) => {
                            if (blob && repairGeneration.current === generation) void savePreviewRender(myPhotoId, doneKey, blob);
                          });
                        }
                      }
                    },
                  };
                },
              }).then(() => {
                if (cancelled || repairGeneration.current !== generation) return;
                setPendingRepairIds((prev) => (prev.length ? [] : prev));
              }).catch(() => {
                if (cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
                // Heal failed: fall back to the blurry placeholder so the
                // repair areas stay visibly marked.
                try { renderBase(geometryCanvas(image, latestHealState.current?.edit ?? edit), 'queue-fallback'); } catch { /* Keep clean canvas. */ }
                setPendingRepairIds((prev) => (prev.length ? [] : prev));
              });
            }, 300);
            return;
          }
          const clean = geometryCanvas(image, { ...baseEditSync, retouches: baseEditSync.retouches.filter((point) => point.kind !== 'repair') });
          void applyInpaintRepair(clean, repairs, method, run, repairOptions).then((applied) => {
            if (!applied || cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
            renderBase(clean, 'fullpass-done');
            setPendingRepairIds((prev) => (prev.length ? [] : prev));
          }).catch(() => {
            if (cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
            // Heal failed: fall back to the blurry placeholder so the repair
            // areas stay visibly marked.
            try { renderBase(geometryCanvas(image, latestHealState.current?.edit ?? edit), 'fullpass-fallback'); } catch { /* Keep clean canvas. */ }
            setPendingRepairIds((prev) => (prev.length ? [] : prev));
          });
        }, 300);
      }
    })();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [photo.src, originalSrc, edit, tool, activeStroke, onHistogram, retry, inpaintRepair?.method, inpaintRepair?.quality, inpaintRepair?.seamlessLight, inpaintRepair?.featherPx, inpaintRepair?.status]);

  // Compare "Original" layer, painted on demand: the layer is clipped to
  // zero width unless Compare splits the frame or Show Original holds it, so
  // painting it inside the pipeline wastes a full geometry pass on every
  // navigation. The pipeline only stashes its decoded inputs; this effect
  // paints from them when the layer becomes visible (and repaints after
  // geometry edits while it stays visible — the key skips non-geometry
  // ticks). The zoom lens reads this canvas only for the same two states,
  // so gating here never starves it.
  useEffect(() => {
    if (!compare && !showOriginal) return;
    const input = originalSource.current;
    const target = originalRef.current;
    if (!input || !target) return;
    const key = `${photo.id}\n${photo.src}\n${edit.rotation}|${edit.cropRatio}|${edit.flipH}|${edit.flipV}|${edit.straighten}`;
    if (originalPaintedKey.current === key) return;
    originalPaintedKey.current = key;
    const original = geometryCanvas(input.trueOriginal ?? input.image, { ...DEFAULT_EDIT, cropRatio: edit.cropRatio, rotation: edit.rotation, flipH: edit.flipH, flipV: edit.flipV, straighten: edit.straighten });
    target.width = original.width;
    target.height = original.height;
    target.getContext('2d')!.drawImage(original, 0, 0);
  }, [compare, showOriginal, paintCount, photo.id, photo.src, edit]);

  // Idle persistence: once the pipeline settles (painted, nothing healing,
  // nothing queued, not painting), stash the on-screen pixels under the
  // current content key so any state — not just post-heal — reopens
  // instantly. Debounced so slider drags and heal jobs settle first;
  // exact-key only, so a stale bitmap can never pass as current.
  useEffect(() => {
    if (loading || activeStroke !== null || pendingRepairIds.length > 0) return;
    if (paintedKey.current == null || !canvasRef.current) return;
    if (healQueue.current?.active || (healQueue.current?.pendingJobs ?? 0) > 0) return;
    const key = previewRenderKey(photo.id, photo.src, edit);
    if (paintedKey.current !== key || lastSavedPreviewKey.current === key) return;
    const timer = window.setTimeout(() => {
      if (!canvasRef.current || lastSavedPreviewKey.current === key) return;
      lastSavedPreviewKey.current = key;
      const canvas = canvasRef.current;
      void previewBlobFromCanvas(canvas).then((blob) => {
        if (blob) void savePreviewRender(photo.id, key, blob);
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [photo.id, photo.src, edit, loading, activeStroke, pendingRepairIds, paintCount]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  /** Cursor anchor for wheel zoom: the image point + viewport offset kept stable across the zoom. */
  const zoomAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const minimapBoxRef = useRef<HTMLDivElement>(null);
  /** Visible viewport as frame fractions; null while the frame fits the stage. */
  const [viewport, setViewport] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Space is the grab-tool override: holding it (with the canvas focused,
  // never inside a field) turns the next brush drag into a pan. Tracked on
  // window so the press can start outside the frame; the default scroll is
  // suppressed so holding Space never moves the page behind the canvas.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (!target || target.matches('input, textarea, select') || target.isContentEditable) return;
      if (target !== document.body && !stageRef.current?.contains(target)) return;
      event.preventDefault();
      if (!event.repeat) setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setSpaceHeld(false);
    };
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, []);

  // Scroll-wheel zoom: the wheel never scrolls the stage — it zooms toward
  // the hovered image point instead. Attached natively (non-passive) so the
  // scroll can be suppressed; panning stays available via drag, the
  // scrollbars, and the minimap below.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const frame = frameRef.current;
      if (!frame) return;
      const stageRect = stage.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      if (!frameRect.width || !frameRect.height) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (!delta) return;
      const current = zoomRef.current;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(current * Math.exp(-delta * 0.0015) * 1000) / 1000));
      if (next === current) return;
      zoomAnchor.current = {
        fx: clamp01((event.clientX - frameRect.left) / frameRect.width),
        fy: clamp01((event.clientY - frameRect.top) / frameRect.height),
        cx: event.clientX - stageRect.left,
        cy: event.clientY - stageRect.top,
      };
      onZoomRef.current(next);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  // After a wheel zoom re-renders the frame at its new size, shift the stage
  // scroll so the anchored image point stays under the cursor. Button, menu,
  // and keyboard zooms set no anchor and keep the default scroll behavior.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!anchor || !stage || !frame) return;
    zoomAnchor.current = null;
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const originX = frameRect.left - stageRect.left + stage.scrollLeft;
    const originY = frameRect.top - stageRect.top + stage.scrollTop;
    stage.scrollLeft = Math.max(0, originX + anchor.fx * frameRect.width - anchor.cx);
    stage.scrollTop = Math.max(0, originY + anchor.fy * frameRect.height - anchor.cy);
  }, [zoom]);

  const updateViewport = useCallback(() => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame || loading) { setViewport(null); return; }
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    if (frameRect.width <= stageRect.width + 1 && frameRect.height <= stageRect.height + 1) { setViewport(null); return; }
    const round3 = (value: number) => Math.round(value * 1000) / 1000;
    const left = clamp01((stageRect.left - frameRect.left) / frameRect.width);
    const top = clamp01((stageRect.top - frameRect.top) / frameRect.height);
    const right = clamp01((stageRect.right - frameRect.left) / frameRect.width);
    const bottom = clamp01((stageRect.bottom - frameRect.top) / frameRect.height);
    const next = { left: round3(left), top: round3(top), width: round3(Math.max(0, right - left)), height: round3(Math.max(0, bottom - top)) };
    setViewport((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height ? prev : next));
  }, [loading]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateViewport); };
    stage.addEventListener('scroll', onScroll, { passive: true });
    return () => { stage.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [updateViewport]);

  useEffect(() => { updateViewport(); }, [updateViewport, zoom, stageSize, aspect, paintCount, photo.id]);

  const viewportVisible = viewport !== null;

  // The minimap mirrors the edited canvas (not the thumbnail), so crop,
  // rotation, and straighten match the frame the viewport rect maps onto.
  useEffect(() => {
    if (!viewportVisible) return;
    const mini = minimapCanvasRef.current;
    const source = canvasRef.current;
    if (!mini || !source || !source.width || !source.height) return;
    const ctx = mini.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, mini.width, mini.height);
    ctx.drawImage(source, 0, 0, mini.width, mini.height);
  });

  /** Center the stage on a frame-fraction point (minimap click/drag/keys). */
  const jumpToFraction = useCallback((fx: number, fy: number) => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame) return;
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const originX = frameRect.left - stageRect.left + stage.scrollLeft;
    const originY = frameRect.top - stageRect.top + stage.scrollTop;
    stage.scrollLeft = originX + clamp01(fx) * frameRect.width - stageRect.width / 2;
    stage.scrollTop = originY + clamp01(fy) * frameRect.height - stageRect.height / 2;
  }, []);

  const jumpMinimap = useCallback((clientX: number, clientY: number) => {
    const box = minimapBoxRef.current;
    if (!box) return;
    const boxRect = box.getBoundingClientRect();
    if (!boxRect.width || !boxRect.height) return;
    jumpToFraction((clientX - boxRect.left) / boxRect.width, (clientY - boxRect.top) / boxRect.height);
  }, [jumpToFraction]);

  /**
   * Frame aspect while the full-res image decodes: predicted from the stored
   * upright dimensions + rotation/crop (the same recipe the pipeline paints),
   * so the album-thumbnail preview already sits at the final size and the
   * frame never resizes when the canvas lands. Falls back to the last
   * measured aspect when metadata is unusable; after first paint the decoded
   * pixels are ground truth.
   */
  const displayAspect = loading ? frameAspectForPhoto(photo, edit, aspect) : aspect;
  const fitWidth = Math.max(100, Math.min(stageSize.width - 64, (stageSize.height - 48) * displayAspect));
  const frameWidth = fitWidth * zoom;

  const positionFromClient = (clientX: number, clientY: number) => {
    const rect = frameRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) };
  };

  const position = (event: ReactPointerEvent) => positionFromClient(event.clientX, event.clientY);

  /** Pen pressure shrinks the stamp; mouse and touch always paint full size. */
  const stampSize = (native: { pointerType?: string; pressure?: number }) => {
    const base = brushSize / 800;
    if (native.pointerType === 'pen' && typeof native.pressure === 'number' && native.pressure > 0) {
      return base * (0.4 + 0.6 * Math.min(1, native.pressure));
    }
    return base;
  };

  const stampAt = (point: { x: number; y: number }, size: number) => {
    const next: RetouchPoint = { ...point, size, strength: brushStrength, kind: 'repair', stroke: activeStrokeRef.current ?? undefined };
    points.current = [...points.current, next];
  };

  const paint = (event: ReactPointerEvent) => {
    // Coalesced events recover the pointer positions the browser merged
    // between frames, so fast strokes stay continuous.
    const native = event.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const samples = native.getCoalescedEvents && native.getCoalescedEvents().length
      ? native.getCoalescedEvents()
      : [native];
    for (const sample of samples) {
      const point = positionFromClient(sample.clientX, sample.clientY);
      const size = stampSize(sample);
      // Interpolate between stamps so discs always overlap: without this,
      // fast drags leave dotted gaps the mask rasterizer keeps.
      const last = lastStamp.current;
      const spacing = Math.max(1e-4, size / 2);
      if (last) {
        const dist = Math.hypot(point.x - last.x, point.y - last.y);
        const steps = Math.max(1, Math.min(64, Math.ceil(dist / spacing)));
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          stampAt({ x: last.x + (point.x - last.x) * t, y: last.y + (point.y - last.y) * t }, size);
        }
      } else {
        stampAt(point, size);
      }
      lastStamp.current = point;
    }
    // Sticky per-stroke merge key: the whole drag is one undo step regardless
    // of duration, and consecutive strokes never coalesce (unique ids).
    onChange({ retouches: points.current }, `retouch-stroke:${activeStrokeRef.current ?? 0}`);
  };

  // ML tiers must be warmed before painting: no round cursor, no strokes.
  const paintBlocked = tool === 'repair' && inpaintRepair?.method === 'ml-heal' && inpaintRepair.mlEngine !== 'classic' && inpaintRepair.mlReady === false;
  /** True when a primary press on the frame paints a repair stroke. */
  const canPaint = isBrush && !compare && !showOriginal && !paintBlocked;

  /** Direct scrollability check for the press moment (viewport state can lag a fresh zoom). */
  const stagePannable = () => {
    const stage = stageRef.current;
    return !!stage && (stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1);
  };

  /** Middle-drag pans, so swallow the press before the browser starts its autoscroll overlay. */
  const swallowMiddleClick = (event: { button: number; preventDefault: () => void }) => {
    if (event.button === 1) event.preventDefault();
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const native = event.nativeEvent as PointerEvent;
    const action = resolveCanvasDrag({
      canPaint,
      pannable: viewport !== null || stagePannable(),
      button: event.button,
      pointerType: native.pointerType ?? 'mouse',
      spaceHeld,
    });
    if (action === 'none') return;
    if (action === 'pan') {
      if (panDrag.current) return;
      const stage = stageRef.current;
      if (!stage) return;
      panDrag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop };
      setPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    points.current = [...edit.retouches];
    painting.current = true;
    const id = Math.max(nextRetouchStrokeId(edit.retouches), strokeCounter.current);
    strokeCounter.current = id + 1;
    activeStrokeRef.current = id;
    setActiveStroke(id);
    lastStamp.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    paint(event);
  };

  const endStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panDrag.current && event.pointerId === panDrag.current.pointerId) {
      panDrag.current = null;
      setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    painting.current = false;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    onEndMerge?.();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  /** Topmost stroke group under the cursor, for hover highlighting. */
  const strokeAt = (point: { x: number; y: number }, frameHeight: number, frameWidth: number) => {
    for (let i = edit.retouches.length - 1; i >= 0; i -= 1) {
      const stamp = edit.retouches[i];
      if (!stamp) continue;
      const dx = (point.x - stamp.x) * frameWidth;
      const dy = (point.y - stamp.y) * frameHeight;
      if (Math.hypot(dx, dy) <= (stamp.size * frameWidth) / 2) return strokeIdForPoint(stamp);
    }
    return null;
  };

  const frameHeight = frameWidth / displayAspect;
  /** Grab cursor when a drag would pan: the frame overflows the stage and the brush isn't painting (Space/pan override it). */
  const pannableCursor = viewport !== null && (!isBrush || spaceHeld || panning);
  const showOverlay = isBrush && !loading && !compare && !showOriginal;
  // ML-gated repair: hide the round brush until the tier is warmed, and block
  // strokes outright on a failed tier (user must pick a working tier first).
  const mlRepairBlocked = tool === 'repair' && inpaintRepair?.method === 'ml-heal' && (inpaintRepair.mlEngine ?? 'classic') !== 'classic' && inpaintRepair.mlReady === false;
  const mlRepairWarming = tool === 'repair' && inpaintRepair?.method === 'ml-heal' && (inpaintRepair.mlEngine ?? 'classic') !== 'classic' && inpaintRepair.mlReady === false && inpaintRepair.mlWarming === true;
  // Compare and healing are mutually exclusive on canvas: comparing shows
  // the before/after slider with no heal cursor and no painting.
  const showBrushCursor = isBrush && cursor && !compare && !showOriginal && !mlRepairBlocked;
  // Zoom-in-view preview: a fixed square shows the region under the
  // cursor magnified while toggled on (nothing to magnify until the
  // photo has painted). Before the cursor enters the photo the pane
  // previews the frame center, so toggling on always shows a live
  // preview immediately. The pane docks right of the frame when the
  // stage has room (a portrait photo in a wide stage) and overlays the
  // photo's bottom-right corner otherwise; synchronous from the
  // render-derived sizes so zooming never flashes the wrong placement.
  const showLens = zoomLens && !loading && !error;
  const lensDockedOutside = shouldDockZoomLensOutside(stageSize, { width: frameWidth, height: frameHeight });
  const lensCursor = cursor ?? { x: frameWidth / 2, y: frameHeight / 2 };
  const draggingRepair = showOverlay && isLiveRepairDrag(tool, activeStroke);
  // While dragging, every repair area shows red — not just the new stroke —
  // so the single worker pass over all areas is visible. While healing,
  // only still-pending groups stay red; healed groups already show their
  // final pixels. Otherwise red appears only for the hovered heal group
  // (canvas or inspector list): past work stays unobscured until inspected.
  const healingRepair = showOverlay && tool === 'repair' && activeStroke === null && pendingRepairIds.length > 0;
  const pendingSet = new Set(pendingRepairIds);
  const pendingPoints = healingRepair
    ? edit.retouches.filter((point) => point.kind === 'repair' && pendingSet.has(strokeIdForPoint(point)))
    : [];
  const activePoints = draggingRepair
    ? edit.retouches.filter((point) => point.kind === 'repair')
    : pendingPoints.length > 0 || healingRepair
      ? (pendingPoints.length > 0 ? pendingPoints : edit.retouches.filter((point) => point.kind === 'repair'))
      : [];
  const hoverPoints = showOverlay && activeStroke === null && highlightStroke !== null
    ? edit.retouches.filter((point) => strokeIdForPoint(point) === highlightStroke)
    : [];
  // Hovered removal candidate (person box or dust disc) from the inspector
  // list, previewed in red like a healed area so rows map to photo regions.
  const previewGeometry = showOverlay && activeStroke === null && highlightRegion
    ? previewFrameGeometry(highlightRegion, frameWidth, frameHeight)
    : null;
  const maskCircle = (point: RetouchPoint, key: string) => (
    <circle key={key} cx={point.x * frameWidth} cy={point.y * frameHeight} r={Math.max(1, (point.size * frameWidth) / 2)} />
  );
  // Wheel zoom lands between the quarter stops, so the current value joins
  // the menu instead of leaving the select blank.
  const zoomOptions = ZOOM_STEPS.includes(zoom) ? ZOOM_STEPS : [...ZOOM_STEPS, zoom].sort((a, b) => a - b);
  const zoomLabel = (value: number) => (value === 1 ? 'Fit' : `${Math.round(value * 100)}%`);
  // Minimap footprint at the frame's aspect, capped for portrait frames.
  const miniWidth = Math.round(Math.min(148, 104 * displayAspect));
  const miniHeight = Math.round(Math.min(104, 148 / displayAspect));

  // The preview pane mirrors the edited canvas (not the thumbnail), so
  // adjustments, crop, and rotation match the frame. Runs after every
  // render like the minimap mirror, so the pane stays in sync with
  // repaints and follows the cursor. Backing store is 2x the CSS size
  // for a crisp pane on retina. While Compare splits the frame the pane
  // composites the same split (original left of the divider, edit right
  // of it); holding Show Original previews the original alone. With the
  // Repair tool the brush circle draws over the pane — but only when the
  // magnified brush fits inside it.
  useEffect(() => {
    if (!showLens) return;
    const lens = lensCanvasRef.current;
    const source = canvasRef.current;
    if (!lens || !source || !source.width || !source.height) return;
    const ctx = lens.getContext('2d');
    if (!ctx) return;
    const canvas = { width: source.width, height: source.height };
    const rect = zoomLensSourceRect(
      { fx: lensCursor.x / frameWidth, fy: lensCursor.y / frameHeight },
      canvas,
      { width: frameWidth, height: frameHeight },
      ZOOM_LENS_SIZE_PX,
      zoomLensMagnification,
    );
    if (rect.sw <= 0 || rect.sh <= 0) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, lens.width, lens.height);
    ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, lens.width, lens.height);
    // Compare/hold-original: the original canvas shares the edited
    // canvas's geometry (same backing size), so the same source rect
    // maps original pixels onto the pane. A size mismatch (a paint still
    // in flight) falls back to the edited pixels painted above.
    const original = originalRef.current;
    const originalReady = original && original.width === source.width && original.height === source.height;
    if (originalReady) {
      if (showOriginal) {
        ctx.drawImage(original, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, lens.width, lens.height);
      } else if (compare) {
        const overlay = zoomLensOriginalOverlay(split, canvas, rect, { width: lens.width, height: lens.height });
        if (overlay) ctx.drawImage(original, overlay.sx, overlay.sy, overlay.sw, overlay.sh, overlay.dx, overlay.dy, overlay.dw, overlay.dh);
      }
    }
    // Repair brush circle: the same visibility conditions as the frame
    // cursor (no painting means no circle), centered on the cursor's pane
    // position — off-center near the frame edges, where the source rect
    // clamps. Skipped when the magnified brush exceeds the pane.
    if (isBrush && !compare && !showOriginal && !mlRepairBlocked) {
      const radius = zoomLensBrushRadius(brushSize, frameWidth, zoomLensMagnification, lens.width);
      if (radius !== null && radius > 0) {
        const center = zoomLensDestPoint(
          { fx: lensCursor.x / frameWidth, fy: lensCursor.y / frameHeight },
          canvas,
          rect,
          { width: lens.width, height: lens.height },
        );
        const scale = lens.width / ZOOM_LENS_SIZE_PX;
        ctx.beginPath();
        ctx.arc(center.dx, center.dy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.lineWidth = 3 * scale;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(center.dx, center.dy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 * scale;
        ctx.stroke();
      }
    }
  });

  const blurryEntry = (photo.labels ?? []).find((entry) => entry.label === CULL_LABEL_BLURRY);

  return <section className="photo-workspace" aria-label="Photo editor"><div className="photo-heading"><div className="photo-filename"><button type="button" className={`filename-copy${filenameCopied ? ' is-copied' : ''}`} data-testid="filename-copy" data-tooltip={filenameCopied ? 'Copied!' : 'Copy filename'} aria-label={filenameCopied ? `Copied ${photo.name}` : `Copy filename ${photo.name}`} onClick={copyFilename}><span>{photo.name}</span>{filenameCopied ? <Check size={11} /> : <Copy size={11} />}</button><span className="file-type">{photo.raw ? 'RAW' : 'JPEG'}</span>{!isDefaultEdit(edit) && <span className="edited-indicator">Edited</span>}{blurryEntry && <BlurryBadge entry={blurryEntry} className="photo-blurry-hint" testId="photo-blurry-hint" />}</div><div className="photo-rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} aria-label={`Rate ${value} stars`} data-tooltip={`Rate ${value} stars`} onClick={() => onRating(photo.rating === value ? 0 : value)}><Star size={11} fill={photo.rating >= value ? 'currentColor' : 'none'} className={photo.rating >= value ? 'rated' : ''} /></button>)}<span className="heading-divider" /><IconButton label={photo.favorite ? 'Remove from favorites (F)' : 'Add to favorites (F)'} active={photo.favorite} onClick={onFavorite}><Heart size={15} fill={photo.favorite ? 'currentColor' : 'none'} strokeWidth={1.5} /></IconButton></div></div><div className="canvas-stage-wrap"><div className="canvas-stage" ref={stageRef}><div className="canvas-stage-inner"><div className={`photo-frame ${isBrush && !compare ? 'brush-active' : ''} ${pannableCursor ? 'is-pannable' : ''} ${panning ? 'is-panning' : ''} ${loading ? 'is-loading' : ''}`} ref={frameRef} data-testid="photo-frame" style={{ width: frameWidth, height: frameHeight }} onPointerDown={pointerDown} onMouseDown={swallowMiddleClick} onPointerMove={(event) => { const pan = panDrag.current; if (pan && event.pointerId === pan.pointerId) { const stage = stageRef.current; if (stage) { const next = panScrollFromDrag(pan, { clientX: event.clientX, clientY: event.clientY }); stage.scrollLeft = next.scrollLeft; stage.scrollTop = next.scrollTop; } return; } if (isBrush || showLens) { const point = position(event); setCursor({ x: point.x * frameWidth, y: point.y * frameHeight }); if (isBrush && !painting.current && onHighlightStroke && !compare && !showOriginal) { const found = strokeAt(point, frameHeight, frameWidth); if (found !== highlightStroke) onHighlightStroke(found); } } if (painting.current) paint(event); }} onPointerUp={endStroke} onPointerCancel={endStroke} onPointerLeave={() => { setCursor(null); if (!painting.current && highlightStroke !== null) onHighlightStroke?.(null); }}>
      {/* Album-thumbnail hold: the grid already decoded this URL, so it paints
          on the first frame and the full-res canvas crossfades over it —
          navigating in never flashes an empty frame. Decorative: the canvas
          carries the accessible label. */}
      <img className={`thumb-hold${loading ? '' : ' is-settled'}`} src={photo.thumbnail} alt="" aria-hidden="true" draggable={false} />
      <canvas className="edited-canvas" ref={canvasRef} data-testid="edited-canvas" role="img" aria-label={`${photo.title}, with current adjustments`} />
      {previewUrl && <img className="cached-preview" src={previewUrl} alt="" aria-hidden="true" draggable={false} />}
      <div className="original-layer" style={{ clipPath: `inset(0 ${showOriginal ? 0 : compare ? 100 - split : 100}% 0 0)` }}><canvas ref={originalRef} role="img" aria-label="Original photo" />{compare && !showOriginal && !loading && <span className="comparison-label original-label">Original</span>}</div>
      {compare && !showOriginal && !loading && <div className="edited-layer" style={{ clipPath: `inset(0 0 0 ${split}%)` }}><span className="comparison-label edited-label">Edited</span></div>}
      {loading && !previewUrl && <div className="photo-loading"><span className="loading-spinner" /><span>Developing your photo...</span></div>}
      {error && <div className="photo-error"><ImageOff size={28} /><p>{error}</p><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
      {compare && !showOriginal && !loading && <><div className="comparison-divider" role="slider" aria-label="Before and after comparison" aria-valuemin={2} aria-valuemax={98} aria-valuenow={Math.round(split)} tabIndex={0} style={{ left: `${split}%` }} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSplit(Math.max(2, Math.min(98, position(event).x * 100))); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); setSplit((value) => Math.max(2, Math.min(98, value + (event.key === 'ArrowRight' ? 2 : -2)))); } }}><span><ChevronsLeftRight size={17} /></span></div></>}
      {showOriginal && <span className="comparison-label original-label">Original</span>}
      {tool === 'crop' && !loading && (fineGrid
        ? <div className="crop-grid is-fine" aria-hidden="true" data-testid="crop-grid-fine">{Array.from({ length: 8 }, (_, index) => <i key={`v${index}`} className={(index + 1) % 3 === 0 ? 'is-major' : ''} style={{ left: `${((index + 1) * 100) / 9}%`, top: 0, height: '100%', width: '1px' }} />)}{Array.from({ length: 8 }, (_, index) => <i key={`h${index}`} className={(index + 1) % 3 === 0 ? 'is-major' : ''} style={{ top: `${((index + 1) * 100) / 9}%`, left: 0, width: '100%', height: '1px' }} />)}</div>
        : <div className="crop-grid" aria-hidden="true"><i /><i /><i /><i /></div>)}
      {showBrushCursor && <div className="brush-cursor" style={{ left: cursor!.x, top: cursor!.y, width: brushSize / 800 * frameWidth, height: brushSize / 800 * frameWidth }} />}
      {showLens && <div className={`zoom-lens${lensDockedOutside ? ' is-outside' : ''}`} data-testid="zoom-lens" role="img" aria-label={`Zoomed preview at ${zoomLensMagnification}x magnification`} style={{ width: ZOOM_LENS_SIZE_PX, height: ZOOM_LENS_SIZE_PX }}><canvas ref={lensCanvasRef} width={ZOOM_LENS_SIZE_PX * 2} height={ZOOM_LENS_SIZE_PX * 2} /><span className="zoom-lens-label">{zoomLensMagnification}×</span></div>}
      {(activePoints.length > 0 || hoverPoints.length > 0 || previewGeometry !== null) && <svg className="retouch-overlay" viewBox={`0 0 ${frameWidth} ${frameHeight}`} aria-hidden="true">{hoverPoints.length > 0 && <g className="retouch-highlight-group">{hoverPoints.map((point, index) => maskCircle(point, `h-${index}`))}</g>}{activePoints.length > 0 && <g className="retouch-active-group">{activePoints.map((point, index) => maskCircle(point, `a-${index}`))}</g>}{previewGeometry && <g className="retouch-preview-group" data-testid="removal-preview">{previewGeometry.kind === 'rect' ? <rect x={previewGeometry.x} y={previewGeometry.y} width={previewGeometry.width} height={previewGeometry.height} rx={3} /> : <circle cx={previewGeometry.cx} cy={previewGeometry.cy} r={previewGeometry.r} />}</g>}</svg>}
    </div></div>
    </div>
      {/* Overlay on the wrap, outside the scroll stage: showing/hiding it must not shift the photo. */}
      {isBrush && <ToolHint photoId={photo.id} hintId="repair">{compare ? 'Comparing — turn off Compare to keep repairing.' : mlRepairWarming ? 'Loading the ML engine… painting unlocks when ready.' : mlRepairBlocked ? 'This ML engine is unavailable — pick Balanced in the inspector.' : 'Click and drag to repair — hover a repair in the list to locate it.'}</ToolHint>}
      {tool === 'crop' && straightenFlash && <ToolHint photoId={photo.id} hintId={`straighten-no-horizon-${straightenFlash.runId}`}>{straightenFlash.message}</ToolHint>}
      {viewport && <div
        className="minimap"
        ref={minimapBoxRef}
        data-testid="minimap"
        role="group"
        tabIndex={0}
        aria-label="Minimap navigator: click or drag to move the visible area, arrow keys nudge it"
        style={{ width: miniWidth, height: miniHeight }}
        onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); jumpMinimap(event.clientX, event.clientY); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) jumpMinimap(event.clientX, event.clientY); }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.25 : 0.1;
          const cx = viewport.left + viewport.width / 2;
          const cy = viewport.top + viewport.height / 2;
          // stopPropagation keeps the global photo-switching arrows (App.tsx)
          // from firing while the minimap has focus.
          if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); jumpToFraction(cx - step, cy); }
          else if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); jumpToFraction(cx + step, cy); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); jumpToFraction(cx, cy - step); }
          else if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); jumpToFraction(cx, cy + step); }
        }}
      >
        <canvas ref={minimapCanvasRef} width={miniWidth * 2} height={miniHeight * 2} aria-hidden="true" />
        <span className="minimap-viewport" style={{ left: `${viewport.left * 100}%`, top: `${viewport.top * 100}%`, width: `${viewport.width * 100}%`, height: `${viewport.height * 100}%` }} aria-hidden="true" />
      </div>}
    </div>
    <div className="canvas-status">
      <button className="canvas-dimensions" onClick={onInfo} data-tooltip="Photo information">
        <Info size={12} />
        <span>{photo.width.toLocaleString()} <span className="dimension-x">x</span> {photo.height.toLocaleString()} px</span>
        <span className="dimension-separator" />{Math.round(photo.width * photo.height / 1000000)} MP
      </button>
      <button className={`compare-button ${compare ? 'is-active' : ''}`} onClick={onCompare} disabled={tool === 'crop'} data-tooltip={tool === 'crop' ? 'Compare is unavailable while cropping' : 'Compare with original (B)'}>
        <Columns2 size={14} /><span>Compare</span><kbd>B</kbd>
      </button>
      <div className="zoom-controls">
        <IconButton label="Zoom out (-)" disabled={zoom <= ZOOM_MIN} onClick={() => onZoom(Math.max(ZOOM_MIN, Math.round((zoom - 0.25) * 1000) / 1000))}><Minus size={13} /></IconButton>
        <select aria-label="Zoom level" value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>
          {zoomOptions.map((value) => <option key={value} value={value}>{zoomLabel(value)}</option>)}
        </select>
        <IconButton label="Zoom in (+)" disabled={zoom >= ZOOM_MAX} onClick={() => onZoom(Math.min(ZOOM_MAX, Math.round((zoom + 0.25) * 1000) / 1000))}><Plus size={13} /></IconButton>
        <IconButton label="Zoom to fit (0)" onClick={() => onZoom(1)}><Maximize size={13} /></IconButton>
      </div>
    </div>
  </section>;
}