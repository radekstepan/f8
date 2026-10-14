import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Album, Photo } from '@f8/core';
import { Sidebar } from './Sidebar.js';

// Star smart albums in the sidebar Library group, rendered on the server
// (no jsdom): effects never run, so this pins the markup + prop wiring,
// not click behavior.

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

const renderSidebar = (photos: Photo[], collection = 'all') =>
  renderToStaticMarkup(
    <Sidebar photos={photos} albums={[makeAlbum()]} collection={collection} search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} />,
  );

describe('star smart albums', () => {
  it('shows one Library row per saved rating, highest first', () => {
    const photos = [makePhoto({ id: 'p1', rating: 3 }), makePhoto({ id: 'p2', rating: 5 }), makePhoto({ id: 'p3', rating: 3 })];
    const html = renderSidebar(photos);
    expect(html).toContain('5 Stars');
    expect(html).toContain('3 Stars');
    expect(html.indexOf('5 Stars')).toBeLessThan(html.indexOf('3 Stars'));
    expect(html).not.toContain('4 Stars');
    expect(html).not.toContain('1 Star');
  });

  it('shows nothing extra when no photo is starred', () => {
    const html = renderSidebar([makePhoto(), makePhoto({ id: 'p2' })]);
    expect(html).toContain('All Photos');
    expect(html).toContain('Favorites');
    expect(html).toContain('Recently Edited');
    expect(html).not.toContain('Stars');
    expect(html).not.toContain('1 Star');
  });

  it('counts only the photos with that rating', () => {
    const photos = [makePhoto({ id: 'p1', rating: 5 }), makePhoto({ id: 'p2', rating: 5 }), makePhoto({ id: 'p3', rating: 0 })];
    const html = renderSidebar(photos);
    // The 5-star row carries its own count (2 of 3 photos).
    expect(html).toMatch(/5 Stars<\/span><span class="item-count">2<\/span>/);
  });

  it('highlights the selected smart album', () => {
    const photos = [makePhoto({ id: 'p1', rating: 5 })];
    const html = renderSidebar(photos, 'rating-5');
    expect(html).toMatch(/sidebar-item is-selected"><svg[^>]*>.*5 Stars/s);
  });

  it('labels a single star without the plural', () => {
    const html = renderSidebar([makePhoto({ rating: 1 })]);
    expect(html).toContain('1 Star');
    expect(html).not.toContain('1 Stars');
  });
});
