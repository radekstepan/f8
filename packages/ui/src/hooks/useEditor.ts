import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, INITIAL_EDIT, ML_CATEGORIES, ML_CATEGORY_ENABLED_KEY, computeAutoEnhance, computeColorAuto, computeLightnessAuto, computeSceneAwareEnhance, computeWhiteBalanceAuto, decodeDownsampled, isDefaultEdit, isOriginalLook, presetForPatch, snapshotMlCategory } from '@f8/core';
import type { EditState, HistoryState, MlCategory, PixelImage, Preset } from '@f8/core';

const initialHistory = (_id?: string): HistoryState => ({
  past: [],
  present: { ...DEFAULT_EDIT },
  future: [],
});

/** Merge keys for heal strokes bypass the time window: one stroke id = one undo step. */
const STICKY_MERGE_PREFIX = 'retouch-stroke:';
const MERGE_WINDOW_MS = 700;

export interface EditorPersistence {
  /** Seed from the server library; applied once when it arrives. */
  initial?: Record<string, HistoryState> | null;
  /** Debounced persist of the current recipe; undo/redo stacks stay session-only. */
  onPersist?: (photoId: string, present: EditState) => void;
}

export function useEditor(photoId: string, persistence?: EditorPersistence) {
  const [histories, setHistories] = useState<Record<string, HistoryState>>(() => persistence?.initial ?? {});
  const lastChange = useRef({ key: '', photoId: '', time: 0 });
  const enhanceSnapshots = useRef<Record<string, EditState>>({});
  /** Pre-ML snapshots per photo + category: a revert restores these values. Session-only, like enhanceSnapshots. */
  const mlSnapshots = useRef<Record<string, Partial<Record<MlCategory, Partial<EditState>>>>>({});
  /** Monotonic run tokens per photo + category: a revert or wholesale recipe change invalidates an in-flight async apply. */
  const mlRuns = useRef<Record<string, number>>({});
  /** Applied flags per photo + category: set on ML click, cleared on revert or a wholesale recipe change. */
  const [mlAppliedByPhoto, setMlAppliedByPhoto] = useState<Record<string, Partial<Record<MlCategory, boolean>>>>({});
  const persistRef = useRef(persistence?.onPersist);
  persistRef.current = persistence?.onPersist;
  const latest = useRef<Record<string, EditState>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const seeded = useRef(false);
  // True once the server seed has been applied. Before that, `edit` is a
  // default placeholder — consumers must not paint it (one frame of empty
  // retouches would flash over saved work on reload).
  const [seedApplied, setSeedApplied] = useState(() => persistence?.initial != null);
  const history = useMemo(() => histories[photoId] || initialHistory(photoId), [histories, photoId]);
  const mlApplied = useMemo(() => mlAppliedByPhoto[photoId] ?? {}, [mlAppliedByPhoto, photoId]);

  const initial = persistence?.initial;
  useEffect(() => {
    if (initial && !seeded.current) {
      seeded.current = true;
      setHistories(initial);
      setSeedApplied(true);
    }
  }, [initial]);

  useEffect(() => () => {
    const persist = persistRef.current;
    for (const [id, timer] of Object.entries(timers.current)) {
      clearTimeout(timer);
      const present = latest.current[id];
      if (persist && present) persist(id, present);
    }
  }, []);

  const schedulePersist = useCallback((id: string, present: EditState) => {
    latest.current[id] = present;
    const persist = persistRef.current;
    if (!persist) return;
    if (timers.current[id]) clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => persist(id, present), 500);
  }, []);

  const endMerge = useCallback(() => {
    lastChange.current.key = '';
  }, []);

  // Persist an edit now instead of waiting out the debounce. Discrete
  // geometry gestures (rotate) pass the new present explicitly — the history
  // updater runs async, so latest.current would still hold the previous
  // edit — so a fast restart finds the new rotation on the server. Without
  // it the edit can lag the heal overlays (PUT immediately) and reopening
  // reheals from the mismatch. A later debounced persist of the same bytes
  // is idempotent and harmless.
  const flushPersist = useCallback((present?: EditState) => {
    const id = photoId;
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
    const snapshot = present ?? latest.current[id];
    if (snapshot) latest.current[id] = snapshot;
    const persist = persistRef.current;
    if (persist && snapshot) persist(id, snapshot);
  }, [photoId]);

  const change = useCallback((patch: Partial<EditState>, mergeKey = '') => {
    const now = Date.now();
    const sticky = mergeKey.startsWith(STICKY_MERGE_PREFIX);
    const sameGesture = Boolean(mergeKey && lastChange.current.key === mergeKey && lastChange.current.photoId === photoId);
    const merge = sticky ? sameGesture : Boolean(sameGesture && now - lastChange.current.time < MERGE_WINDOW_MS);
    lastChange.current = { key: mergeKey, photoId, time: now };
    setHistories((all) => {
      const current = all[photoId] || initialHistory(photoId);
      const next = { ...current.present, ...patch };
      let preset = presetForPatch(current.present.preset, patch);
      // Sliders dragged back to their defaults restore the Original label
      // instead of stranding the photo on Custom.
      if (patch.preset === undefined && preset === 'Custom' && isOriginalLook(next)) preset = 'Original';
      const present = { ...next, preset };
      schedulePersist(photoId, present);
      return {
        ...all,
        [photoId]: {
          past: merge ? current.past : [...current.past.slice(-49), current.present],
          present,
          future: [],
        },
      };
    });
  }, [photoId, schedulePersist]);

  const undo = useCallback(() => {
    lastChange.current.key = '';
    setHistories((all) => {
      const current = all[photoId] || initialHistory(photoId);
      const previous = current.past[current.past.length - 1];
      if (!current.past.length || !previous) return all;
      schedulePersist(photoId, previous);
      return { ...all, [photoId]: { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] } };
    });
  }, [photoId, schedulePersist]);

  const redo = useCallback(() => {
    lastChange.current.key = '';
    setHistories((all) => {
      const current = all[photoId] || initialHistory(photoId);
      const next = current.future[0];
      if (!current.future.length || !next) return all;
      schedulePersist(photoId, next);
      return { ...all, [photoId]: { past: [...current.past, current.present], present: next, future: current.future.slice(1) } };
    });
  }, [photoId, schedulePersist]);

  /**
   * Drop a photo's per-category ML state: wholesale recipe changes (reset,
   * preset, enhance) leave no category "applied", and any in-flight async
   * apply is invalidated so it cannot land on the new recipe.
   */
  const clearMl = useCallback((id: string) => {
    delete mlSnapshots.current[id];
    for (const category of ML_CATEGORIES) {
      const key = `${id}:${category}`;
      mlRuns.current[key] = (mlRuns.current[key] ?? 0) + 1;
    }
    setMlAppliedByPhoto((all) => {
      if (!all[id]) return all;
      const next = { ...all };
      delete next[id];
      return next;
    });
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    clearMl(photoId);
    change({ ...DEFAULT_EDIT, ...preset.values, rotation, flipH, flipV, straighten, cropRatio, retouches, preset: preset.name });
  }, [change, clearMl, history.present, photoId]);

  const reset = useCallback(() => {
    clearMl(photoId);
    if (isDefaultEdit(history.present)) return false;
    change({ ...DEFAULT_EDIT, sceneEnhance: null, faceAdjust: null, selectiveAdjust: null });
    return true;
  }, [change, clearMl, history.present, photoId]);
  // Classic and ML scene enhance share one toggle: each button activates its
  // own mode, and clicking the active mode's button restores the snapshot.
  // Switching modes keeps the pre-enhance snapshot, so toggling off from
  // either mode returns to the same un-enhanced recipe.
  const autoEnhance = useCallback((src?: string) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    const geometry = { rotation, flipH, flipV, straighten, cropRatio, retouches };
    clearMl(photoId);
    if (history.present.autoEnhanced && !history.present.sceneEnhance) {
      change({ ...(enhanceSnapshots.current[photoId] || DEFAULT_EDIT), ...geometry, autoEnhanced: false, sceneEnhance: null });
      return;
    }
    if (!history.present.autoEnhanced) enhanceSnapshots.current[photoId] = history.present;
    const fallback = () => change({ ...INITIAL_EDIT, ...geometry, exposure: 0.22, clarity: 12, autoEnhanced: true, preset: 'Auto Enhance', sceneEnhance: null });
    if (!src) { fallback(); return; }
    void (async () => {
      try {
        const patch = computeAutoEnhance(await decodeDownsampled(src));
        change({ ...INITIAL_EDIT, ...geometry, ...patch, autoEnhanced: true, preset: 'Auto Enhance', sceneEnhance: null });
      } catch { fallback(); }
    })();
  }, [change, clearMl, history.present, photoId]);

  const autoEnhanceScene = useCallback((src?: string) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    const geometry = { rotation, flipH, flipV, straighten, cropRatio, retouches };
    clearMl(photoId);
    if (history.present.autoEnhanced && history.present.sceneEnhance) {
      change({ ...(enhanceSnapshots.current[photoId] || DEFAULT_EDIT), ...geometry, autoEnhanced: false, sceneEnhance: null });
      return;
    }
    if (!history.present.autoEnhanced) enhanceSnapshots.current[photoId] = history.present;
    // Decode failure falls back to the classic fixed patch and claims no
    // scene: a fallback result is never presented as ML.
    const fallback = () => change({ ...INITIAL_EDIT, ...geometry, exposure: 0.22, clarity: 12, autoEnhanced: true, preset: 'Auto Enhance', sceneEnhance: null });
    if (!src) { fallback(); return; }
    void (async () => {
      try {
        const { scene, confidence, patch } = computeSceneAwareEnhance(await decodeDownsampled(src));
        change({ ...INITIAL_EDIT, ...geometry, ...patch, autoEnhanced: true, preset: 'Auto Enhance (ML)', sceneEnhance: { scene, confidence } });
      } catch { fallback(); }
    })();
  }, [change, clearMl, history.present, photoId]);

  // Per-category ML actions share one toggle: the first click snapshots the
  // category and applies computed values, the next click (or the revert icon
  // beside the ML button) restores the snapshot. The run token guards the
  // async decode: a revert landing before the values arrive cancels the
  // apply instead of stranding the photo in the applied state.
  const toggleCategoryMl = useCallback((category: MlCategory, src: string | undefined, compute: (image: PixelImage) => Partial<EditState>, fallbackPatch: Partial<EditState>) => {
    const key = `${photoId}:${category}`;
    if (mlAppliedByPhoto[photoId]?.[category]) {
      mlRuns.current[key] = (mlRuns.current[key] ?? 0) + 1;
      const snapshot = mlSnapshots.current[photoId]?.[category];
      if (snapshot) change(snapshot);
      setMlAppliedByPhoto((all) => ({ ...all, [photoId]: { ...all[photoId], [category]: false } }));
      return;
    }
    mlSnapshots.current[photoId] = { ...mlSnapshots.current[photoId], [category]: snapshotMlCategory(history.present, category) };
    const run = (mlRuns.current[key] ?? 0) + 1;
    mlRuns.current[key] = run;
    setMlAppliedByPhoto((all) => ({ ...all, [photoId]: { ...all[photoId], [category]: true } }));
    // An applied category is always visible: the ML patch re-asserts the
    // enabled flag (legacy recipes can carry a disabled category — the
    // header toggle used to bypass the effect).
    const enabledKey = ML_CATEGORY_ENABLED_KEY[category];
    const apply = (patch: Partial<EditState>) => {
      if (mlRuns.current[key] !== run) return;
      change({ ...patch, [enabledKey]: true });
    };
    if (!src) { apply(fallbackPatch); return; }
    void (async () => {
      try {
        apply(compute(await decodeDownsampled(src)));
      } catch {
        apply(fallbackPatch);
      }
    })();
  }, [change, history.present, mlAppliedByPhoto, photoId]);

  const autoWhiteBalance = useCallback((src?: string) => {
    toggleCategoryMl('whiteBalance', src, computeWhiteBalanceAuto, { temperature: 5800, tint: 6 });
  }, [toggleCategoryMl]);

  const autoLightness = useCallback((src?: string) => {
    toggleCategoryMl('lightness', src, computeLightnessAuto, { exposure: 0.2, contrast: 12, highlights: -28, shadows: 24 });
  }, [toggleCategoryMl]);

  const autoColor = useCallback((src?: string) => {
    toggleCategoryMl('color', src, computeColorAuto, { saturation: 8 });
  }, [toggleCategoryMl]);

  return { edit: history.present, ready: seedApplied, histories, change, endMerge, flushPersist, undo, redo, reset, autoEnhance, autoEnhanceScene, autoWhiteBalance, autoLightness, autoColor, mlApplied, applyPreset, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
