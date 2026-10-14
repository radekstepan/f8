import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Album, Photo } from '@f8/core';
import { PhotoBrowser } from './PhotoStrips.js';
import { Sidebar } from './Sidebar.js';

// Album-thumbnail menu items, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring, not click behavior. The
// menus open via the initial-open test seams.

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

describe('album thumbnail', () => {
  it('renders the sidebar menu trigger when only thumbnail handlers are provided', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum()]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onGenerateAlbumThumbnail={noop} onRemoveAlbumThumbnail={noop} />,
    );
    expect(html).toContain('Album actions for Road Trip');
    expect(html).toContain('album-menu-trigger');
  });

  it('opens the sidebar menu with generate above remove above delete', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum({ cover: 'http://localhost/cover.jpg' })]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onRemoveAlbum={noop} onGenerateAlbumThumbnail={noop} onRemoveAlbumThumbnail={noop} initialOpenMenu="a1" />,
    );
    expect(html).toContain('Generate thumbnail');
    expect(html).toContain('Remove thumbnail');
    expect(html).toContain('Delete album…');
    expect(html.indexOf('Generate thumbnail')).toBeLessThan(html.indexOf('Remove thumbnail'));
    expect(html.indexOf('Remove thumbnail')).toBeLessThan(html.indexOf('Delete album…'));
    expect(html).toContain('menu-separator');
  });

  it('hides the sidebar remove item while the album has no cover', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum()]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onRemoveAlbum={noop} onGenerateAlbumThumbnail={noop} onRemoveAlbumThumbnail={noop} initialOpenMenu="a1" />,
    );
    expect(html).toContain('Generate thumbnail');
    expect(html).not.toContain('Remove thumbnail');
  });

  it('disables sidebar generate for an empty album', () => {
    const empty = renderToStaticMarkup(
      <Sidebar photos={[]} albums={[makeAlbum()]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onGenerateAlbumThumbnail={noop} initialOpenMenu="a1" />,
    );
    expect(empty).toContain('Generate thumbnail');
    expect(empty).toContain('disabled');
    const filled = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum()]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onGenerateAlbumThumbnail={noop} initialOpenMenu="a1" />,
    );
    expect(filled).not.toContain('disabled');
  });

  it('renders the cover image in the sidebar row once set', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum({ cover: 'http://localhost/cover.jpg' })]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onGenerateAlbumThumbnail={noop} />,
    );
    expect(html).toContain('src="http://localhost/cover.jpg"');
  });

  it('renders the grid album menu with only the thumbnail handler', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum()} onSelect={noop} onFavorite={noop} onImport={noop} onGenerateAlbumThumbnail={noop} />,
    );
    expect(html).toContain('Album actions for Road Trip');
    expect(html).toContain('browser-album-menu');
  });

  it('opens the grid menu with the thumbnail group above delete', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum({ cover: 'http://localhost/cover.jpg' })} onSelect={noop} onFavorite={noop} onImport={noop} onRemoveAlbum={noop} onGenerateAlbumThumbnail={noop} onRemoveAlbumThumbnail={noop} initialAlbumMenu />,
    );
    expect(html).toContain('Generate thumbnail');
    expect(html).toContain('Remove thumbnail');
    expect(html).toContain('Delete album…');
    expect(html.indexOf('Generate thumbnail')).toBeLessThan(html.indexOf('Delete album…'));
  });

  it('never disables grid generate: an empty grid may just be filtered', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[]} title="Road Trip" search="nope" album={makeAlbum()} onSelect={noop} onFavorite={noop} onImport={noop} onGenerateAlbumThumbnail={noop} initialAlbumMenu />,
    );
    expect(html).toContain('Generate thumbnail');
    expect(html).not.toContain('disabled');
  });

  it('hides the grid menu for built-in collections even with thumbnail handlers', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="All Photos" search="" album={{ id: 'all', name: 'All Photos', cover: '' }} onSelect={noop} onFavorite={noop} onImport={noop} onGenerateAlbumThumbnail={noop} onRemoveAlbumThumbnail={noop} />,
    );
    expect(html).not.toContain('browser-album-menu');
  });
});
