import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, INITIAL_EDIT, computeAutoEnhance, computeLightnessAuto, computeWhiteBalanceAuto, decodeDownsampled } from '@photomator/core';
import type { EditState, HistoryState, Preset } from '@photomator/core';

const initialHistory = (id: string): HistoryState => ({
  past: id === 'photo-1' ? [{ ...DEFAULT_EDIT }] : [],
  present: { ...(id === 'photo-1' ? INITIAL_EDIT : DEFAULT_EDIT) },
  future: [],
});

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
  const history = useMemo(() => histories[photoId] || initialHistory(photoId), [histories, photoId]);

  const initial = persistence?.initial;
  useEffect(() => {
    if (initial && !seeded.current) {
      seeded.current = true;
      setHistories(initial);
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

  const change = useCallback((patch: Partial<EditState>, mergeKey = '') => {
    const now = Date.now();
    const merge = Boolean(mergeKey && lastChange.current.key === mergeKey && lastChange.current.photoId === photoId && now - lastChange.current.time < 700);
    lastChange.current = { key: mergeKey, photoId, time: now };
    setHistories((all) => {
      const current = all[photoId] || initialHistory(photoId);
      const present = { ...current.present, preset: 'Custom', ...patch };
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

  const reset = useCallback(() => change({ ...DEFAULT_EDIT }), [change]);
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

  return { edit: history.present, histories, change, undo, redo, reset, autoEnhance, autoWhiteBalance, autoLightness, applyPreset, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
