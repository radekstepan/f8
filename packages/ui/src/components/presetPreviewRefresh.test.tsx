import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT, getPhotoFilter, liveEditsForSession } from '@f8/core';
import type { EditState, HistoryState, Photo } from '@f8/core';
import { PhotoBrowser } from './PhotoStrips.js';

// Preset applied elsewhere must refresh this tab's album thumbnails.
//
// Root cause, in two halves: the library snapshot loads once per page, so
// another tab's saves never reached this tab (no invalidation); and the
// live-edits override covered every seeded photo, so even a refreshed
// persisted recipe could never show through (the live edit always wins
// thumbnailFilterForPhoto's `??`). The fix narrows the override to
// session-diverged photos (liveEditsForSession) and refreshes photos when
// the tab regains visibility or focus (useLibrary refreshPhotos).
//
// The hook effects need window/DOM (the UI suite runs in node, no jsdom)
// and the App wiring lives in apps/web, so both are pinned at the source
// level per the offlineRecovery.test.ts precedent — while the grid
// rendering itself runs behaviorally below.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

const appSource = () => readFileSync(resolve(root, 'apps/web/src/App.tsx'), 'utf8');
const hookSource = () => readFileSync(resolve(here, '../hooks/useLibrary.ts'), 'utf8');

function makePhoto(overrides: Partial<Photo> & { edit?: EditState } = {}): Photo & { edit: EditState } {
  return {
    id: 'e5c39a6d-8893-4ed3-ad12-099ff36ab2b2',
    name: 'DSC06320.ARW',
    title: 'DSC06320',
    src: '/api/photos/e5c39a6d/file',
    thumbnail: '/api/photos/e5c39a6d/thumb?v=2',
    albumId: 'a1',
    location: '',
    date: '2026-09-23T09:33:56.000Z',
    width: 6024,
    height: 4024,
    camera: 'SONY ILCE-6400',
    lens: 'E 55-210mm F4.5-6.3 OSS',
    iso: 6400,
    aperture: 'f/6.3',
    shutter: '1/40 s',
    focalLength: '173 mm',
    raw: true,
    favorite: false,
    rating: 0,
    edit: { ...DEFAULT_EDIT },
    ...overrides,
  };
}

const history = (present: EditState, past: EditState[] = [], future: EditState[] = []): HistoryState => ({ past, present, future });
const noop = () => {};

describe('preset preview refresh: App live-edits wiring', () => {
  it('derives liveEdits from session-diverged histories only', () => {
    // The old inline derivation mapped every history to its present,
    // shadowing photo.edit (and any refresh of it) with the stale seed.
    expect(appSource()).toContain('liveEditsForSession(editor.histories)');
    expect(appSource()).not.toContain('Object.entries(editor.histories).map');
  });

  it('feeds the narrowed live edits to both the grid and the filmstrip', () => {
    expect(appSource()).toContain('edits={liveEdits}');
    expect(appSource()).toMatch(/PhotoBrowser photos=\{filteredPhotos\}[^]*?edits=\{liveEdits\}/);
    expect(appSource()).toMatch(/collectionName=\{collectionName\} edits=\{liveEdits\}/);
  });
});

describe('preset preview refresh: background photo refresh', () => {
  it('refreshes photos when the tab regains visibility or focus', () => {
    // Tab switch (visibility) and side-by-side window click (focus) both
    // re-read the snapshot so another tab's saves show up here.
    expect(hookSource()).toContain('document.addEventListener("visibilitychange", onVisible)');
    expect(hookSource()).toContain('window.addEventListener("focus", onFocus)');
    expect(hookSource()).toContain('document.removeEventListener("visibilitychange", onVisible)');
    expect(hookSource()).toContain('window.removeEventListener("focus", onFocus)');
    expect(hookSource()).toContain('if (!document.hidden) void refreshPhotos();');
  });

  it('merges refreshed photos through the pending-meta-safe upsert', () => {
    // upsertPhotos (not a wholesale setPhotos) keeps in-flight optimistic
    // stars/ratings; failures stay silent so a blip never flips a takeover.
    const source = hookSource();
    const refresh = source.slice(source.indexOf('const refreshPhotos'), source.indexOf('document.addEventListener("visibilitychange"'));
    expect(refresh).toContain('client.getLibrary()');
    expect(refresh).toContain('upsertPhotos(snapshot.photos)');
    expect(refresh).toContain('} catch {');
    expect(refresh).not.toContain('markOfflineIfDown');
    expect(refresh).not.toContain('setStatus');
  });
});

describe('preset preview refresh: grid rendering', () => {
  it('shows the refreshed persisted look when this tab never touched the photo', () => {
    // The reported bug: a preset applied elsewhere (persisted Apple recipe
    // picked up by the background refresh) with pristine local histories —
    // the narrowed override omits the photo, so the cell renders the
    // refreshed recipe instead of the stale seed.
    const apple = { ...DEFAULT_EDIT, exposure: 1.26, preset: 'Apple' };
    const photo = makePhoto({ edit: apple });
    const edits = liveEditsForSession({ [photo.id]: history({ ...DEFAULT_EDIT }) });
    expect(edits).toEqual({});
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[photo]} title="Album" search="" edits={edits} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    const img = html.match(/<img[^>]*>/)?.[0] ?? '(no img)';
    expect(img).toContain(`filter:${getPhotoFilter(apple)}`);
  });

  it('keeps the session override ahead of the persisted recipe while dirty', () => {
    // The narrowed override must still cover the editing tab through the
    // 500 ms save debounce: a dirty present wins over a stale photo.edit.
    const vivid = { ...DEFAULT_EDIT, saturation: 30, preset: 'Vivid' };
    const photo = makePhoto({ edit: { ...DEFAULT_EDIT } });
    const edits = liveEditsForSession({ [photo.id]: history(vivid, [{ ...DEFAULT_EDIT }]) });
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[photo]} title="Album" search="" edits={edits} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    const img = html.match(/<img[^>]*>/)?.[0] ?? '(no img)';
    expect(img).toContain(`filter:${getPhotoFilter(vivid)}`);
  });
});
