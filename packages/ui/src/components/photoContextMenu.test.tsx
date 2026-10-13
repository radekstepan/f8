import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo } from '@f8/core';
import { Filmstrip, PhotoBrowser } from './PhotoStrips.js';

// Photo right-click menus, rendered on the server (no jsdom): effects never
// run, so the open markup is pinned through the initialContextMenu seam and
// interaction (right-click, dismiss) is left to manual verification.

function makePhoto(id: string, favorite = false): Photo {
  return {
    id,
    name: `${id}.ARW`,
    title: `Photo ${id}`,
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
    favorite,
    rating: 0,
  };
}

const noop = () => {};
const photos = [makePhoto('p1'), makePhoto('p2', true)];

describe('photo context menu', () => {
  it('is closed by default in the library grid', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={photos} title="All Photos" search="" onSelect={noop} onFavorite={noop} onImport={noop} onSceneEnhance={noop} />,
    );
    expect(html).not.toContain('data-testid="photo-context-menu"');
  });

  it('offers ML scene enhance plus favorite and remove in the library grid', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="All Photos"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onRemove={noop}
        onImport={noop}
        onSceneEnhance={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).toContain('data-testid="photo-context-menu"');
    expect(html).toContain('Scene Enhance');
    expect(html).toContain('ml-badge');
    expect(html).toContain('>ML<');
    expect(html).toContain('Add Favorite');
    expect(html).toContain('Remove from Library…');
    expect(html).toContain('Actions for p1.ARW');
  });

  it('labels the favorite entry from the target photo', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="All Photos"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        initialContextMenu={{ photoId: 'p2', x: 10, y: 10 }}
      />,
    );
    expect(html).toContain('Remove Favorite');
    expect(html).not.toContain('Remove from Library…');
  });

  it('renders nothing for an unknown menu target', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="All Photos"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        initialContextMenu={{ photoId: 'missing', x: 10, y: 10 }}
      />,
    );
    expect(html).not.toContain('data-testid="photo-context-menu"');
  });

  it('omits ML entries in the filmstrip without a remove entry', () => {
    const html = renderToStaticMarkup(
      <Filmstrip
        photos={photos}
        selectedId="p1"
        collectionName="All Photos"
        onSelect={noop}
        onGrid={noop}
        onSort={noop}
        reversed={false}
        showPresets={false}
        onShowPresets={noop}
        onFavorite={noop}
        initialContextMenu={{ photoId: 'p1', x: 50, y: 60 }}
      />,
    );
    expect(html).toContain('data-testid="photo-context-menu"');
    expect(html).not.toContain('Scene Enhance');
    expect(html).not.toContain('Enhance Faces');
    expect(html).not.toContain('Export 2x');
    expect(html).toContain('Add Favorite');
    expect(html).not.toContain('Remove from Library…');
  });

  it('offers remove in the filmstrip when onRemove is provided', () => {
    const html = renderToStaticMarkup(
      <Filmstrip
        photos={photos}
        selectedId="p1"
        collectionName="All Photos"
        onSelect={noop}
        onGrid={noop}
        onSort={noop}
        reversed={false}
        showPresets={false}
        onShowPresets={noop}
        onFavorite={noop}
        onRemove={noop}
        initialContextMenu={{ photoId: 'p1', x: 50, y: 60 }}
      />,
    );
    expect(html).toContain('data-testid="photo-context-menu"');
    expect(html).toContain('Add Favorite');
    expect(html).toContain('Remove from Library…');
    expect(html).toContain('Actions for p1.ARW');
  });

  it('offers ML face enhance when the handler is provided', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="All Photos"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        onFaceEnhance={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).toContain('Enhance Faces');
    expect(html).toContain('Faces are detected by a machine-learning model');
  });

  it('omits face enhance without the handler', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="All Photos"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).not.toContain('Enhance Faces');
  });

  it('offers ML 2x export in the library grid when the handler is provided', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="All Photos"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        onExport2x={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).toContain('Export 2x');
    expect(html).toContain('Doubled by a machine-learning model on the photo server');
  });

  it('never offers 2x export in the filmstrip', () => {
    // Regression: the filmstrip's Export 2x parked a pending request that
    // only fired on the next unrelated render (e.g. switching tools), so the
    // entry was removed — 2x lives in the export dialog + library menu.
    const html = renderToStaticMarkup(
      <Filmstrip
        photos={photos}
        selectedId="p1"
        collectionName="All Photos"
        onSelect={noop}
        onGrid={noop}
        onSort={noop}
        reversed={false}
        showPresets={false}
        onShowPresets={noop}
        onFavorite={noop}
        onRemove={noop}
        initialContextMenu={{ photoId: 'p1', x: 50, y: 60 }}
      />,
    );
    expect(html).toContain('data-testid="photo-context-menu"');
    expect(html).not.toContain('Export 2x');
    expect(html).not.toContain('>ML<');
    expect(html).toContain('Add Favorite');
    expect(html).toContain('Remove from Library…');
  });

  it('omits 2x export without the handler', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={photos}
        title="All Photos"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onImport={noop}
        onSceneEnhance={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).not.toContain('Export 2x');
  });
});
