import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';
import { PhotoCanvas } from './PhotoCanvas.js';
import { PhotoBrowser } from './PhotoStrips.js';

// Remove-from-library surfaces, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring, not click behavior.

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    name: 'DSC06308.ARW',
    title: 'Alpine morning',
    src: 'http://localhost/photo.jpg',
    thumbnail: 'http://localhost/thumb.jpg',
    albumId: 'a1',
    location: 'Dolomites',
    date: '2024-01-01',
    width: 3000,
    height: 2000,
    camera: 'Test camera',
    lens: 'Test lens',
    iso: 100,
    aperture: 'f/8',
    shutter: '1/250',
    focalLength: '35mm',
    raw: false,
    favorite: false,
    rating: 0,
    ...overrides,
  };
}

const noop = () => {};

// PhotoCanvas uses useLayoutEffect for canvas wiring; React warns when that
// renders on the server. These tests only assert markup, so that one warning
// is filtered while any other console.error still fails loudly.
const originalError = console.error;
beforeEach(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect')) return;
    originalError(...args);
  };
});
afterEach(() => {
  console.error = originalError;
});

describe('remove from library', () => {
  it('renders one bottom-right-anchored remove button per browser photo', () => {
    const photos = [makePhoto({ id: 'p1', name: 'one.jpg' }), makePhoto({ id: 'p2', name: 'two.jpg' })];
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={photos} title="All Photos" search="" onSelect={noop} onFavorite={noop} onRemove={noop} onImport={noop} />,
    );
    expect(html).toContain('Remove one.jpg from library');
    expect(html).toContain('Remove two.jpg from library');
    expect(html.match(/browser-remove/g)).toHaveLength(2);
  });

  it('renders no browser remove button when onRemove is omitted', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="All Photos" search="" onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).not.toContain('browser-remove');
  });

  it('pins the browser remove button to the bottom-right corner', () => {
    // Placement lives in CSS, so pin the rule itself: right + bottom, and no
    // left/top fallback that would win over them.
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
    const rule = readFileSync(cssPath, 'utf8').match(/\.browser-remove\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position\s*:\s*absolute/);
    expect(rule).toMatch(/right\s*:/);
    expect(rule).toMatch(/bottom\s*:/);
    expect(rule).not.toMatch(/left\s*:/);
    expect(rule).not.toMatch(/top\s*:/);
  });

  it('anchors the browser remove button to the image frame, above the caption', () => {
    // The frame wraps the image only (the caption sits below it), so the
    // bottom-anchored button lands on the photo's bottom-right corner —
    // mirroring the top-right favorite — instead of under the caption text.
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="All Photos" search="" onSelect={noop} onFavorite={noop} onRemove={noop} onImport={noop} />,
    );
    const frame = html.indexOf('browser-photo-frame');
    const remove = html.indexOf('browser-remove');
    const caption = html.indexOf('browser-photo-caption');
    expect(frame).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(frame);
    expect(caption).toBeGreaterThan(remove);
  });

  it('renders the browser caption outside the open button', () => {
    // Overlay buttons cannot nest inside the open <button>, so the caption
    // moved out with them; the image still opens the editor and the button
    // keeps its accessible name.
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="All Photos" search="" onSelect={noop} onFavorite={noop} onRemove={noop} onImport={noop} />,
    );
    expect(html).toContain('aria-label="Edit Alpine morning"');
    const open = html.indexOf('browser-photo-open');
    const close = html.indexOf('</button>', open);
    const caption = html.indexOf('browser-photo-caption');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    expect(caption).toBeGreaterThan(close);
  });

  it('positions the image frame as the overlay anchor', () => {
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
    const rule = readFileSync(cssPath, 'utf8').match(/\.browser-photo-frame\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position\s*:\s*relative/);
  });

  it('renders no remove action in the photo-view heading (it lives in the toolbar)', () => {
    // The heading trash moved to the toolbar's actions row, directly left
    // of the info button (pinned in toolbarRemoveOrder.test.tsx); the
    // heading keeps only rating + favorite.
    const html = renderToStaticMarkup(
      <PhotoCanvas
        photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} tool="adjust" zoom={1}
        compare={false} showOriginal={false} brushSize={40} brushStrength={70}
        onZoom={noop} onCompare={noop} onFavorite={noop} onRating={noop}
        onInfo={noop} onChange={noop} onHistogram={noop}
      />,
    );
    expect(html).not.toContain('photo-remove');
    expect(html).not.toContain('Remove from library (Del)');
    expect(html).toContain('Add to favorites (F)');
  });

  it('reuses the confirm dialog naming the photo and promising the file stays on disk', () => {
    const html = renderToStaticMarkup(
      <EditorDialogs dialog="remove" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} />,
    );
    expect(html).toContain('Remove from Library');
    expect(html).toContain('DSC06308.ARW');
    expect(html).toContain('never deleted');
    expect(html).toContain('danger-button');
    expect(html).toContain('>Remove</button>');
  });
});
