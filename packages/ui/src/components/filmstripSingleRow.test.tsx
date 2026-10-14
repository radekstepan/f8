import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { filmstripArrowIndex } from '@f8/core';
import type { Photo } from '@f8/core';
import { Filmstrip } from './PhotoStrips.js';

// Footer filmstrip layout: always a single horizontal row below the main
// photo, rendered on the server (no jsdom). The row itself is CSS, so the
// stylesheet rule is pinned here (same seam as sortAlbum.test.tsx); the
// centering scroll is an effect and stays client-only, covered in core by
// filmstripCenteredScrollOffset tests.

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

describe('filmstrip single row', () => {
  it('never wraps the footer photos into multiple rows', () => {
    const rule = cssRule('.filmstrip-list');
    expect(rule).toMatch(/flex-wrap\s*:\s*nowrap/);
    expect(rule).not.toMatch(/flex-wrap\s*:\s*wrap\s*;/);
  });

  it('scrolls overflow horizontally instead of vertically', () => {
    const rule = cssRule('.filmstrip-list');
    expect(rule).toMatch(/overflow-x\s*:\s*auto/);
    expect(rule).toMatch(/overflow-y\s*:\s*hidden/);
  });

  it('does not grow the footer to fit extra rows', () => {
    expect(cssRule('.filmstrip')).not.toContain('max-height');
  });

  it('renders one list with every photo in order and the selection marked', () => {
    const html = renderToStaticMarkup(
      <Filmstrip photos={[makePhoto('p1'), makePhoto('p2'), makePhoto('p3')]} selectedId="p2" collectionName="Road Trip" onSelect={noop} onSort={noop} reversed={false} showPresets={false} onShowPresets={noop} />,
    );
    expect(html.match(/class="filmstrip-list"/g)).toHaveLength(1);
    const order = [...html.matchAll(/data-photo-id="(p\d)"/g)].map((match) => match[1]);
    expect(order).toEqual(['p1', 'p2', 'p3']);
    expect(html).toContain('filmstrip-item is-selected');
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders no photo-browser button in the footer actions', () => {
    const html = renderToStaticMarkup(
      <Filmstrip photos={[makePhoto('p1')]} selectedId="p1" collectionName="Road Trip" onSelect={noop} onSort={noop} reversed={false} showPresets={false} onShowPresets={noop} />,
    );
    expect(html).not.toContain('Show photo browser');
  });

  it('walks the single row linearly with Left/Right/Home/End only', () => {
    expect(filmstripArrowIndex('ArrowRight', 1, 3)).toBe(2);
    expect(filmstripArrowIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(filmstripArrowIndex('Home', 1, 3)).toBe(0);
    expect(filmstripArrowIndex('End', 1, 3)).toBe(2);
    // No rows above or below to reach in a single row.
    expect(filmstripArrowIndex('ArrowUp', 1, 3)).toBe(-1);
    expect(filmstripArrowIndex('ArrowDown', 1, 3)).toBe(-1);
  });
});
