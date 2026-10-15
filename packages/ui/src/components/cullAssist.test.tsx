import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Album, Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';
import { PhotoCanvas } from './PhotoCanvas.js';
import { PhotoBrowser } from './PhotoStrips.js';

// Cull-assist surfaces, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior. The album
// menus start closed in SSR output — the open dropdown is client-only.

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

function makeAlbum(overrides: Partial<Album> = {}): Album {
  return { id: 'a1', name: 'Road Trip', cover: '', ...overrides };
}

const noop = () => {};

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('cull assist', () => {
  // Cull assist needs no menu: every import is assessed on the server, so
  // the album menus carry only Delete (pinned in removeAlbum).
  it('renders the cull filter chips with the active state', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum()} editedFilter="all" favoriteFilter="all" onEditedFilter={noop} onFavoriteFilter={noop} onClearFilters={noop} cullFilter="blurry" onCullFilter={noop} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).toContain('Cull status');
    expect(html).toContain('Show only photos flagged blurry by ML cull assist');
    expect(html).not.toContain('Keepers');
    expect(html).toContain('filter-chip is-active');
    expect(html).toContain('filter-clear');
    const bare = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum()} editedFilter="all" favoriteFilter="all" onEditedFilter={noop} onFavoriteFilter={noop} onClearFilters={noop} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(bare).not.toContain('Cull status');
  });

  it('badges flagged photos on the grid and leaves clean photos bare', () => {
    const flagged = makePhoto({
      id: 'p-flagged',
      labels: [
        { label: 'blurry', score: 0.8, source: 'ml' },
        { label: 'duplicate', score: 0.95, source: 'ml' },
      ],
    });
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[flagged, makePhoto({ id: 'p-clean' })]} title="Road Trip" search="" album={makeAlbum()} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).toContain('thumb-cull-badges');
    expect(html).toContain('Blurry · ML');
    expect(html).toContain('Duplicate · ML');
    expect(html).toContain('Flagged blurry by ML cull assist');
    expect(html.match(/thumb-cull-badges/g)).toHaveLength(1);
  });

  it('never badges a positive state, even for a stale keeper label', () => {
    const stale = makePhoto({ id: 'p-stale', labels: [{ label: 'keeper', score: 0.9, source: 'ml' }] });
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[stale]} title="Road Trip" search="" album={makeAlbum()} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).not.toContain('thumb-cull-badges');
    expect(html).not.toContain('Keeper · ML');
  });

  it('suggests cull flags in the label add field', () => {
    const html = renderToStaticMarkup(
      <EditorDialogs dialog="info" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} onAddLabel={noop} onRemoveLabel={noop} onSearchLabel={noop} />,
    );
    expect(html).toContain('value="blurry"');
    expect(html).toContain('value="duplicate"');
    expect(html).not.toContain('value="keeper"');
  });

  it('styles the cull badge stack', () => {
    expect(cssRule('.thumb-cull-badges')).toMatch(/position\s*:\s*absolute/);
    expect(cssRule('.thumb-cull-badges')).toMatch(/flex-direction\s*:\s*column/);
    expect(cssRule('.thumb-cull.is-blurry')).toMatch(/background\s*:/);
    expect(cssRule('.thumb-cull.is-duplicate')).toMatch(/background\s*:/);
    expect(cssRule('.thumb-cull.is-keeper')).toBe('');
  });

  it('hints at blur in the photo-view heading and leaves clean photos bare', () => {
    const flagged = renderCanvas(makePhoto({ labels: [{ label: 'blurry', score: 0.8, source: 'ml' }] }));
    expect(flagged).toContain('data-testid="photo-blurry-hint"');
    expect(flagged).toContain('Might be blurry · ML');
    expect(flagged).toContain('Flagged blurry by ML cull assist');
    const clean = renderCanvas(makePhoto());
    expect(clean).not.toContain('photo-blurry-hint');
    const other = renderCanvas(makePhoto({ labels: [{ label: 'beach', score: 0.9, source: 'ml' }] }));
    expect(other).not.toContain('photo-blurry-hint');
  });

  it('styles the photo-view hint softer than the severe red grid badge', () => {
    const hint = cssRule('.photo-blurry-hint');
    expect(hint).toMatch(/border\s*:/);
    expect(hint).not.toMatch(/background\s*:/);
    // The severe red fill stays on the grid badge only.
    expect(hint).not.toContain('#7c4534');
    expect(cssRule('.thumb-cull.is-blurry')).toContain('#7c4534');
  });
});

function renderCanvas(photo: Photo): string {
  return renderToStaticMarkup(
    <PhotoCanvas
      photo={photo}
      edit={{ ...DEFAULT_EDIT }}
      tool="adjust"
      zoom={1}
      compare={false}
      showOriginal={false}
      brushSize={45}
      brushStrength={100}
      onZoom={noop}
      onCompare={noop}
      onFavorite={noop}
      onRating={noop}
      onInfo={noop}
      onChange={noop}
      onHistogram={noop}
    />,
  );
}
