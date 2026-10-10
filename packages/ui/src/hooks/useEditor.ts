import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, INITIAL_EDIT, computeAutoEnhance, decodeDownsampled } from '@photomator/core';
import type { EditState, HistoryState, Preset } from '@photomator/core';

const STORAGE_KEY = 'photomator-demo-edits-v1';

const initialHistory = (id: string): HistoryState => ({
  past: id === 'photo-1' ? [{ ...DEFAULT_EDIT }] : [],
  present: { ...(id === 'photo-1' ? INITIAL_EDIT : DEFAULT_EDIT) },
  future: [],
});

function loadEdits(): Record<string, HistoryState> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return Object.fromEntries(
      Object.entries(saved).filter(([, value]) => value && typeof value === 'object' && 'present' in value)
        .map(([id, value]) => {
          const history = value as HistoryState;
          return [id, { past: [], present: { ...DEFAULT_EDIT, ...history.present }, future: [] }];
        }),
    );
  } catch {
    return {};
  }
}

export function useEditor(photoId: string) {
  const [histories, setHistories] = useState<Record<string, HistoryState>>(loadEdits);
  const lastChange = useRef({ key: '', photoId: '', time: 0 });
  const enhanceSnapshots = useRef<Record<string, EditState>>({});
  const history = useMemo(() => histories[photoId] || initialHistory(photoId), [histories, photoId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const compact = Object.fromEntries(Object.entries(histories).filter(([id]) => !id.startsWith('import-')).map(([id, item]) => [id, { present: item.present }]));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
      } catch { /* Editing stays available if browser storage is full. */ }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [histories]);

  const change = useCallback((patch: Partial<EditState>, mergeKey = '') => {
    const now = Date.now();
    const merge = Boolean(mergeKey && lastChange.current.key === mergeKey && lastChange.current.photoId === photoId && now - lastChange.current.time < 700);
    lastChange.current = { key: mergeKey, photoId, time: now };
    setHistories((all) => {
      const current = all[photoId] || initialHistory(photoId);
      return {
        ...all,
        [photoId]: {
          past: merge ? current.past : [...current.past.slice(-49), current.present],
          present: { ...current.present, preset: 'Custom', ...patch },
          future: [],
        },
      };
    });
  }, [photoId]);

  const undo = useCallback(() => {
    lastChange.current.key = '';
    setHistories((all) => {
      const current = all[photoId] || initialHistory(photoId);
      const previous = current.past[current.past.length - 1];
      if (!current.past.length || !previous) return all;
      return { ...all, [photoId]: { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] } };
    });
  }, [photoId]);

  const redo = useCallback(() => {
    lastChange.current.key = '';
    setHistories((all) => {
      const current = all[photoId] || initialHistory(photoId);
      const next = current.future[0];
      if (!current.future.length || !next) return all;
      return { ...all, [photoId]: { past: [...current.past, current.present], present: next, future: current.future.slice(1) } };
    });
  }, [photoId]);

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

  return { edit: history.present, histories, change, undo, redo, reset, autoEnhance, applyPreset, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}