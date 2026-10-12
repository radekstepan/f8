import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Album, Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';
import { PhotoBrowser } from './PhotoStrips.js';
import { Sidebar } from './Sidebar.js';

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
  it('renders the sidebar menu trigger for cull alone', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum()]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onCullAlbum={noop} />,
    );
    expect(html).toContain('Album actions for Road Trip');
    expect(html).toContain('album-menu-trigger');
  });

  it('renders the grid album menu for cull alone, never for built-ins', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum()} onSelect={noop} onFavorite={noop} onCullAlbum={noop} onImport={noop} />,
    );
    expect(html).toContain('Album actions for Road Trip');
    expect(html).toContain('browser-album-menu');
    const builtIn = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="All Photos" search="" album={{ id: 'all', name: 'All Photos', cover: '' }} onSelect={noop} onFavorite={noop} onCullAlbum={noop} onImport={noop} />,
    );
    expect(builtIn).not.toContain('browser-album-menu');
  });

  it('renders the cull filter chips with the active state', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum()} editedFilter="all" favoriteFilter="all" onEditedFilter={noop} onFavoriteFilter={noop} onClearFilters={noop} cullFilter="blurry" onCullFilter={noop} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).toContain('Cull status');
    expect(html).toContain('Show only photos flagged blurry by ML cull assist');
    expect(html).toContain('Show only photos flagged as keepers by ML cull assist');
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
    const keeper = makePhoto({ id: 'p-keeper', labels: [{ label: 'keeper', score: 0.9, source: 'ml' }] });
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[flagged, keeper, makePhoto({ id: 'p-clean' })]} title="Road Trip" search="" album={makeAlbum()} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).toContain('thumb-cull-badges');
    expect(html).toContain('Blurry · ML');
    expect(html).toContain('Duplicate · ML');
    expect(html).toContain('Keeper · ML');
    expect(html).toContain('Flagged blurry by ML cull assist');
    expect(html.match(/thumb-cull-badges/g)).toHaveLength(2);
  });

  it('suggests cull flags in the label add field', () => {
    const html = renderToStaticMarkup(
      <EditorDialogs dialog="info" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} onAddLabel={noop} onRemoveLabel={noop} onSearchLabel={noop} />,
    );
    expect(html).toContain('value="blurry"');
    expect(html).toContain('value="duplicate"');
    expect(html).toContain('value="keeper"');
  });

  it('styles the cull badge stack', () => {
    expect(cssRule('.thumb-cull-badges')).toMatch(/position\s*:\s*absolute/);
    expect(cssRule('.thumb-cull-badges')).toMatch(/flex-direction\s*:\s*column/);
    expect(cssRule('.thumb-cull.is-blurry')).toMatch(/background\s*:/);
    expect(cssRule('.thumb-cull.is-duplicate')).toMatch(/background\s*:/);
    expect(cssRule('.thumb-cull.is-keeper')).toMatch(/background\s*:/);
  });
});
