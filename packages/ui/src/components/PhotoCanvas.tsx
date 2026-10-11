import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronsLeftRight, Columns2, Heart, ImageOff, Info, Maximize, Minus, Plus, Star } from 'lucide-react';
import { DEFAULT_EDIT } from '@photomator/core';
import { LibraryError, applyInpaintRepair, clearTestHealCalls, createHealQueue, createLibraryClient, drawEffects, enforceHealCacheLimit, geometryCanvas, geometryKeyForHealCache, groupRetouchStrokes, loadImage, loadPreviewRender, loadStoredHealOverlays, nextRetouchStrokeId, overlayBodyFromPatch, partitionHealGroups, pasteHealPatches, previewBlobFromCanvas, previewRenderKey, readTestHealCalls, renderAdjustedCanvas, reusableOverlayForGroup, savePreviewRender, signatureForHealGroup, strokeIdForPoint } from '@photomator/core';
import type { CachedHealPatch, ChangeEdit, EditState, InpaintMethod, Photo, RepairInpaintBinding, RetouchPoint, RunInpaint, StoredHealPatch, Tool } from '@photomator/core';
import { IconButton } from './EditorUI.js';

/** Same-origin library client for persisted heal overlays (fire-and-forget cache I/O). */
const overlayClient = createLibraryClient();

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
  brushSize: number;
  brushStrength: number;
  /** Worker inpainting for repair strokes; absent means blur repair only. */
  inpaintRepair?: RepairInpaintBinding | null;
  /** Stroke group highlighted from the inspector list (red overlay). */
  highlightStroke?: number | null;
  onHighlightStroke?: (stroke: number | null) => void;
  onZoom: (zoom: number) => void;
  onCompare: () => void;
  onFavorite: () => void;
  onRating: (rating: number) => void;
  onInfo: () => void;
  onChange: ChangeEdit;
  onHistogram: (data: HistogramData) => void;
}

export function PhotoCanvas({ photo, edit, tool, zoom, compare, showOriginal, brushSize, brushStrength, inpaintRepair, highlightStroke = null, onHighlightStroke, onZoom, onCompare, onFavorite, onRating, onInfo, onChange, onHistogram }: PhotoCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const points = useRef<RetouchPoint[]>([]);
  const cloneSource = useRef<{ x: number; y: number } | null>(null);
  const cloneStart = useRef<{ x: number; y: number } | null>(null);
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
  /** Serial heal job queue: one group at a time, repeat clicks schedule follow-ups. */
  const healQueue = useRef<ReturnType<typeof createHealQueue> | null>(null);
  if (!healQueue.current) healQueue.current = createHealQueue();
  /** Persisted overlays fetched at photo open, plus every group saved since. */
  const overlayStore = useRef<StoredHealPatch[]>([]);
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
  const [sourceSet, setSourceSet] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
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
  const isBrush = tool === 'repair' || tool === 'clone';
  /** Mirror of pendingRepairIds for the read-only e2e hook (state is async). */
  const pendingRef = useRef<number[]>([]);
  pendingRef.current = pendingRepairIds;
  // Read-only Playwright observability: queue depth, cached group ids,
  // pending (still-healing) group ids, persisted overlay group ids, and the
  // recorded transport calls. No behavior change; specs read, never write.
  useEffect(() => {
    (window as unknown as { __photomatorTest?: unknown }).__photomatorTest = {
      healCalls: () => readTestHealCalls(),
      clearHealCalls: () => clearTestHealCalls(),
      queue: () => ({ active: healQueue.current?.active ?? false, pendingJobs: healQueue.current?.pendingJobs ?? 0 }),
      cacheKeys: () => [...healCache.current.keys()],
      pendingRepairIds: () => [...pendingRef.current],
      overlayGroupIds: () => overlayStore.current.map((entry) => entry.groupId),
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

  useEffect(() => { setLoading(true); setError(''); cloneSource.current = null; setSourceSet(false); setPendingRepairIds([]); strokeCounter.current = 1; activeStrokeRef.current = null; setActiveStroke(null); healCache.current.clear(); healCachePhoto.current = null; overlayStore.current = []; healEpoch.current += 1; healQueue.current?.clear(); paintedKey.current = null; lastSavedPreviewKey.current = null; setPreviewUrlTracked(null); const myPhotoId = photo.id; overlayPromise.current = loadStoredHealOverlays(overlayClient, myPhotoId); return () => { healEpoch.current += 1; setPreviewUrlTracked(null); if (overlayPromise.current) { const stale = overlayPromise.current; void stale.then(() => { if (overlayPromise.current === stale) overlayPromise.current = null; }); } }; }, [photo.id, photo.src, retry]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const generation = repairGeneration.current + 1;
    repairGeneration.current = generation;
    void (async () => {
      // Content key of the state this run will paint; doubles as the
      // preview-cache key.
      const runKey = previewRenderKey(photo.id, photo.src, edit);
      // Image decode starts immediately so it overlaps the cache read below.
      const imagePromise = loadImage(photo.src);
      // Instant preview: the cached last render is pixel-identical when its
      // version key matches, so it shows immediately while the pipeline
      // prepares behind it and swaps in invisibly. Shows whenever the canvas
      // doesn't already hold this exact state — even if an earlier run
      // painted something else first.
      const repairsAtStart = edit.retouches.filter((point) => point.kind === 'repair');
      if (paintedKey.current !== runKey && repairsAtStart.length > 0 && canvasRef.current) {
        try {
          const cached = await loadPreviewRender(photo.id, runKey);
          if (cached && !cancelled && repairGeneration.current === generation && paintedKey.current !== runKey && canvasRef.current) {
            setPreviewUrlTracked(URL.createObjectURL(cached));
            setLoading(false);
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
      // First paint waits for saved work: no clean flash, no pop-in. Photos
      // without repairs skip the wait (nothing to composite, and an offline
      // hang must never block them).
      if (repairsAtStart.length > 0) {
        let fetched: StoredHealPatch[] = [];
        try {
          fetched = (await overlayPromise.current) ?? [];
        } catch { fetched = []; }
        // Session-saved groups win over the fetch (a PUT may have landed
        // after the GET started).
        if (fetched.length || overlayStore.current.length) {
          const merged = new Map<number, StoredHealPatch>();
          for (const entry of fetched) merged.set(entry.groupId, entry);
          for (const entry of overlayStore.current) merged.set(entry.groupId, entry);
          overlayStore.current = [...merged.values()];
        }
      } else if (overlayPromise.current) {
        void overlayPromise.current.then((patches) => {
          if (!cancelled && patches.length && !overlayStore.current.length) overlayStore.current = patches;
        }).catch(() => undefined);
      }
      if (cancelled || repairGeneration.current !== generation || !canvasRef.current || !originalRef.current) return;
      const renderBase = (base: HTMLCanvasElement) => {
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
      // While a repair stroke is being painted, every repair stamp stays out
      // of the canvas: the red mask overlay shows those areas instead of the
      // blur placeholder. Otherwise the single paint below already contains
      // the final healed pixels — saved work is composited before anything
      // becomes visible, so reloads never flash clean first.
      const paintingRepair = tool === 'repair' && activeStroke !== null;
      const repairs = edit.retouches.filter((point) => point.kind === 'repair');
      const run = inpaintRun.current;
      const method = inpaintRepair?.method;
      // Distinct heal groups (strokes) covered by this pass, for progress
      // copy ("Healing 3 areas…"). Points share a stroke id per drag.
      const areas = new Set(repairs.map((point) => strokeIdForPoint(point))).size;
      const repairOptions = {
        quality: inpaintRepair?.quality,
        seamlessLight: inpaintRepair?.seamlessLight,
        featherPx: inpaintRepair?.featherPx,
        areas,
      };
      // Single clean base for this run: repairs excluded (clone stamps stay),
      // healed patches composited below before the only paint. One geometry
      // pass feeds seeding, partitioning, and rendering alike.
      const baseEditSync = { ...edit, retouches: edit.retouches.filter((point) => point.kind !== 'repair') };
      const paintOriginal = () => {
        const original = geometryCanvas(image, { ...DEFAULT_EDIT, cropRatio: edit.cropRatio, rotation: edit.rotation, flipH: edit.flipH, flipV: edit.flipV, straighten: edit.straighten });
        originalRef.current!.width = original.width;
        originalRef.current!.height = original.height;
        originalRef.current!.getContext('2d')!.drawImage(original, 0, 0);
      };
      const finishPaint = () => {
        paintedKey.current = runKey;
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
      if (paintingRepair) {
        // Live drag feedback only; the debounced queue below still schedules
        // the post-release heal.
        renderBase(geometryCanvas(image, baseEditSync));
        paintOriginal();
        setPendingRepairIds((prev) => (prev.length ? [] : prev));
        finishPaint();
      } else if ((method === 'ml-heal' || method === 'heal') && repairs.length && canvasRef.current) {
        // Finished groups stay visibly healed while follow-up groups heal:
        // valid patches composite here, dirty areas stay clean with a red
        // mask until their group heals. Pending ids drive the red overlay:
        // dirty groups only, so finished work is never covered.
        try {
          if (healCachePhoto.current !== photo.src) {
            healCache.current.clear();
            healCachePhoto.current = photo.src;
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
            for (const group of syncGroups) {
              if (healCache.current.has(group.id)) continue;
              const overlay = reusableOverlayForGroup(overlayStore.current, group, syncParams);
              if (!overlay || overlay.canvasWidth !== syncWidth || overlay.canvasHeight !== syncHeight) continue;
              healCache.current.set(group.id, { signature: signatureForHealGroup(group, syncParams), x0: overlay.x0, y0: overlay.y0, width: overlay.width, height: overlay.height, data: overlay.data.slice() });
            }
            // Best-effort: drop server overlays for deleted strokes.
            const liveSync = new Set(syncGroups.map((group) => group.id));
            const orphansSync = overlayStore.current.filter((entry) => !liveSync.has(entry.groupId));
            if (orphansSync.length) {
              overlayStore.current = overlayStore.current.filter((entry) => liveSync.has(entry.groupId));
              for (const orphan of orphansSync) void overlayClient.deleteHealOverlay(photo.id, orphan.groupId).catch(() => undefined);
            }
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
            renderBase(cleanOne);
            paintOriginal();
            // Only still-dirty groups stay red; cached groups already show healed.
            const dirtyIds = syncPart.dirty.map((group) => group.id);
            setPendingRepairIds((prev) => (prev.length === dirtyIds.length && prev.every((id) => dirtyIds.includes(id)) ? prev : dirtyIds));
            finishPaint();
            if (!syncPart.dirty.length) {
              needsQueue = false;
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
        renderBase(geometryCanvas(image, baseEditSync));
        paintOriginal();
        const allIds = [...new Set(repairs.map((point) => strokeIdForPoint(point)))];
        setPendingRepairIds((prev) => (prev.length === allIds.length && prev.every((id) => allIds.includes(id)) ? prev : allIds));
        finishPaint();
      } else {
        renderBase(geometryCanvas(image, edit));
        paintOriginal();
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
                  for (const group of groups) {
                    if (healCache.current.has(group.id)) continue;
                    const overlay = reusableOverlayForGroup(overlayStore.current, group, cacheParams);
                    if (!overlay || overlay.canvasWidth !== width || overlay.canvasHeight !== height) continue;
                    healCache.current.set(group.id, { signature: signatureForHealGroup(group, cacheParams), x0: overlay.x0, y0: overlay.y0, width: overlay.width, height: overlay.height, data: overlay.data.slice() });
                  }
                  // Best-effort: drop server overlays for deleted strokes.
                  const live = new Set(groups.map((group) => group.id));
                  const orphans = overlayStore.current.filter((entry) => !live.has(entry.groupId));
                  if (orphans.length) {
                    overlayStore.current = overlayStore.current.filter((entry) => live.has(entry.groupId));
                    for (const orphan of orphans) void overlayClient.deleteHealOverlay(myPhotoId, orphan.groupId).catch(() => undefined);
                  }
                  const { valid, dirty } = partitionHealGroups(currentRepairs, healCache.current, cacheParams, width, height);
                  const validPatches = valid.flatMap((group) => {
                    const entry = healCache.current.get(group.id);
                    return entry ? [entry] : [];
                  });
                  const cleanCtx = clean.getContext('2d')!;
                  const cleanPixels = cleanCtx.getImageData(0, 0, width, height);
                  const source = { width, height, data: new Uint8ClampedArray(cleanPixels.data) };
                  const renderPatches = (patches: CachedHealPatch[]) => {
                    if (healEpoch.current !== myEpoch || photoIdRef.current !== myPhotoId || !canvasRef.current) return;
                    if (!patches.length) return;
                    const composited = pasteHealPatches(source, patches);
                    const bytes = new Uint8ClampedArray(composited.data.length);
                    bytes.set(composited.data);
                    cleanCtx.putImageData(new ImageData(bytes, width, height), 0, 0);
                    renderBase(clean);
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
                    source,
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
                      patch.signature = signatureForHealGroup(group, cacheParams);
                      healCache.current.set(group.id, patch);
                      fresh.push(patch);
                      renderPatches([...validPatches, ...fresh]);
                      setPendingRepairIds((prev) => (prev.includes(group.id) ? prev.filter((id) => id !== group.id) : prev));
                      enforceHealCacheLimit(healCache.current);
                      overlayStore.current = overlayStore.current.filter((entry) => entry.groupId !== group.id && healCache.current.has(entry.groupId));
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
                try { renderBase(geometryCanvas(image, latestHealState.current?.edit ?? edit)); } catch { /* Keep clean canvas. */ }
                setPendingRepairIds((prev) => (prev.length ? [] : prev));
              });
            }, 300);
            return;
          }
          const clean = geometryCanvas(image, { ...baseEditSync, retouches: baseEditSync.retouches.filter((point) => point.kind !== 'repair') });
          void applyInpaintRepair(clean, repairs, method, run, repairOptions).then((applied) => {
            if (!applied || cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
            renderBase(clean);
            setPendingRepairIds((prev) => (prev.length ? [] : prev));
          }).catch(() => {
            if (cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
            // Heal failed: fall back to the blurry placeholder so the repair
            // areas stay visibly marked.
            try { renderBase(geometryCanvas(image, latestHealState.current?.edit ?? edit)); } catch { /* Keep clean canvas. */ }
            setPendingRepairIds((prev) => (prev.length ? [] : prev));
          });
        }, 300);
      }
    })();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [photo.src, edit, tool, activeStroke, onHistogram, retry, inpaintRepair?.method, inpaintRepair?.quality, inpaintRepair?.seamlessLight, inpaintRepair?.featherPx, inpaintRepair?.status]);

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

  const fitWidth = Math.max(100, Math.min(stageSize.width - 64, (stageSize.height - 48) * aspect));
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
    const next: RetouchPoint = { ...point, size, strength: brushStrength, kind: tool === 'clone' ? 'clone' : 'repair', stroke: activeStrokeRef.current ?? undefined };
    if (tool === 'clone' && cloneSource.current && cloneStart.current) {
      next.sourceX = Math.max(0, Math.min(1, cloneSource.current.x + point.x - cloneStart.current.x));
      next.sourceY = Math.max(0, Math.min(1, cloneSource.current.y + point.y - cloneStart.current.y));
    }
    points.current = [...points.current, next];
  };

  const paint = (event: ReactPointerEvent) => {
    if (tool === 'clone' && (!cloneSource.current || !cloneStart.current)) return;
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
    onChange({ retouches: points.current }, 'retouch-stroke');
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isBrush || compare || showOriginal) return;
    // ML tiers must be warmed before painting: no round cursor, no strokes.
    if (tool === 'repair' && inpaintRepair?.method === 'ml-heal' && inpaintRepair.mlEngine !== 'classic' && inpaintRepair.mlReady === false) return;
    if (tool === 'clone' && (event.altKey || !cloneSource.current)) { cloneSource.current = position(event); setSourceSet(true); return; }
    points.current = [...edit.retouches];
    painting.current = true;
    const id = Math.max(nextRetouchStrokeId(edit.retouches), strokeCounter.current);
    strokeCounter.current = id + 1;
    activeStrokeRef.current = id;
    setActiveStroke(id);
    cloneStart.current = position(event);
    lastStamp.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    paint(event);
  };

  const endStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    painting.current = false;
    activeStrokeRef.current = null;
    setActiveStroke(null);
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

  const frameHeight = frameWidth / aspect;
  const showOverlay = isBrush && !loading && !compare && !showOriginal;
  // ML-gated repair: hide the round brush until the tier is warmed, and block
  // strokes outright on a failed tier (user must pick a working tier first).
  const mlRepairBlocked = tool === 'repair' && inpaintRepair?.method === 'ml-heal' && (inpaintRepair.mlEngine ?? 'classic') !== 'classic' && inpaintRepair.mlReady === false;
  const mlRepairWarming = tool === 'repair' && inpaintRepair?.method === 'ml-heal' && (inpaintRepair.mlEngine ?? 'classic') !== 'classic' && inpaintRepair.mlReady === false && inpaintRepair.mlWarming === true;
  // Compare and healing are mutually exclusive on canvas: comparing shows
  // the before/after slider with no heal cursor and no painting.
  const showBrushCursor = isBrush && cursor && !compare && !showOriginal && !mlRepairBlocked;
  const draggingRepair = showOverlay && tool === 'repair' && activeStroke !== null;
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
  const maskCircle = (point: RetouchPoint, key: string) => (
    <circle key={key} cx={point.x * frameWidth} cy={point.y * frameHeight} r={Math.max(1, (point.size * frameWidth) / 2)} />
  );

  return <section className="photo-workspace" aria-label="Photo editor"><div className="photo-heading"><div className="photo-filename">{photo.name}<span className="file-type">{photo.raw ? 'RAW' : 'JPEG'}</span>{edit.preset !== 'Original' && <span className="edited-indicator">Edited</span>}</div><div className="photo-rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} aria-label={`Rate ${value} stars`} title={`Rate ${value} stars`} onClick={() => onRating(photo.rating === value ? 0 : value)}><Star size={11} fill={photo.rating >= value ? 'currentColor' : 'none'} className={photo.rating >= value ? 'rated' : ''} /></button>)}<span className="heading-divider" /><IconButton label={photo.favorite ? 'Remove from favorites (F)' : 'Add to favorites (F)'} active={photo.favorite} onClick={onFavorite}><Heart size={15} fill={photo.favorite ? 'currentColor' : 'none'} strokeWidth={1.5} /></IconButton></div></div><div className="canvas-stage" ref={stageRef}><div className="canvas-stage-inner"><div className={`photo-frame ${isBrush && !compare ? 'brush-active' : ''} ${loading ? 'is-loading' : ''}`} ref={frameRef} data-testid="photo-frame" style={{ width: frameWidth, height: frameHeight }} onPointerDown={pointerDown} onPointerMove={(event) => { if (isBrush) { const point = position(event); setCursor({ x: point.x * frameWidth, y: point.y * frameHeight }); if (!painting.current && onHighlightStroke && !compare && !showOriginal) { const found = strokeAt(point, frameHeight, frameWidth); if (found !== highlightStroke) onHighlightStroke(found); } } if (painting.current) paint(event); }} onPointerUp={endStroke} onPointerCancel={endStroke} onPointerLeave={() => { setCursor(null); if (!painting.current && highlightStroke !== null) onHighlightStroke?.(null); }}>
      <canvas className="edited-canvas" ref={canvasRef} data-testid="edited-canvas" role="img" aria-label={`${photo.title}, with current adjustments`} />
      {previewUrl && <img className="cached-preview" src={previewUrl} alt="" aria-hidden="true" draggable={false} />}
      <div className="original-layer" style={{ clipPath: `inset(0 ${showOriginal ? 0 : compare ? 100 - split : 100}% 0 0)` }}><canvas ref={originalRef} role="img" aria-label="Original photo" /></div>
      {loading && <div className="photo-loading"><span className="loading-spinner" /><span>Developing your photo...</span></div>}
      {error && <div className="photo-error"><ImageOff size={28} /><p>{error}</p><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
      {compare && !showOriginal && !loading && <><span className="comparison-label original-label">Original</span><span className="comparison-label edited-label">Edited</span><div className="comparison-divider" role="slider" aria-label="Before and after comparison" aria-valuemin={2} aria-valuemax={98} aria-valuenow={Math.round(split)} tabIndex={0} style={{ left: `${split}%` }} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSplit(Math.max(2, Math.min(98, position(event).x * 100))); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); setSplit((value) => Math.max(2, Math.min(98, value + (event.key === 'ArrowRight' ? 2 : -2)))); } }}><span><ChevronsLeftRight size={17} /></span></div></>}
      {showOriginal && <span className="comparison-label original-label">Original</span>}
      {tool === 'crop' && !loading && <div className="crop-grid" aria-hidden="true"><i /><i /><i /><i /></div>}
      {showBrushCursor && <div className="brush-cursor" style={{ left: cursor!.x, top: cursor!.y, width: brushSize / 800 * frameWidth, height: brushSize / 800 * frameWidth }} />}
      {(activePoints.length > 0 || hoverPoints.length > 0) && <svg className="retouch-overlay" viewBox={`0 0 ${frameWidth} ${frameHeight}`} aria-hidden="true">{hoverPoints.length > 0 && <g className="retouch-highlight-group">{hoverPoints.map((point, index) => maskCircle(point, `h-${index}`))}</g>}{activePoints.length > 0 && <g className="retouch-active-group">{activePoints.map((point, index) => maskCircle(point, `a-${index}`))}</g>}</svg>}
    </div></div>
      {isBrush && <div className="tool-hint">{tool === 'clone' ? sourceSet ? 'Click and drag to clone. Alt-click to change the source.' : 'Click the photo to choose a clone source.' : compare ? 'Comparing — turn off Compare to keep repairing.' : mlRepairWarming ? 'Loading the ML engine… painting unlocks when ready.' : mlRepairBlocked ? 'This ML engine is unavailable — pick Balanced in the inspector.' : 'Click and drag to repair — hover a repair in the list to locate it.'}</div>}
    </div>
    <div className="canvas-status">
      <button className="canvas-dimensions" onClick={onInfo} title="Photo information">
        <Info size={12} />
        <span>{photo.width.toLocaleString()} <span className="dimension-x">x</span> {photo.height.toLocaleString()} px</span>
        <span className="dimension-separator" />{Math.round(photo.width * photo.height / 1000000)} MP
      </button>
      <button className={`compare-button ${compare ? 'is-active' : ''}`} onClick={onCompare} title="Compare with original (B)">
        <Columns2 size={14} /><span>Compare</span><kbd>B</kbd>
      </button>
      <div className="zoom-controls">
        <IconButton label="Zoom out (-)" disabled={zoom <= 0.5} onClick={() => onZoom(Math.max(0.5, zoom - 0.25))}><Minus size={13} /></IconButton>
        <select aria-label="Zoom level" value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>
          {Array.from({ length: 11 }, (_, index) => 0.5 + index * 0.25).map((value) => <option key={value} value={value}>{value === 1 ? 'Fit' : `${value * 100}%`}</option>)}
        </select>
        <IconButton label="Zoom in (+)" disabled={zoom >= 3} onClick={() => onZoom(Math.min(3, zoom + 0.25))}><Plus size={13} /></IconButton>
        <IconButton label="Zoom to fit (0)" onClick={() => onZoom(1)}><Maximize size={13} /></IconButton>
      </div>
    </div>
  </section>;
}