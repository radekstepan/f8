import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT, pushEnhanceAction, serializeTasteProfile } from '@f8/core';
import type { ActionStack, EditState, TasteProfile, TasteSeed } from '@f8/core';
import { TASTE_PROFILE_KEY, useTasteProfile, type TasteStorage } from './useTasteProfile.js';

// The taste hook learns on the fly (no train step): the app records each
// settled recipe from its debounced persist, and the first load backfills
// from the library seed. Rendered on the server (no jsdom): effects never
// run, so the backfill wiring is pinned from the hook source (the
// resetDehighlights.test.ts precedent), while load/record/forget run
// behaviorally through a probe component — record calls are render-phase
// updates (guarded, so React re-renders once before committing).

const here = dirname(fileURLToPath(import.meta.url));
const hookSource = () => readFileSync(resolve(here, 'useTasteProfile.ts'), 'utf8');
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');

const AT = '2026-10-15T10:00:00.000Z';

function memoryStorage(seed?: Record<string, string>): TasteStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...(seed ?? {}) };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
  };
}

const edit = (patch: Partial<EditState>): EditState => ({ ...DEFAULT_EDIT, ...patch });

function storedProfile(edits: Array<Partial<EditState>>): TasteProfile {
  const samples: TasteProfile['samples'] = {};
  edits.forEach((patch, index) => {
    samples[`p${index}`] = { values: patch as TasteProfile['samples'][string]['values'] };
  });
  return { version: 1, samples, updatedAt: AT };
}

type TasteCall =
  | { kind: 'record'; photoId: string; present: EditState; actions: ActionStack }
  | { kind: 'forget'; photoId: string };

/** Probe: runs the hook, applies scripted calls as render-phase updates, and prints the summary. */
function Probe({ seed, storage, calls }: { seed: TasteSeed | null; storage: TasteStorage | null; calls?: TasteCall[] }) {
  const taste = useTasteProfile(seed, storage);
  const done = useRef(false);
  if (!done.current && calls) {
    done.current = true;
    for (const call of calls) {
      if (call.kind === 'record') taste.record(call.photoId, call.present, call.actions);
      else taste.forget(call.photoId);
    }
  }
  return <div data-testid="taste-summary" data-ready={taste.ready} data-photos={taste.summary.photos} data-keys={Object.keys(taste.summary.keys).join(',')} />;
}

describe('useTasteProfile', () => {
  it('starts empty with no storage and no seed', () => {
    const html = renderToStaticMarkup(<Probe seed={null} storage={null} />);
    expect(html).toContain('data-ready="false"');
    expect(html).toContain('data-photos="0"');
  });

  it('loads a stored profile and reports its summary', () => {
    const storage = memoryStorage({
      [TASTE_PROFILE_KEY]: serializeTasteProfile(storedProfile([{ contrast: 20 }, { contrast: 20 }, { contrast: 20 }])),
    });
    const html = renderToStaticMarkup(<Probe seed={null} storage={storage} />);
    expect(html).toContain('data-ready="true"');
    expect(html).toContain('data-photos="3"');
    expect(html).toContain('data-keys="contrast"');
  });

  it('ignores a corrupt stored profile', () => {
    const storage = memoryStorage({ [TASTE_PROFILE_KEY]: 'not json' });
    const html = renderToStaticMarkup(<Probe seed={null} storage={storage} />);
    expect(html).toContain('data-ready="false"');
    expect(html).toContain('data-photos="0"');
  });

  it('record() writes the sample through to storage', () => {
    const storage = memoryStorage();
    const html = renderToStaticMarkup(
      <Probe seed={null} storage={storage} calls={[
        { kind: 'record', photoId: 'p1', present: edit({ contrast: 20 }), actions: [] },
        { kind: 'record', photoId: 'p2', present: edit({ contrast: 20 }), actions: [] },
        { kind: 'record', photoId: 'p3', present: edit({ contrast: 20 }), actions: [] },
      ]} />,
    );
    expect(html).toContain('data-ready="true"');
    expect(html).toContain('data-photos="3"');
    const stored = JSON.parse(storage.data[TASTE_PROFILE_KEY] ?? '{}') as TasteProfile;
    expect(Object.keys(stored.samples).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('record() skips pure auto output without touching storage', () => {
    const storage = memoryStorage();
    const pure = pushEnhanceAction([], 'classic', edit({}), AT);
    const html = renderToStaticMarkup(
      <Probe seed={null} storage={storage} calls={[
        { kind: 'record', photoId: 'p1', present: edit({ exposure: 0.22, clarity: 12 }), actions: pure },
      ]} />,
    );
    expect(html).toContain('data-photos="0"');
    expect(storage.data[TASTE_PROFILE_KEY]).toBeUndefined();
  });

  it('record() of a default recipe drops the photo’s sample', () => {
    const storage = memoryStorage({
      [TASTE_PROFILE_KEY]: serializeTasteProfile(storedProfile([{ contrast: 20 }])),
    });
    const html = renderToStaticMarkup(
      <Probe seed={null} storage={storage} calls={[{ kind: 'record', photoId: 'p0', present: edit({}), actions: [] }]} />,
    );
    expect(html).toContain('data-photos="0"');
  });

  it('forget() removes a photo without touching the rest', () => {
    const storage = memoryStorage({
      [TASTE_PROFILE_KEY]: serializeTasteProfile(storedProfile([{ contrast: 20 }, { contrast: 30 }])),
    });
    const html = renderToStaticMarkup(
      <Probe seed={null} storage={storage} calls={[{ kind: 'forget', photoId: 'p0' }]} />,
    );
    expect(html).toContain('data-photos="1"');
    const stored = JSON.parse(storage.data[TASTE_PROFILE_KEY] ?? '{}') as TasteProfile;
    expect(Object.keys(stored.samples)).toEqual(['p1']);
  });

  it('backfills once from the library seed when nothing is stored', () => {
    // Effects never run in static markup, so the backfill path is pinned
    // from the hook source: seed-driven, once-only, stored-first.
    const source = hookSource();
    expect(source).toContain('tasteProfileFromSeed(seed,');
    expect(source).toContain('backfilled.current');
    expect(source).toContain('Object.keys(current.samples).length > 0');
  });

  it('the app records every settled persist and forgets removed photos', () => {
    const source = appSource();
    expect(source).toContain('useTasteProfile(');
    // The persist wrapper saves to the server AND records the taste sample.
    expect(source).toContain('taste.record(photoId, present, actions)');
    expect(source).toContain('onPersist: persistEdit');
    expect(source).toContain('taste.forget(');
  });
});
