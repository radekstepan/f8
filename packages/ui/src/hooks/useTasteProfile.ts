import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forgetTasteSample, isPureAutoStack, parseTasteProfileJson, recordTasteSample, sampleTasteFromEdit, serializeTasteProfile, summarizeTaste, tasteEnhancePatch, tasteProfileFromSeed } from '@f8/core';
import type { ActionStack, EditState, TasteProfile, TasteSeed, TasteSummary } from '@f8/core';

/** localStorage key for the learned taste profile (browser-local, never synced). */
export const TASTE_PROFILE_KEY = 'f8.taste-profile-v1';

/** Minimal storage surface: the real localStorage plus in-memory test doubles. */
export interface TasteStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function browserTasteStorage(): TasteStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function writeTasteProfile(store: TasteStorage | null, profile: TasteProfile): void {
  if (!store) return;
  try {
    store.setItem(TASTE_PROFILE_KEY, serializeTasteProfile(profile));
  } catch {
    /* Private mode / quota — the profile stays session-only. */
  }
}

/**
 * The learned taste profile: per-adjustment medians over the user's own
 * edited photos, written through to localStorage on every recording.
 *
 * Learning is on the fly with no train step: the app calls `record` from
 * its debounced edit persist (settled recipes, not keystrokes), and the
 * first load backfills from the library seed so existing edits count
 * without re-editing them. Pure auto output never records (see
 * isPureAutoStack), so the profile only ever holds human-shaped recipes.
 * `patch` is the ML Auto Enhance patch, null until the profile has
 * evidence (see tasteEnhancePatch).
 */
export function useTasteProfile(seed: TasteSeed | null | undefined, storage?: TasteStorage | null) {
  const store = storage === undefined ? browserTasteStorage() : storage;
  const [profile, setProfile] = useState<TasteProfile>(() => parseTasteProfileJson(store?.getItem(TASTE_PROFILE_KEY) ?? null));
  const backfilled = useRef(false);

  useEffect(() => {
    if (!seed || backfilled.current) return;
    backfilled.current = true;
    setProfile((current) => {
      // A stored profile wins over the seed: the seed is the bootstrap
      // for first-run libraries, not a recurring overwrite.
      if (Object.keys(current.samples).length > 0) return current;
      const next = tasteProfileFromSeed(seed, new Date().toISOString());
      writeTasteProfile(store, next);
      return next;
    });
  }, [seed, store]);

  const record = useCallback((photoId: string, present: EditState, actions: ActionStack) => {
    if (isPureAutoStack(actions)) return;
    setProfile((current) => {
      const next = recordTasteSample(current, photoId, sampleTasteFromEdit(present), new Date().toISOString());
      // recordTasteSample returns the input untouched when the sample is
      // unchanged — skip the write-through (and the re-render) with it.
      if (next === current) return current;
      writeTasteProfile(store, next);
      return next;
    });
  }, [store]);

  const forget = useCallback((photoId: string) => {
    setProfile((current) => {
      const next = forgetTasteSample(current, photoId, new Date().toISOString());
      if (next === current) return current;
      writeTasteProfile(store, next);
      return next;
    });
  }, [store]);

  const summary: TasteSummary = useMemo(() => summarizeTaste(profile), [profile]);
  const patch = useMemo(() => tasteEnhancePatch(profile), [profile]);
  return { profile, summary, patch, ready: patch !== null, record, forget };
}
