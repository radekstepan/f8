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

// Album-deletion surfaces, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior. The menus
// start closed in SSR output — the open dropdown is client-only.

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

describe('remove album', () => {
  it('renders one hover menu trigger per sidebar album row', () => {
    const albums = [makeAlbum({ id: 'a1', name: 'Road Trip' }), makeAlbum({ id: 'a2', name: 'Studio' })];
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={albums} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onRemoveAlbum={noop} />,
    );
    expect(html).toContain('Album actions for Road Trip');
    expect(html).toContain('Album actions for Studio');
    expect(html.match(/album-menu-trigger/g)).toHaveLength(2);
    // The Library section is built-ins only: no menu trigger mentions them.
    expect(html).not.toContain('Album actions for All Photos');
    expect(html).not.toContain('Album actions for Favorites');
    expect(html).not.toContain('Album actions for Recently Edited');
  });

  it('renders no sidebar menu trigger when onRemoveAlbum is omitted', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum()]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} />,
    );
    expect(html).not.toContain('album-menu-trigger');
    expect(html).toContain('Road Trip');
  });

  it('keeps the sidebar trigger hidden until the row is hovered', () => {
    // Visibility lives in CSS, so pin the rule itself: transparent and
    // uninteractable by default, revealed on row hover/focus/menu-open.
    const rule = cssRule('.album-menu-trigger');
    expect(rule).toMatch(/opacity\s*:\s*0/);
    expect(rule).toMatch(/pointer-events\s*:\s*none/);
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.album-row:hover \.album-menu-trigger[^{]*\{[^}]*opacity\s*:\s*1/);
    expect(css).toMatch(/\.album-row\.is-menu-open \.album-menu-trigger[^{]*\{[^}]*pointer-events\s*:\s*auto/);
  });

  it('renders the album menu at the top of the album grid', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum()} onSelect={noop} onFavorite={noop} onRemoveAlbum={noop} onImport={noop} />,
    );
    expect(html).toContain('Album actions for Road Trip');
    expect(html).toContain('browser-album-menu');
  });

  it('hides the grid menu for built-in collections and without a handler', () => {
    const builtIn = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="All Photos" search="" album={{ id: 'all', name: 'All Photos', cover: '' }} onSelect={noop} onFavorite={noop} onRemoveAlbum={noop} onImport={noop} />,
    );
    expect(builtIn).not.toContain('browser-album-menu');
    const noHandler = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum()} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(noHandler).not.toContain('browser-album-menu');
    const noAlbum = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="All Photos" search="" onSelect={noop} onFavorite={noop} onRemoveAlbum={noop} onImport={noop} />,
    );
    expect(noAlbum).not.toContain('browser-album-menu');
  });

  it('confirms with a dialog naming the album and promising the photos stay', () => {
    const html = renderToStaticMarkup(
      <EditorDialogs dialog="remove-album" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} removeAlbum={{ id: 'a1', name: 'Road Trip', count: 12 }} onRemoveAlbum={noop} />,
    );
    expect(html).toContain('Delete Album');
    expect(html).toContain('Road Trip');
    expect(html).toContain('Its 12 photos stay in your library under All Photos.');
    expect(html).toContain('danger-button');
    expect(html).toContain('>Delete album</button>');
    expect(html).toContain('>Keep album</button>');
  });

  it('renders no delete dialog without a target album', () => {
    const html = renderToStaticMarkup(
      <EditorDialogs dialog="remove-album" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} onRemoveAlbum={noop} />,
    );
    expect(html).not.toContain('Delete Album');
    expect(html).toBe('');
  });
});
