import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { PhotoCanvas } from './PhotoCanvas.js';

// Photo-frame shadow, rendered on the server (no jsdom): pins the editor
// frame's elevation treatment from the stylesheet, plus the markup hook it
// hangs on. The old single-layer `0 9px 35px #0005` shadow (black at 33%
// with a 35px blur) sat densest right against the frame edge, so the photo
// read as outlined by a dark semi-transparent border — its outer corners
// rounded by the blur — instead of softly lifted. The fix layers a crisp
// light keyline (topmost, so the photo edge separates cleanly from the
// dark stage) over a tight contact shadow and a negative-spread ambient
// lift whose dense core pulls away from the edge instead of hugging it.

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

function renderCanvas(photo: Photo, edit: EditState): string {
  return renderToStaticMarkup(
    <PhotoCanvas
      photo={photo}
      edit={edit}
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

const cssRule = (selector: string): string => {
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('photo frame shadow', () => {
  it('renders the frame hook the shadow hangs on', () => {
    const html = renderCanvas(makePhoto(), DEFAULT_EDIT);
    expect(html).toContain('data-testid="photo-frame"');
    expect(html).toMatch(/class="photo-frame(\s|")/);
  });

  it('opens with a light keyline so the photo edge separates from the stage', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).toContain('box-shadow');
    // First (topmost) layer: 1px light ring, before any black shadow layer.
    const keylineAt = rule.indexOf('0 0 0 1px #ffffff');
    expect(keylineAt).toBeGreaterThanOrEqual(0);
    expect(rule.indexOf('#000')).toBeGreaterThan(keylineAt);
  });

  it('keeps the ambient lift off the edge with a negative spread', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).toMatch(/0 1px 2px #0006/);
    expect(rule).toMatch(/0 18px 50px -12px #000a/);
  });

  it('drops the old edge-hugging blur that read as a dark border', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).not.toContain('0 9px 35px #0005');
    expect(rule).not.toContain('#ffffff05');
  });

  it('leaves the canvas square with no dark border of its own', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).not.toMatch(/(^|;|\s)border(-radius)?:/);
  });
});
