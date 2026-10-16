import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo } from '@f8/core';
import { PhotoBrowser } from './PhotoStrips.js';

// Album-page import surfaces, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring, not click behavior.
// The album page already imported via the sidebar button, the empty-state
// button, and the app-shell file drop — but a populated album showed no
// import button of its own, and the empty-library gate (an early return
// outside the shell) swallowed first-run drops. The App.tsx half is pinned
// at the source level per the presetPreviewRefresh.test.tsx precedent.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

const appSource = () => readFileSync(resolve(root, 'apps/web/src/App.tsx'), 'utf8');

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

describe('album import button', () => {
  it('renders an import button in the heading actions when the album has photos', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).toContain('browser-heading-actions');
    expect(html).toMatch(/browser-heading-actions">[\s\S]*?aria-label="Import photos"/);
  });

  it('shows no empty-state import button once photos exist', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).not.toContain('empty-library');
    expect(html).not.toContain('>Import Photos<');
  });

  it('keeps the primary import button on an empty album', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).toContain('empty-library');
    expect(html).toContain('>Import Photos<');
  });
});

describe('album drop hint', () => {
  it('mentions drag-and-drop on a plain empty album', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).toContain('You can also drop photos or a folder anywhere to import them.');
  });

  it('hides the drop hint for search and filtered empties', () => {
    const searched = renderToStaticMarkup(
      <PhotoBrowser photos={[]} title="Road Trip" search="dolomites" onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(searched).not.toContain('drop photos or a folder anywhere');
    const filtered = renderToStaticMarkup(
      <PhotoBrowser photos={[]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} editedFilter="edited" favoriteFilter="all" onEditedFilter={noop} onFavoriteFilter={noop} onClearFilters={noop} />,
    );
    expect(filtered).toContain('Clear filters');
    expect(filtered).not.toContain('drop photos or a folder anywhere');
  });
});

describe('album import: empty-library gate drop wiring', () => {
  it('gives the gate the same file-drop surface as the app shell', () => {
    // The gate is an early return outside the shell, so it needs its own
    // drag handlers and overlay — otherwise a first-run drop bounces off.
    const source = appSource();
    const gate = source.slice(source.indexOf('if (!photo)'), source.indexOf('const showInspector'));
    expect(gate).toContain('onDragEnter');
    expect(gate).toContain('onDragOver');
    expect(gate).toContain('onDrop');
    expect(gate).toContain('void importDrop(event.dataTransfer)');
    expect(gate).toContain('{dragging && <DropOverlay />}');
  });

  it('shares one overlay component between the gate and the shell', () => {
    const source = appSource();
    expect(source).toContain('function DropOverlay()');
    expect(source.match(/\{dragging && <DropOverlay \/>\}/g)?.length).toBe(2);
    expect(source).not.toContain('{dragging && <div className="drop-overlay">');
  });
});
