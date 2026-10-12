import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, INITIAL_EDIT, computeAutoEnhance, computeLightnessAuto, computeWhiteBalanceAuto, decodeDownsampled, isDefaultEdit, isOriginalLook, presetForPatch } from '@photomator/core';
import type { EditState, HistoryState, Preset } from '@photomator/core';

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

  const applyPreset = useCallback((preset: Preset) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    change({ ...DEFAULT_EDIT, ...preset.values, rotation, flipH, flipV, straighten, cropRatio, retouches, preset: preset.name });
  }, [change, history.present]);

  const reset = useCallback(() => {
    if (isDefaultEdit(history.present)) return false;
    change({ ...DEFAULT_EDIT });
    return true;
  }, [change, history.present]);
  const autoEnhance = useCallback((src?: string) => {
    const { rotation, flipH, flipV, straighten, cropRatio, retouches } = history.present;
    const geometry = { rotation, flipH, flipV, straighten, cropRatio, retouches };
    if (history.present.autoEnhanced) {
      change({ ...(enhanceSnapshots.current[photoId] || DEFAULT_EDIT), ...geometry, autoEnhanced: false });
      return;
    }
    enhanceSnapshots.current[photoId] = history.present;
    const fallback = () => change({ ...INITIAL_EDIT, ...geometry, exposure: 0.22, clarity: 12, autoEnhanced: true, preset: 'Auto Enhance' });
    if (!src) { fallback(); return; }
    void (async () => {
      try {
        const patch = computeAutoEnhance(await decodeDownsampled(src));
        change({ ...INITIAL_EDIT, ...geometry, ...patch, autoEnhanced: true, preset: 'Auto Enhance' });
      } catch { fallback(); }
    })();
  }, [change, history.present, photoId]);

  const autoWhiteBalance = useCallback((src?: string) => {
    const fallback = () => change({ temperature: 5800, tint: 6, whiteBalanceEnabled: true });
    if (!src) { fallback(); return; }
    void (async () => {
      try {
        change({ ...computeWhiteBalanceAuto(await decodeDownsampled(src)), whiteBalanceEnabled: true });
      } catch { fallback(); }
    })();
  }, [change]);

  const autoLightness = useCallback((src?: string) => {
    const fallback = () => change({ exposure: 0.2, contrast: 12, highlights: -28, shadows: 24, lightnessEnabled: true });
    if (!src) { fallback(); return; }
    void (async () => {
      try {
        change({ ...computeLightnessAuto(await decodeDownsampled(src)), lightnessEnabled: true });
      } catch { fallback(); }
    })();
  }, [change]);

  return { edit: history.present, ready: seedApplied, histories, change, endMerge, flushPersist, undo, redo, reset, autoEnhance, autoWhiteBalance, autoLightness, applyPreset, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
