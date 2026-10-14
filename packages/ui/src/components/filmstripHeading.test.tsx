import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo } from '@f8/core';
import { Filmstrip } from './PhotoStrips.js';

// Filmstrip heading: the album name and the photo count share one text
// baseline. The two run at different sizes (9px name, 8.5px count), so
// centering their boxes (align-items: center) lifts the smaller count
// above the name — baseline alignment pins both to the same line.
// Rendered on the server (no jsdom); the alignment itself is CSS, so the
// stylesheet rules are pinned here (same seam as filmstripSingleRow).

function makePhoto(id: string): Photo {
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
    favorite: false,
    rating: 0,
  };
}

const noop = () => {};

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

const renderHeading = (collectionName = 'Road Trip', count = 3) =>
  renderToStaticMarkup(
    <Filmstrip
      photos={Array.from({ length: count }, (_, index) => makePhoto(`p${index + 1}`))}
      selectedId="p1"
      collectionName={collectionName}
      onSelect={noop}
      onSort={noop}
      reversed={false}
      showPresets={false}
      onShowPresets={noop}
    />,
  );

describe('filmstrip heading alignment', () => {
  it('aligns the album name and photo count on a shared baseline', () => {
    const rule = cssRule('.filmstrip-heading > div:first-child');
    expect(rule).toMatch(/align-items\s*:\s*baseline/);
  });

  it('never centers the two different-sized texts by box', () => {
    const rule = cssRule('.filmstrip-heading > div:first-child');
    expect(rule).not.toMatch(/align-items\s*:\s*center/);
  });

  it('keeps the heading bar itself vertically centered', () => {
    expect(cssRule('.filmstrip-heading')).toMatch(/align-items\s*:\s*center/);
  });

  it('renders the album name and photo count together in the heading', () => {
    const html = renderHeading();
    expect(html).toContain('<h2>Road Trip</h2>');
    expect(html).toContain('<span>3 photos</span>');
    const heading = html.match(/<div class="filmstrip-heading">.*?<\/div><div class="filmstrip-actions">/)?.[0] ?? '';
    expect(heading).toContain('<h2>Road Trip</h2>');
    expect(heading).toContain('<span>3 photos</span>');
  });
});
