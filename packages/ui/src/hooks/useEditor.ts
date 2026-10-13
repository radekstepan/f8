import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, INITIAL_EDIT, ML_CATEGORIES, ML_CATEGORY_ENABLED_KEY, computeAutoEnhance, computeColorAuto, computeLightnessAuto, computeSceneAwareEnhance, computeWhiteBalanceAuto, decodeDownsampled, isDefaultEdit, isOriginalLook, patchBreaksEnhancePure, presetForPatch, snapshotMlCategory, touchedMlCategories } from '@f8/core';
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
  /** Monotonic run tokens per photo: a revert, mode switch, or wholesale recipe change invalidates an in-flight async enhance. */
  const enhanceRuns = useRef<Record<string, number>>({});
  /** Pre-ML snapshots per photo + category: a revert restores these values. Session-only, like enhanceSnapshots. */
  const mlSnapshots = useRef<Record<string, Partial<Record<MlCategory, Partial<EditState>>>>>({});
  /** Monotonic run tokens per photo + category: a revert or wholesale recipe change invalidates an in-flight async apply. */
  const mlRuns = useRef<Record<string, number>>({});
  /**
   * Pure-auto highlights per photo + category: set on ML click, cleared by a
   * manual edit to the category's keys (values are no longer exactly what
   * auto produced), by a revert, or by a wholesale recipe change.
   */
  const [mlAppliedByPhoto, setMlAppliedByPhoto] = useState<Record<string, Partial<Record<MlCategory, boolean>>>>({});
  /** Revert availability per photo + category: true while a pre-ML snapshot exists, even after manual edits. */
  const [mlRevertByPhoto, setMlRevertByPhoto] = useState<Record<string, Partial<Record<MlCategory, boolean>>>>({});
  /**
   * Whole-photo enhance UI per photo: the last mode with a stored snapshot
   * plus whether the recipe still holds exactly its values. Manual look
   * edits clear `pure` (highlight off) while `mode` stays for the revert.
   */
  const [enhanceUiByPhoto, setEnhanceUiByPhoto] = useState<Record<string, { mode: 'classic' | 'scene'; pure: boolean }>>({});
  /** Set while applying auto-computed values so change() skips manual-edit highlight clearing for that patch. */
  const autoApplyRef = useRef(false);
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
  const mlRevert = useMemo(() => mlRevertByPhoto[photoId] ?? {}, [mlRevertByPhoto, photoId]);
  const enhanceUi = useMemo(() => enhanceUiByPhoto[photoId] ?? null, [enhanceUiByPhoto, photoId]);

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
    if (!autoApplyRef.current) {
      // Manual edit: pure-auto highlights for touched values drop — the
      // recipe no longer holds exactly what auto produced — while every
      // revert snapshot stays available.
      const touched = touchedMlCategories(patch);
      if (touched.length > 0) {
        setMlAppliedByPhoto((all) => {
          const current = all[photoId];
          if (!current || touched.every((category) => !current[category])) return all;
          const next = { ...current };
          for (const category of touched) next[category] = false;
          return { ...all, [photoId]: next };
        });
      }
      if (patchBreaksEnhancePure(patch)) {
        setEnhanceUiByPhoto((all) => {
          const current = all[photoId];
          if (!current || !current.pure) return all;
          return { ...all, [photoId]: { ...current, pure: false } };
        });
      }
    }
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
   * preset, enhance) leave no highlight and no revert, and any in-flight
   * async apply is invalidated so it cannot land on the new recipe.
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
    setMlRevertByPhoto((all) => {
      if (!all[id]) return all;
      const next = { ...all };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * Drop a photo's whole-photo enhance state: wholesale recipe changes
   * (reset, preset) leave no highlight and no revert, and any in-flight
   * async enhance is invalidated so it cannot land on the new recipe.
   */
  const clearEnhance = useCallback((id: string) => {
    delete enhanceSnapshots.current[id];
    enhanceRuns.current[id] = (enhanceRuns.current[id] ?? 0) + 1;
    setEnhanceUiByPhoto((all) => {
      if (!all[id]) return all;
      const next = { ...all };
      delete next[id];
      return next;
    });
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    clearMl(photoId);
    clearEnhance(photoId);
    change({ ...DEFAULT_EDIT, ...preset.values, rotation, flipH, flipV, straighten, cropRatio, retouches, preset: preset.name });
  }, [change, clearMl, clearEnhance, history.present, photoId]);

  const reset = useCallback(() => {
    clearMl(photoId);
    clearEnhance(photoId);
    if (isDefaultEdit(history.present)) return false;
    change({ ...DEFAULT_EDIT, sceneEnhance: null, faceAdjust: null, selectiveAdjust: null });
    return true;
  }, [change, clearMl, clearEnhance, history.present, photoId]);
  // Classic and ML scene enhance share one snapshot and one revert: each
  // button highlights only its own pure mode. Clicking the highlighted
  // mode's button (or its revert icon) restores the pre-enhance snapshot;
  // clicking any other enhance button applies fresh values while keeping
  // the earliest snapshot, so revert always returns to the un-enhanced
  // recipe. Manual look edits clear `pure` (highlight off, via change())
  // but keep the snapshot for the revert icon.
  const revertEnhance = useCallback(() => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    const geometry = { rotation, flipH, flipV, straighten, cropRatio, retouches };
    enhanceRuns.current[photoId] = (enhanceRuns.current[photoId] ?? 0) + 1;
    const snapshot = enhanceSnapshots.current[photoId];
    delete enhanceSnapshots.current[photoId];
    setEnhanceUiByPhoto((all) => {
      if (!all[photoId]) return all;
      const next = { ...all };
      delete next[photoId];
      return next;
    });
    // An enhance revert is a wholesale recipe change for the per-category
    // ML state: its snapshots reference enhance-era values.
    clearMl(photoId);
    // Unguarded on purpose: restoring the snapshot also drops stale pure
    // flags through the normal manual-edit path.
    if (snapshot) change({ ...snapshot, ...geometry, autoEnhanced: false, sceneEnhance: null });
    else change({ autoEnhanced: false, sceneEnhance: null });
  }, [change, clearMl, history.present, photoId]);

  const runEnhance = useCallback((mode: 'classic' | 'scene', src: string | undefined, label: string, produce: (pixels: PixelImage) => { patch: Partial<EditState>; sceneEnhance: EditState['sceneEnhance'] }) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    const geometry = { rotation, flipH, flipV, straighten, cropRatio, retouches };
    if (enhanceUi?.mode === mode && enhanceUi.pure) {
      revertEnhance();
      return;
    }
    clearMl(photoId);
    if (!enhanceSnapshots.current[photoId]) enhanceSnapshots.current[photoId] = history.present;
    const run = (enhanceRuns.current[photoId] ?? 0) + 1;
    enhanceRuns.current[photoId] = run;
    setEnhanceUiByPhoto((all) => ({ ...all, [photoId]: { mode, pure: true } }));
    const apply = (patch: Partial<EditState>, sceneEnhance: EditState['sceneEnhance'], preset: string) => {
      if (enhanceRuns.current[photoId] !== run) return;
      autoApplyRef.current = true;
      try {
        change({ ...INITIAL_EDIT, ...geometry, ...patch, autoEnhanced: true, preset, sceneEnhance });
      } finally {
        autoApplyRef.current = false;
      }
    };
    // Decode failure falls back to the classic fixed patch and claims no
    // scene: a fallback result is never presented as ML.
    const fallback = () => apply({ exposure: 0.22, clarity: 12 }, null, 'Auto Enhance');
    if (!src) { fallback(); return; }
    void (async () => {
      try {
        const { patch, sceneEnhance } = produce(await decodeDownsampled(src));
        apply(patch, sceneEnhance, label);
      } catch { fallback(); }
    })();
  }, [change, clearMl, enhanceUi, history.present, photoId, revertEnhance]);

  const autoEnhance = useCallback((src?: string) => {
    runEnhance('classic', src, 'Auto Enhance', (pixels) => ({ patch: computeAutoEnhance(pixels), sceneEnhance: null }));
  }, [runEnhance]);

  const autoEnhanceScene = useCallback((src?: string) => {
    runEnhance('scene', src, 'Auto Enhance (ML)', (pixels) => {
      const { scene, confidence, patch } = computeSceneAwareEnhance(pixels);
      return { patch, sceneEnhance: { scene, confidence } };
    });
  }, [runEnhance]);

  // Per-category ML actions share one pattern with enhance: the button
  // highlights only while the recipe holds exactly the auto values, with a
  // separate revert icon offering the pre-ML snapshot. Clicking a
  // highlighted button reverts (the Task 1 click-again behavior); clicking
  // an idle or manually-touched button applies fresh values while keeping
  // the earliest snapshot, so revert always returns to pre-ML. Manual
  // slider edits clear the highlight via change() but keep the snapshot.
  const revertCategoryMl = useCallback((category: MlCategory) => {
    const key = `${photoId}:${category}`;
    mlRuns.current[key] = (mlRuns.current[key] ?? 0) + 1;
    const snapshot = mlSnapshots.current[photoId]?.[category];
    if (mlSnapshots.current[photoId]) {
      const next = { ...mlSnapshots.current[photoId] };
      delete next[category];
      mlSnapshots.current[photoId] = next;
    }
    setMlAppliedByPhoto((all) => ({ ...all, [photoId]: { ...all[photoId], [category]: false } }));
    setMlRevertByPhoto((all) => ({ ...all, [photoId]: { ...all[photoId], [category]: false } }));
    // Unguarded on purpose: the restore also drops stale pure flags
    // (whole-photo enhance included) through the normal manual-edit path.
    if (snapshot) change(snapshot);
  }, [change, photoId]);

  // The run token guards the async decode: a revert landing before the
  // values arrive cancels the apply instead of stranding the photo in the
  // applied state.
  const toggleCategoryMl = useCallback((category: MlCategory, src: string | undefined, compute: (image: PixelImage) => Partial<EditState>, fallbackPatch: Partial<EditState>) => {
    const key = `${photoId}:${category}`;
    if (mlAppliedByPhoto[photoId]?.[category]) {
      revertCategoryMl(category);
      return;
    }
    if (!mlSnapshots.current[photoId]?.[category]) {
      mlSnapshots.current[photoId] = { ...mlSnapshots.current[photoId], [category]: snapshotMlCategory(history.present, category) };
    }
    const run = (mlRuns.current[key] ?? 0) + 1;
    mlRuns.current[key] = run;
    setMlAppliedByPhoto((all) => ({ ...all, [photoId]: { ...all[photoId], [category]: true } }));
    setMlRevertByPhoto((all) => ({ ...all, [photoId]: { ...all[photoId], [category]: true } }));
    // A category ML apply rewrites color values, so any whole-photo
    // enhance is no longer pure — its revert snapshot stays.
    setEnhanceUiByPhoto((all) => {
      const current = all[photoId];
      if (!current || !current.pure) return all;
      return { ...all, [photoId]: { ...current, pure: false } };
    });
    // An applied category always enables its effect (legacy recipes can
    // carry a disabled category — the header toggle used to bypass it).
    const enabledKey = ML_CATEGORY_ENABLED_KEY[category];
    const apply = (patch: Partial<EditState>) => {
      if (mlRuns.current[key] !== run) return;
      autoApplyRef.current = true;
      try {
        change({ ...patch, [enabledKey]: true });
      } finally {
        autoApplyRef.current = false;
      }
    };
    if (!src) { apply(fallbackPatch); return; }
    void (async () => {
      try {
        apply(compute(await decodeDownsampled(src)));
      } catch {
        apply(fallbackPatch);
      }
    })();
  }, [change, history.present, mlAppliedByPhoto, photoId, revertCategoryMl]);

  const autoWhiteBalance = useCallback((src?: string) => {
    toggleCategoryMl('whiteBalance', src, computeWhiteBalanceAuto, { temperature: 5800, tint: 6 });
  }, [toggleCategoryMl]);

  const autoLightness = useCallback((src?: string) => {
    toggleCategoryMl('lightness', src, computeLightnessAuto, { exposure: 0.2, contrast: 12, highlights: -28, shadows: 24 });
  }, [toggleCategoryMl]);

  const autoColor = useCallback((src?: string) => {
    toggleCategoryMl('color', src, computeColorAuto, { saturation: 8 });
  }, [toggleCategoryMl]);

  const revertWhiteBalance = useCallback(() => revertCategoryMl('whiteBalance'), [revertCategoryMl]);
  const revertLightness = useCallback(() => revertCategoryMl('lightness'), [revertCategoryMl]);
  const revertColor = useCallback(() => revertCategoryMl('color'), [revertCategoryMl]);

  return { edit: history.present, ready: seedApplied, histories, change, endMerge, flushPersist, undo, redo, reset, autoEnhance, autoEnhanceScene, revertEnhance, autoWhiteBalance, autoLightness, autoColor, revertWhiteBalance, revertLightness, revertColor, mlApplied, mlRevert, enhanceMode: enhanceUi?.mode ?? null, enhancePure: enhanceUi?.pure ?? false, applyPreset, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
