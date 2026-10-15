import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Fast album arrowing, pinned from the App + PhotoCanvas sources (the
// focusMode.test.tsx precedent): the wiring lives in effects, so there is no
// renderable output to assert on. Three changes share one goal — every arrow
// step lands faster, with a warm cache and a cold one:
//
// 1. Neighbor preload (cold cache): once navigation settles, the photos
//    around the selection fetch + decode ahead, so the next step finds its
//    bytes (and usually its decoded pixels) ready.
// 2. Preview render cache for every photo (revisit): the cached last render
//    used to load only for repaired photos, and the idle save never ran for
//    quickly-visited ones — now every photo reads it, and the previous
//    photo's pixels flush into it on the way out.
// 3. On-demand Compare "Original" layer (warm cache): the pipeline no longer
//    paints the hidden original layer on every navigation; it paints when
//    Compare or Show Original actually shows it.

const here = dirname(fileURLToPath(import.meta.url));
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');
const canvasSource = () => readFileSync(resolve(here, './PhotoCanvas.tsx'), 'utf8');

describe('fast album arrowing', () => {
  it('preloads the photos around the selection once navigation settles', () => {
    const source = appSource();
    expect(source).toContain('preloadNeighborSrcs(filteredPhotos, index)');
    expect(source).toContain('window.setTimeout(() => preloadImages(srcs), PHOTO_PRELOAD_DELAY_MS)');
    // The delay resets on every step: rapid arrowing never steals bandwidth
    // from the photo being opened.
    expect(source).toContain('return () => window.clearTimeout(timer);');
    expect(source).toContain('[filteredPhotos, selectedId]');
  });

  it('reads the cached last render for every photo, not just repaired ones', () => {
    const source = canvasSource();
    expect(source).toContain('loadPreviewRender(photo.id, runKey)');
    // The old repairs-only gate is gone: the exact-key match is the guard.
    expect(source).not.toContain('repairsAtStart.length > 0 && canvasRef.current');
  });

  it('flushes the previous photo into the preview cache on the way out', () => {
    const source = canvasSource();
    // Stashed at paint time, flushed by the photo-change reset effect while
    // the canvas still holds the previous photo's pixels.
    expect(source).toContain('paintedPhotoId.current = photo.id;');
    expect(source).toContain('flushPreviewCache(); setLoading(true);');
    expect(source).toContain('void savePreviewRender(id, key, blob);');
  });

  it('paints the hidden Compare layer on demand instead of every navigation', () => {
    const source = canvasSource();
    // No unconditional pipeline paint remains.
    expect(source).not.toMatch(/^\s*paintOriginal\(\);/m);
    expect(source).not.toContain('const paintOriginal =');
    // The demand effect owns it: hidden layers never paint, geometry edits
    // repaint while visible, and the key skips non-geometry ticks.
    expect(source).toContain('if (!compare && !showOriginal) return;');
    expect(source).toContain('originalSource.current = { image, trueOriginal };');
    expect(source).toContain('if (originalPaintedKey.current === key) return;');
    expect(source).toContain('[compare, showOriginal, paintCount, photo.id, photo.src, edit]');
  });
});
