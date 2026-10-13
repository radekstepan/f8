import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Album, Photo } from '@f8/core';
import { PhotoBrowser } from './PhotoStrips.js';
import { Sidebar } from './Sidebar.js';

// Grid multi-select + move-to-album surfaces, rendered on the server (no
// jsdom): effects never run, so this pins the markup + prop wiring (selection
// badges, the move section, the drop highlight), not pointer behavior. The
// selection rules themselves are unit-tested in @f8/core photoSelection.

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
const photos = [makePhoto({ id: 'p1' }), makePhoto({ id: 'p2', name: 'DSC06309.ARW' })];
const albums = [makeAlbum({ id: 'a1', name: 'Road Trip' }), makeAlbum({ id: 'a2', name: 'Studio' })];

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('grid multi-select', () => {
  it('marks selected cards and badges only the selected ones', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={photos} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} onSceneEnhance={noop} selectedIds={['p2']} onSelectionChange={noop} />,
    );
    expect(html).toContain('is-selected');
    expect(html).toContain('data-photo-id="p2" aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('browser-selected-check');
    // One badge for the one selected card.
    expect(html.split('browser-selected-check').length - 1).toBe(1);
  });

  it('renders no selection markup without a selection handler', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={photos} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} onSceneEnhance={noop} />,
    );
    expect(html).not.toContain('is-selected');
    expect(html).not.toContain('aria-selected');
    expect(html).not.toContain('browser-selected-check');
  });

  it('renders the rubber-band marquee from the test seam', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={photos} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} onSceneEnhance={noop} selectedIds={[]} onSelectionChange={noop} initialMarquee={{ x: 10, y: 20, width: 100, height: 60 }} />,
    );
    expect(html).toContain('selection-marquee');
    expect(html).toContain('left:10px');
  });

  it('makes cards draggable when moving is supported', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={photos} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} onSceneEnhance={noop} albums={albums} onMoveToAlbum={noop} />,
    );
    expect(html).toContain('draggable="true"');
  });

  it('omits draggability without a move handler', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={photos} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} onSceneEnhance={noop} />,
    );
    expect(html).not.toContain('draggable');
  });
});

describe('move to album', () => {
  it('lists other albums with a count header in the context menu', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="Road Trip"
        search=""
        album={albums[0]}
        albums={albums}
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        selectedIds={['p1', 'p2']}
        onSelectionChange={noop}
        onMoveToAlbum={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).toContain('data-testid="photo-context-menu"');
    expect(html).toContain('Move 2 photos to…');
    expect(html).toContain('Move to album');
    // The open album is never a destination (a no-op move); scope to the
    // menu markup since the grid heading carries the same title.
    const menu = html.slice(html.indexOf('data-testid="photo-context-menu"'));
    expect(menu).not.toContain('>Road Trip<');
    expect(menu).toContain('>Studio<');
  });

  it('targets the right-clicked photo alone outside the selection', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="Road Trip"
        search=""
        albums={albums}
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        selectedIds={['p2']}
        onSelectionChange={noop}
        onMoveToAlbum={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).toContain('Move 1 photo to…');
  });

  it('opens the menu for moves even without ML handlers', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="Road Trip"
        search=""
        albums={albums}
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onMoveToAlbum={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).toContain('data-testid="photo-context-menu"');
    expect(html).toContain('Move 1 photo to…');
  });

  it('omits the move section without a move handler', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="Road Trip"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).toContain('data-testid="photo-context-menu"');
    expect(html).not.toContain('Move to album');
  });

  it('highlights the sidebar drop-target row', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={photos} albums={albums} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onMoveToAlbum={noop} initialDropTarget="a2" />,
    );
    expect(html).toContain('album-row is-drop-target');
    expect(html.split('is-drop-target').length - 1).toBe(1);
  });

  it('renders no drop highlight by default', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={photos} albums={albums} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onMoveToAlbum={noop} />,
    );
    expect(html).not.toContain('is-drop-target');
  });
});

describe('multi-select styles', () => {
  it('outlines selected cards and floats a check badge', () => {
    expect(cssRule('.browser-photo.is-selected .browser-photo-image')).toContain('box-shadow');
    expect(cssRule('.browser-selected-check')).toContain('position: absolute');
  });

  it('floats the marquee above the grid without stealing the pointer', () => {
    const rule = cssRule('.selection-marquee');
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('pointer-events: none');
  });

  it('scrolls long album lists inside the menu', () => {
    const rule = cssRule('.move-album-list');
    expect(rule).toContain('max-height');
    expect(rule).toContain('overflow-y: auto');
  });

  it('highlights the sidebar drop-target row', () => {
    expect(cssRule('.album-row.is-drop-target .sidebar-item')).toContain('box-shadow');
  });
});
