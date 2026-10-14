import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Album, Photo } from '@f8/core';
import { Sidebar } from './Sidebar.js';

// Sidebar album order, rendered on the server (no jsdom): pins the row order
// in the markup — covered albums first, each group sorted by name.

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

function renderSidebar(albums: Album[]): string {
  return renderToStaticMarkup(
    <Sidebar photos={[makePhoto()]} albums={albums} collection="all" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} />,
  );
}

describe('album sidebar sort', () => {
  it('renders covered albums ahead of plain ones, each group sorted by name', () => {
    const html = renderSidebar([
      makeAlbum({ id: 'plain-z', name: 'Zulu' }),
      makeAlbum({ id: 'cover-z', name: 'Zulu Covered', cover: 'http://localhost/z.jpg' }),
      makeAlbum({ id: 'plain-a', name: 'Alpine' }),
      makeAlbum({ id: 'cover-a', name: 'Alpine Covered', cover: 'http://localhost/a.jpg' }),
    ]);
    const order = ['Alpine Covered', 'Zulu Covered', 'Alpine', 'Zulu'].map((name) => html.indexOf(`<span>${name}</span>`));
    expect(order.every((index) => index !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps the selected album highlighted after the reorder', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum({ id: 'z', name: 'Zulu' }), makeAlbum({ id: 'a', name: 'Alpine' })]} collection="z" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} />,
    );
    expect(html.indexOf('<span>Alpine</span>')).toBeLessThan(html.indexOf('<span>Zulu</span>'));
    expect(html).toContain('album-item is-selected');
  });
});
