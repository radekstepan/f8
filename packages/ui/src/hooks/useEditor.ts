import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, INITIAL_EDIT, ML_CATEGORIES, ML_CATEGORY_ENABLED_KEY, RESET_PATCH, actionEntry, clearCategoryActions, clearEnhanceAction, clearPureOnPatch, computeAutoEnhance, computeColorAuto, computeLightnessAuto, computeSceneAwareEnhance, computeWhiteBalanceAuto, decodeDownsampled, enhanceFromStack, isDefaultEdit, isOriginalLook, mlAppliedFromStack, mlRevertFromStack, presetForPatch, pushAction, revertAction, sanitizeActionStack, snapshotForEnhance, snapshotMlCategory } from '@f8/core';
import type { ActionStack, EditState, EnhanceMode, HistoryState, MlCategory, PixelImage, Preset } from '@f8/core';

const initialHistory = (_id?: string): HistoryState => ({
  past: [],
  present: { ...DEFAULT_EDIT },
  future: [],
});

/** Merge keys for heal strokes bypass the time window: one stroke id = one undo step. */
const STICKY_MERGE_PREFIX = 'retouch-stroke:';
const MERGE_WINDOW_MS = 700;

const EMPTY_STACK: ActionStack = [];

/** Seed from the server library: recipes plus their persisted auto-action stacks. */
export interface EditorSeed {
  histories: Record<string, HistoryState>;
  actions: Record<string, ActionStack>;
}

export interface EditorPersistence {
  /** Seed from the server library; applied once when it arrives. */
  initial?: EditorSeed | null;
  /** Debounced persist of the current recipe plus its action stack; undo/redo stacks stay session-only. */
  onPersist?: (photoId: string, present: EditState, actions: ActionStack) => void;
}

function sanitizeSeedActions(seed?: Record<string, ActionStack>): Record<string, ActionStack> {
  if (!seed) return {};
  return Object.fromEntries(Object.entries(seed).map(([id, stack]) => [id, sanitizeActionStack(stack)]));
}

export function useEditor(photoId: string, persistence?: EditorPersistence) {
  const [histories, setHistories] = useState<Record<string, HistoryState>>(() => persistence?.initial?.histories ?? {});
  /**
   * Applied auto actions per photo (whole-photo enhance + per-category
   * autos), each with the snapshot its revert restores. This is the single
   * source of truth for Auto highlights and reverts — it persists with the
   * recipe, so every Auto stays revertible across a hard reload. The
   * `stacks` ref mirrors it for synchronous reads inside change handlers.
   */
  const [actionStacks, setActionStacks] = useState<Record<string, ActionStack>>(() => sanitizeSeedActions(persistence?.initial?.actions));
  const lastChange = useRef({ key: '', photoId: '', time: 0 });
  /** Monotonic run tokens per photo: a revert, mode switch, or wholesale recipe change invalidates an in-flight async enhance. */
  const enhanceRuns = useRef<Record<string, number>>({});
  /** Monotonic run tokens per photo + category: a revert or wholesale recipe change invalidates an in-flight async apply. */
  const mlRuns = useRef<Record<string, number>>({});
  /** Set while applying auto-computed values so change() skips manual-edit highlight clearing for that patch. */
  const autoApplyRef = useRef(false);
  const persistRef = useRef(persistence?.onPersist);
  persistRef.current = persistence?.onPersist;
  const latest = useRef<Record<string, EditState>>({});
  const latestStacks = useRef<Record<string, ActionStack>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const seeded = useRef(false);
  const stacksRef = useRef<Record<string, ActionStack>>({});
  const stacksBootstrapped = useRef(false);
  if (!stacksBootstrapped.current) {
    stacksBootstrapped.current = true;
    stacksRef.current = sanitizeSeedActions(persistence?.initial?.actions);
  }
  // True once the server seed has been applied. Before that, `edit` is a
  // default placeholder — consumers must not paint it (one frame of empty
  // retouches would flash over saved work on reload).
  const [seedApplied, setSeedApplied] = useState(() => persistence?.initial != null);
  const history = useMemo(() => histories[photoId] || initialHistory(photoId), [histories, photoId]);
  const stack = useMemo(() => actionStacks[photoId] ?? EMPTY_STACK, [actionStacks, photoId]);
  const enhance = useMemo(() => enhanceFromStack(stack), [stack]);
  const mlApplied = useMemo(() => mlAppliedFromStack(stack), [stack]);
  const mlRevert = useMemo(() => mlRevertFromStack(stack), [stack]);

  const initial = persistence?.initial;
  useEffect(() => {
    if (initial && !seeded.current) {
      seeded.current = true;
      setHistories(initial.histories);
      // Recipes and their auto-action stacks seed together: a reload
      // restores every Auto's highlight and revert, not just its values.
      const actions = sanitizeSeedActions(initial.actions);
      stacksRef.current = actions;
      setActionStacks(actions);
      setSeedApplied(true);
    }
  }, [initial]);

  useEffect(() => () => {
    const persist = persistRef.current;
    for (const [id, timer] of Object.entries(timers.current)) {
      clearTimeout(timer);
      const present = latest.current[id];
      if (persist && present) persist(id, present, latestStacks.current[id] ?? []);
    }
  }, []);

  const schedulePersist = useCallback((id: string, present: EditState) => {
    latest.current[id] = present;
    const stackToSave = stacksRef.current[id] ?? [];
    latestStacks.current[id] = stackToSave;
    const persist = persistRef.current;
    if (!persist) return;
    if (timers.current[id]) clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => persist(id, present, stackToSave), 500);
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
    const stackToSave = stacksRef.current[id] ?? [];
    latestStacks.current[id] = stackToSave;
    const persist = persistRef.current;
    if (persist && snapshot) persist(id, snapshot, stackToSave);
  }, [photoId]);

  /** Write one photo's stack to the ref (synchronous reads) and state (render). */
  const writeStack = useCallback((id: string, stack: ActionStack) => {
    const current = stacksRef.current[id];
    if (current === stack) return;
    if (!current && stack.length === 0) return;
    stacksRef.current = { ...stacksRef.current, [id]: stack };
    setActionStacks((all) => ({ ...all, [id]: stack }));
  }, []);

  const change = useCallback((patch: Partial<EditState>, mergeKey = '') => {
    if (!autoApplyRef.current) {
      // Manual edit: pure-auto highlights for touched values drop — the
      // recipe no longer holds exactly what auto produced — while every
      // revert snapshot stays available.
      const current = stacksRef.current[photoId];
      if (current?.length) {
        const next = clearPureOnPatch(current, patch);
        if (next !== current) writeStack(photoId, next);
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
  }, [photoId, schedulePersist, writeStack]);

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
    writeStack(id, clearCategoryActions(stacksRef.current[id] ?? []));
    for (const category of ML_CATEGORIES) {
      const key = `${id}:${category}`;
      mlRuns.current[key] = (mlRuns.current[key] ?? 0) + 1;
    }
  }, [writeStack]);

  /**
   * Drop a photo's whole-photo enhance state: wholesale recipe changes
   * (reset, preset) leave no highlight and no revert, and any in-flight
   * async enhance is invalidated so it cannot land on the new recipe.
   */
  const clearEnhance = useCallback((id: string) => {
    writeStack(id, clearEnhanceAction(stacksRef.current[id] ?? []));
    enhanceRuns.current[id] = (enhanceRuns.current[id] ?? 0) + 1;
  }, [writeStack]);

  const applyPreset = useCallback((preset: Preset) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    clearMl(photoId);
    clearEnhance(photoId);
    change({ ...DEFAULT_EDIT, ...preset.values, rotation, flipH, flipV, straighten, cropRatio, retouches, preset: preset.name });
  }, [change, clearMl, clearEnhance, history.present, photoId]);

  const reset = useCallback(() => {
    const hadStack = (stacksRef.current[photoId] ?? []).length > 0;
    clearMl(photoId);
    clearEnhance(photoId);
    if (isDefaultEdit(history.present)) {
      // Nothing to reset in the recipe, but a cleared stack still has to
      // reach the server so the reload reopens with no stale reverts.
      if (hadStack) schedulePersist(photoId, history.present);
      return false;
    }
    change({ ...RESET_PATCH });
    return true;
  }, [change, clearMl, clearEnhance, history.present, photoId, schedulePersist]);
  // Classic and ML scene enhance share one stack slot and one revert: each
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
    // An enhance revert is a wholesale recipe change for the per-category
    // ML state: its snapshots reference enhance-era values.
    clearMl(photoId);
    const popped = revertAction(stacksRef.current[photoId] ?? [], 'enhance');
    if (popped) writeStack(photoId, popped.stack);
    // Unguarded on purpose: restoring the snapshot also drops stale pure
    // flags through the normal manual-edit path.
    if (popped) change({ ...popped.snapshot, ...geometry, autoEnhanced: false, sceneEnhance: null });
    else change({ autoEnhanced: false, sceneEnhance: null });
  }, [change, clearMl, history.present, photoId, writeStack]);

  const runEnhance = useCallback((mode: EnhanceMode, src: string | undefined, label: string, produce: (pixels: PixelImage) => { patch: Partial<EditState>; sceneEnhance: EditState['sceneEnhance'] }) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    const geometry = { rotation, flipH, flipV, straighten, cropRatio, retouches };
    // A highlighted mode toggles back only while its stack entry exists;
    // without one the click falls through to a fresh apply below
    // (snapshotting the current recipe first) instead of a flag-only
    // revert that would leave enhanced values behind.
    const entry = actionEntry(stacksRef.current[photoId] ?? [], 'enhance');
    if (entry?.mode === mode && entry.pure) {
      revertEnhance();
      return;
    }
    clearMl(photoId);
    // pushAction keeps the earliest snapshot on re-apply, so the revert
    // always returns to the un-enhanced recipe.
    writeStack(photoId, pushAction(stacksRef.current[photoId] ?? [], { kind: 'enhance', mode, pure: true, snapshot: snapshotForEnhance(history.present), appliedAt: new Date().toISOString() }));
    const run = (enhanceRuns.current[photoId] ?? 0) + 1;
    enhanceRuns.current[photoId] = run;
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
  }, [change, clearMl, history.present, photoId, revertEnhance, writeStack]);

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
    const popped = revertAction(stacksRef.current[photoId] ?? [], category);
    if (!popped) return;
    writeStack(photoId, popped.stack);
    // Unguarded on purpose: the restore also drops stale pure flags
    // (whole-photo enhance included) through the normal manual-edit path.
    change(popped.snapshot);
  }, [change, photoId, writeStack]);

  // The run token guards the async decode: a revert landing before the
  // values arrive cancels the apply instead of stranding the photo in the
  // applied state.
  const toggleCategoryMl = useCallback((category: MlCategory, src: string | undefined, compute: (image: PixelImage) => Partial<EditState>, fallbackPatch: Partial<EditState>) => {
    const key = `${photoId}:${category}`;
    if (actionEntry(stacksRef.current[photoId] ?? [], category)?.pure) {
      revertCategoryMl(category);
      return;
    }
    writeStack(photoId, pushAction(stacksRef.current[photoId] ?? [], { kind: category, pure: true, snapshot: snapshotMlCategory(history.present, category), appliedAt: new Date().toISOString() }));
    const run = (mlRuns.current[key] ?? 0) + 1;
    mlRuns.current[key] = run;
    // A category ML apply rewrites color values, so any whole-photo
    // enhance is no longer pure — its revert snapshot stays.
    const withEntry = stacksRef.current[photoId] ?? [];
    const enhanceEntry = actionEntry(withEntry, 'enhance');
    if (enhanceEntry?.pure) {
      writeStack(photoId, withEntry.map((candidate) => candidate.kind === 'enhance' ? { ...candidate, pure: false } : candidate));
    }
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
  }, [change, history.present, photoId, revertCategoryMl, writeStack]);

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

  const enhanceCanRevert = enhance != null;
  return { edit: history.present, ready: seedApplied, histories, change, endMerge, flushPersist, undo, redo, reset, autoEnhance, autoEnhanceScene, revertEnhance, autoWhiteBalance, autoLightness, autoColor, revertWhiteBalance, revertLightness, revertColor, mlApplied, mlRevert, enhanceMode: enhance?.mode ?? null, enhancePure: enhance?.pure ?? false, enhanceCanRevert, applyPreset, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
