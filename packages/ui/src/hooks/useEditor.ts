import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, INITIAL_EDIT, ML_CATEGORIES, ML_CATEGORY_ENABLED_KEY, RESET_PATCH, actionEntry, clearEnhanceAction, clearPureOnPatch, computeAutoEnhance, computeColorAuto, computeLightnessAuto, computeSceneAwareEnhance, computeWhiteBalanceAuto, decodeDownsampled, enhanceFromStack, isDefaultEdit, isOriginalLook, presetForPatch, pushEnhanceAction, revertAction, sanitizeActionStack } from '@f8/core';
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
   * Applied whole-photo enhance per photo, with the snapshot its revert
   * restores. This is the single source of truth for the enhance highlight
   * and revert — it persists with the recipe, so the enhance stays
   * revertible across a hard reload. The per-category autos keep no
   * entries: their header toggles read the recipe directly. The `stacks`
   * ref mirrors it for synchronous reads inside change handlers.
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
   * Invalidate a photo's in-flight per-category async applies so they
   * cannot land on a recipe an enhance (or clear) has since overwritten.
   */
  const invalidateMlRuns = useCallback((id: string) => {
    for (const category of ML_CATEGORIES) {
      const key = `${id}:${category}`;
      mlRuns.current[key] = (mlRuns.current[key] ?? 0) + 1;
    }
  }, []);

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
    // Presets carry basic looks only: the target keeps its geometry, heal
    // strokes, and denoise. Denoise reads from the current recipe (not the
    // preset values) so even a legacy custom preset saved with denoise
    // cannot overwrite the target photo's own strength.
    const { rotation, flipH, flipV, straighten, cropRatio, retouches, denoise } = history.present;
    invalidateMlRuns(photoId);
    clearEnhance(photoId);
    change({ ...DEFAULT_EDIT, ...preset.values, rotation, flipH, flipV, straighten, cropRatio, retouches, denoise, preset: preset.name });
  }, [change, invalidateMlRuns, clearEnhance, history.present, photoId]);

  const reset = useCallback(() => {
    const hadStack = (stacksRef.current[photoId] ?? []).length > 0;
    invalidateMlRuns(photoId);
    clearEnhance(photoId);
    if (isDefaultEdit(history.present)) {
      // Nothing to reset in the recipe, but a cleared stack still has to
      // reach the server so the reload reopens with no stale reverts.
      if (hadStack) schedulePersist(photoId, history.present);
      return false;
    }
    change({ ...RESET_PATCH });
    return true;
  }, [change, invalidateMlRuns, clearEnhance, history.present, photoId, schedulePersist]);
  // Classic and scene enhance share one stack slot and one revert: each
  // control highlights only its own pure mode. Clicking the highlighted
  // mode's control (or its revert icon) restores the pre-enhance snapshot;
  // clicking any other enhance control applies fresh values while keeping
  // the earliest snapshot, so revert always returns to the un-enhanced
  // recipe. Manual look edits clear `pure` (highlight off, via change())
  // but keep the snapshot for the revert icon. An enhance apply also
  // dirties the sections it wrote, so their header toggles light with no
  // stack entries of their own — toggling one off clears the enhance
  // highlight through the normal manual-edit path.
  const revertEnhance = useCallback(() => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    const geometry = { rotation, flipH, flipV, straighten, cropRatio, retouches };
    enhanceRuns.current[photoId] = (enhanceRuns.current[photoId] ?? 0) + 1;
    // An enhance revert is a wholesale recipe change: the full pre-enhance
    // look comes back, so any in-flight per-category apply is invalidated
    // rather than landing on the restored recipe.
    invalidateMlRuns(photoId);
    const popped = revertAction(stacksRef.current[photoId] ?? [], 'enhance');
    if (popped) writeStack(photoId, popped.stack);
    // Unguarded on purpose: restoring the snapshot also drops stale pure
    // flags through the normal manual-edit path.
    if (popped) change({ ...popped.snapshot, ...geometry, autoEnhanced: false, sceneEnhance: null });
    else change({ autoEnhanced: false, sceneEnhance: null });
  }, [change, invalidateMlRuns, history.present, photoId, writeStack]);

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
    // Whole-photo enhance turns the per-category toggles on too: the
    // enhance writes non-default values, so the dirty-driven section
    // toggles light with no stack entries of their own. In-flight
    // per-category applies are still invalidated — the enhance overwrites
    // their values.
    invalidateMlRuns(photoId);
    writeStack(photoId, pushEnhanceAction(stacksRef.current[photoId] ?? [], mode, history.present, new Date().toISOString()));
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
    // scene: a fallback result never claims a detected scene.
    const fallback = () => apply({ exposure: 0.22, clarity: 12 }, null, 'Auto Enhance');
    if (!src) { fallback(); return; }
    void (async () => {
      try {
        const { patch, sceneEnhance } = produce(await decodeDownsampled(src));
        apply(patch, sceneEnhance, label);
      } catch { fallback(); }
    })();
  }, [change, history.present, invalidateMlRuns, photoId, revertEnhance, writeStack]);

  const autoEnhance = useCallback((src?: string) => {
    runEnhance('classic', src, 'Auto Enhance', (pixels) => ({ patch: computeAutoEnhance(pixels), sceneEnhance: null }));
  }, [runEnhance]);

  const autoEnhanceScene = useCallback((src?: string) => {
    runEnhance('scene', src, 'Auto Enhance (Scene)', (pixels) => {
      const { scene, confidence, patch } = computeSceneAwareEnhance(pixels);
      return { patch, sceneEnhance: { scene, confidence } };
    });
  }, [runEnhance]);

  // ML Auto Enhance: the taste mode of the shared enhance slot. Unlike
  // classic/scene it needs no pixel analysis — the patch is the user's
  // learned medians (see tasteEnhancePatch), computed by the caller — so
  // the apply is synchronous. The stack contract matches runEnhance: a
  // pure taste entry toggles back to the pre-enhance look, any other mode
  // applies fresh while keeping the earliest snapshot, and the run bump
  // drops an in-flight async enhance so it cannot land on top. The base is
  // the factory default (not INITIAL_EDIT): taste medians are absolute
  // values learned from default-based recipes, so layering them over the
  // Natural base would double-apply a look the user never chose.
  const autoEnhanceTaste = useCallback((patch: Partial<EditState>) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    const geometry = { rotation, flipH, flipV, straighten, cropRatio, retouches };
    const entry = actionEntry(stacksRef.current[photoId] ?? [], 'enhance');
    if (entry?.mode === 'taste' && entry.pure) {
      revertEnhance();
      return;
    }
    invalidateMlRuns(photoId);
    writeStack(photoId, pushEnhanceAction(stacksRef.current[photoId] ?? [], 'taste', history.present, new Date().toISOString()));
    enhanceRuns.current[photoId] = (enhanceRuns.current[photoId] ?? 0) + 1;
    autoApplyRef.current = true;
    try {
      change({ ...DEFAULT_EDIT, ...geometry, ...patch, autoEnhanced: true, preset: 'ML Auto Enhance', sceneEnhance: null });
    } finally {
      autoApplyRef.current = false;
    }
  }, [change, history.present, invalidateMlRuns, photoId, revertEnhance, writeStack]);

  // Per-category auto actions are apply-only: the header toggle reads
  // dirtiness straight from the recipe (on = non-default values, whether
  // auto-applied or hand-tweaked), so applies push no stack entries — and
  // toggling off resets to the section defaults via resetCategory below,
  // which needs no snapshot either. The apply runs unguarded on purpose:
  // rewriting color values breaks whole-photo enhance purity through the
  // normal manual-edit path, exactly like a slider drag would.
  // The run token guards the async decode: a reset (or wholesale recipe
  // change) landing before the values arrive cancels the apply instead of
  // re-dirtying a section the user just turned off.
  const runCategoryAuto = useCallback((category: MlCategory, src: string | undefined, compute: (image: PixelImage) => Partial<EditState>, fallbackPatch: Partial<EditState>) => {
    const key = `${photoId}:${category}`;
    const run = (mlRuns.current[key] ?? 0) + 1;
    mlRuns.current[key] = run;
    // An applied category always enables its effect (legacy recipes can
    // carry a disabled category — the header toggle used to bypass it).
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
  }, [change, photoId]);

  // Toggle-off target per category: the section defaults, matching the
  // sliders' dirty checks in the Inspector. Bumping the run token first
  // cancels an in-flight auto apply so it cannot land on the reset recipe.
  const resetCategory = useCallback((category: MlCategory) => {
    const key = `${photoId}:${category}`;
    mlRuns.current[key] = (mlRuns.current[key] ?? 0) + 1;
    const patch = category === 'whiteBalance'
      ? { temperature: 5500, tint: 0 }
      : category === 'lightness'
        ? { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, blacks: 0 }
        : { hue: 0, saturation: 0, vibrance: 0 };
    change(patch);
  }, [change, photoId]);

  const autoWhiteBalance = useCallback((src?: string) => {
    runCategoryAuto('whiteBalance', src, computeWhiteBalanceAuto, { temperature: 5800, tint: 6 });
  }, [runCategoryAuto]);

  const autoLightness = useCallback((src?: string) => {
    runCategoryAuto('lightness', src, computeLightnessAuto, { exposure: 0.2, contrast: 12, highlights: -28, shadows: 24 });
  }, [runCategoryAuto]);

  const autoColor = useCallback((src?: string) => {
    runCategoryAuto('color', src, computeColorAuto, { saturation: 8 });
  }, [runCategoryAuto]);

  const resetWhiteBalance = useCallback(() => resetCategory('whiteBalance'), [resetCategory]);
  const resetLightness = useCallback(() => resetCategory('lightness'), [resetCategory]);
  const resetColor = useCallback(() => resetCategory('color'), [resetCategory]);

  const enhanceCanRevert = enhance != null;
  return { edit: history.present, ready: seedApplied, histories, change, endMerge, flushPersist, undo, redo, reset, autoEnhance, autoEnhanceScene, autoEnhanceTaste, revertEnhance, autoWhiteBalance, autoLightness, autoColor, resetWhiteBalance, resetLightness, resetColor, enhanceMode: enhance?.mode ?? null, enhancePure: enhance?.pure ?? false, enhanceCanRevert, applyPreset, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
