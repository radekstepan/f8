import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { PhotoCanvas } from './PhotoCanvas.js';

// Preview-sized-like-final, rendered on the server (no jsdom): pins the
// loading-state frame dimensions, not live paint behavior. Opening a photo
// from an album used to size the frame at a hardcoded 1200:627 (or the
// previous photo's aspect) until the full-res image decoded, so the
// thumbnail preview visibly resized when the canvas landed. The frame now
// predicts the final aspect from the stored dimensions + rotation/crop while
// loading, so the preview already sits at the final size.

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
    width: 2000,
    height: 3000,
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

/** Inline width/height of the loading frame (server stage is 800x520). */
function frameSize(html: string): { width: number; height: number } {
  const style = html.match(/data-testid="photo-frame" style="([^"]*)"/)?.[1] ?? '';
  const width = Number(style.match(/width:\s*([\d.]+)px/)?.[1]);
  const height = Number(style.match(/height:\s*([\d.]+)px/)?.[1]);
  expect(Number.isFinite(width) && width > 0).toBe(true);
  expect(Number.isFinite(height) && height > 0).toBe(true);
  return { width, height };
}

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
const fullCss = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fullCss().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('preview sized like final', () => {
  it('sizes a portrait frame from stored dimensions while loading', () => {
    const html = renderCanvas(makePhoto(), { ...DEFAULT_EDIT });
    expect(html).toMatch(/photo-frame[^"]*is-loading/);
    const { width, height } = frameSize(html);
    // 2000x3000 portrait: the frame is portrait at the stored ratio, not the
    // old hardcoded 1200:627 landscape box.
    expect(height / width).toBeCloseTo(3000 / 2000, 6);
  });

  it('sizes a landscape frame from stored dimensions while loading', () => {
    const html = renderCanvas(makePhoto({ width: 3000, height: 2000 }), { ...DEFAULT_EDIT });
    const { width, height } = frameSize(html);
    expect(width / height).toBeCloseTo(3000 / 2000, 6);
  });

  it('swaps the loading frame on a quarter turn', () => {
    const html = renderCanvas(makePhoto(), { ...DEFAULT_EDIT, rotation: 90 });
    const { width, height } = frameSize(html);
    expect(width / height).toBeCloseTo(3000 / 2000, 6);
  });

  it('crops the loading frame to the crop ratio', () => {
    const html = renderCanvas(makePhoto(), { ...DEFAULT_EDIT, cropRatio: '1:1' });
    const { width, height } = frameSize(html);
    expect(width / height).toBeCloseTo(1, 6);
  });

  it('keeps the legacy box when stored dimensions are unknown', () => {
    const html = renderCanvas(makePhoto({ width: 0, height: 0 }), { ...DEFAULT_EDIT });
    const { width, height } = frameSize(html);
    expect(width / height).toBeCloseTo(1200 / 627, 6);
  });

  it('fills the preview hold edge-to-edge in the final frame', () => {
    const hold = cssRule('.thumb-hold');
    expect(hold).toMatch(/width\s*:\s*100%/);
    expect(hold).toMatch(/height\s*:\s*100%/);
    // Cover (not contain): with the frame at the final aspect the preview
    // shows the same framing as the canvas, with no letterboxing to resize.
    expect(hold).toMatch(/object-fit\s*:\s*cover/);
  });
});
