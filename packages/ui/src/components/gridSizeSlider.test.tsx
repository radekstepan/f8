import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo } from '@f8/core';
import { DEFAULT_GRID_COLUMNS, GRID_SLIDER_MAX, GRID_SLIDER_MIN, PhotoBrowser, gridColumnsForSliderValue } from './PhotoStrips.js';

// Grid-size slider direction, rendered on the server (no jsdom): effects
// never run, so this pins the value → column-count mapping plus the
// default markup wiring, not live drag behavior. The slider value used to
// feed --grid-columns directly, so dragging right added columns and shrank
// the previews; now the value is the preview *size* (right = larger) and
// mirrors into a column count.

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

function renderBrowser(): string {
  return renderToStaticMarkup(
    <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} />,
  );
}

describe('grid size slider direction', () => {
  it('shrinks previews (more columns) at the left end of the slider', () => {
    expect(gridColumnsForSliderValue(GRID_SLIDER_MIN)).toBe(GRID_SLIDER_MAX);
  });

  it('enlarges previews (fewer columns) at the right end of the slider', () => {
    expect(gridColumnsForSliderValue(GRID_SLIDER_MAX)).toBe(GRID_SLIDER_MIN);
  });

  it('drops exactly one column per step dragged right', () => {
    const columns: number[] = [];
    for (let value = GRID_SLIDER_MIN; value <= GRID_SLIDER_MAX; value += 1) {
      columns.push(gridColumnsForSliderValue(value));
    }
    expect(columns).toEqual([5, 4, 3, 2]);
  });

  it('opens on the default column count, not the mirrored end', () => {
    const html = renderBrowser();
    // Slider thumb sits at the mirrored default (4 of 2..5)…
    expect(html).toMatch(/<input[^>]*aria-label="Photo grid size"[^>]*value="4"/);
    // …while the grid keeps its familiar 3-column look.
    expect(html).toContain('--grid-columns:3');
    expect(gridColumnsForSliderValue(GRID_SLIDER_MIN + GRID_SLIDER_MAX - DEFAULT_GRID_COLUMNS)).toBe(DEFAULT_GRID_COLUMNS);
  });

  it('keeps one direction-neutral grid icon leading the slider, nothing to swap', () => {
    const html = renderBrowser();
    const control = html.match(/<div class="browser-view-control">(.*?)<\/div>/)?.[1] ?? '';
    // The control holds the icon svg plus the range input and nothing else:
    // no trailing icon exists that could need swapping for the new direction.
    expect(control).toMatch(/^<svg/);
    expect(control).toContain('aria-label="Photo grid size"');
    expect(control.match(/<svg/g)?.length ?? 0).toBe(1);
  });
});
