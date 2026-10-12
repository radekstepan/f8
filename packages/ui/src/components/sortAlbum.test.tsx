import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo } from '@f8/core';
import { Filmstrip, PhotoBrowser } from './PhotoStrips.js';

// Album-sort surfaces, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior. The sort
// dropdown is closed in SSR output — the open menu is client-only.

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

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('sort album', () => {
  it('renders the sort control in the grid header when the handler is provided', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} sortKey="imported" sortDir="desc" onSortChange={noop} />,
    );
    expect(html).toContain('Sort album: Date imported, descending');
    expect(html).toContain('browser-sort-menu');
  });

  it('renders no sort control without the handler', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).not.toContain('browser-sort-menu');
    expect(html).not.toContain('Sort album:');
  });

  it('labels the filmstrip direction toggle for the active sort key', () => {
    const filename = renderToStaticMarkup(
      <Filmstrip photos={[makePhoto()]} selectedId="p1" collectionName="Road Trip" onSelect={noop} onGrid={noop} onSort={noop} reversed={false} sortKey="filename" showPresets={false} onShowPresets={noop} />,
    );
    expect(filename).toContain('Sort filenames A to Z');
    const imported = renderToStaticMarkup(
      <Filmstrip photos={[makePhoto()]} selectedId="p1" collectionName="Road Trip" onSelect={noop} onGrid={noop} onSort={noop} reversed sortKey="imported" showPresets={false} onShowPresets={noop} />,
    );
    expect(imported).toContain('Sort by import, oldest first');
  });

  it('keeps the legacy newest/oldest filmstrip label for the default captured sort', () => {
    const html = renderToStaticMarkup(
      <Filmstrip photos={[makePhoto()]} selectedId="p1" collectionName="Road Trip" onSelect={noop} onGrid={noop} onSort={noop} reversed={false} showPresets={false} onShowPresets={noop} />,
    );
    expect(html).toContain('Sort photos newest first');
  });

  it('anchors the sort dropdown to its header trigger', () => {
    expect(cssRule('.browser-sort-menu')).toContain('position: relative');
  });
});
