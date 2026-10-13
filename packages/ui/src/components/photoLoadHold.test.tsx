import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { PhotoCanvas } from './PhotoCanvas.js';

// No-flash photo loading, rendered on the server (no jsdom): pins the
// loading-state markup + prop wiring, not live paint behavior. The editor
// used to mount an empty dark frame with a full-cover spinner while the
// full-res image decoded; now the (already cached) album thumbnail holds the
// frame and the canvas crossfades over it.

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

function renderCanvas(photo: Photo): string {
  return renderToStaticMarkup(
    <PhotoCanvas
      photo={photo}
      edit={{ ...DEFAULT_EDIT }}
      tool="adjust"
      zoom={1}
      compare={false}
      showOriginal={false}
      brushSize={45}
      brushStrength={100}
      onZoom={noop}
      onCompare={noop}
      onFavorite={noop}
      onRating={noop}
      onInfo={noop}
      onChange={noop}
      onHistogram={noop}
    />,
  );
}

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
const fullCss = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fullCss().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('no-flash photo loading', () => {
  it('holds the album thumbnail beneath the canvas while loading', () => {
    const html = renderCanvas(makePhoto());
    expect(html).toContain('class="thumb-hold"');
    expect(html).toContain('src="http://localhost/thumb.jpg"');
    // Paint order is DOM order: the hold sits under the full-res canvas.
    expect(html.indexOf('thumb-hold')).toBeLessThan(html.indexOf('edited-canvas'));
  });

  it('keeps the hold decorative so assistive tech hears the photo once', () => {
    const html = renderCanvas(makePhoto());
    expect(html).toMatch(/thumb-hold[^>]*alt=""/);
    expect(html).toMatch(/thumb-hold[^>]*aria-hidden="true"/);
    expect(html).toContain('aria-label="Alpine morning, with current adjustments"');
  });

  it('starts in the loading state with the spinner pill over the hold', () => {
    const html = renderCanvas(makePhoto());
    expect(html).toMatch(/photo-frame[^"]*is-loading/);
    expect(html).toContain('photo-loading');
    expect(html).toContain('Developing your photo...');
  });

  it('crossfades the hold out over the same duration as the canvas', () => {
    expect(cssRule('.thumb-hold')).toMatch(/object-fit\s*:\s*cover/);
    expect(cssRule('.thumb-hold')).toMatch(/transition\s*:\s*opacity 350ms/);
    expect(cssRule('.thumb-hold.is-settled')).toMatch(/opacity\s*:\s*0/);
    expect(cssRule('.edited-canvas')).toMatch(/transition\s*:\s*opacity 350ms/);
  });

  it('hides stale canvas pixels while loading instead of ghosting them', () => {
    expect(cssRule('.photo-frame.is-loading .edited-canvas')).toMatch(/opacity\s*:\s*0/);
  });

  it('floats the loading indicator over the hold instead of covering it', () => {
    const loading = cssRule('.photo-loading');
    expect(loading).not.toMatch(/inset\s*:\s*0/);
    expect(loading).toMatch(/border-radius\s*:\s*999px/);
    // The error state still covers the frame: there is no image to show.
    expect(cssRule('.photo-error')).toMatch(/inset\s*:\s*0/);
    expect(cssRule('.photo-error')).toMatch(/background\s*:\s*#1a1a1d/);
  });

  it('disables the photo transition under prefers-reduced-motion', () => {
    const css = fullCss();
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.photo-frame\s*\{[^}]*animation\s*:\s*none/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.thumb-hold[^{]*\{[^}]*transition\s*:\s*none/);
  });
});
