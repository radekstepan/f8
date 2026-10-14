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
// rounded by the blur — instead of softly lifted. Two follow-ups layered a
// light keyline over a tight contact shadow plus a negative-spread ambient
// lift, then halved that ambient — but the photo still read as a
// semi-transparent oval with a rigid border: the 1px light ring is the
// only layer that can draw a hard edge, and the negative spread shrinks
// the shadow's source rect so the blur dominates and rounds the halo into
// an oval silhouette on the dark stage. The fix drops the keyline and the
// spread trick entirely: a plain two-layer drop shadow (tight contact +
// short downward falloff, no light ring, no spread), so the frame reads as
// softly lifted instead of outlined.

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

  it('carries no light keyline ring that would read as a rigid border', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).toContain('box-shadow');
    // The 1px `0 0 0` ring was the only layer able to draw a hard edge —
    // every blurred black layer fades, only the ring outlines.
    expect(rule).not.toContain('#ffffff');
    expect(rule).not.toMatch(/0 0 0 1px/);
  });

  it('lifts the frame with a plain two-layer drop shadow', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).toMatch(/0 1px 2px #0006/);
    expect(rule).toMatch(/0 6px 18px #0005/);
  });

  it('drops the old edge-hugging blur that read as a dark border', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).not.toContain('0 9px 35px #0005');
    expect(rule).not.toContain('#ffffff05');
  });

  it('drops the heavy ambient blur that banded on the dark stage', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).not.toContain('0 18px 50px -12px #000a');
  });

  it('drops the negative-spread halo that rounded into an oval silhouette', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).not.toContain('0 10px 24px -8px #0006');
    expect(rule).not.toContain('0 0 0 1px #ffffff14');
  });

  it('keeps every shadow layer short and faint enough not to band', () => {
    const rule = cssRule('.photo-frame');
    const shadow = rule.match(/box-shadow:\s*([^;]+)/)?.[1] ?? '';
    expect(shadow).not.toBe('');
    // No long-blur layer: banding steps show in gradients tens of px long,
    // and a blur this short cannot round the halo into an oval silhouette.
    const blurs = [...shadow.matchAll(/(\d+)px (\d+)px(?: (-?\d+)px)? (#(?:[0-9a-fA-F]{4}|[0-9a-fA-F]{8}))?/g)]
      .map((match) => Number(match[2]));
    expect(blurs.length).toBeGreaterThan(0);
    expect(Math.max(...blurs)).toBeLessThanOrEqual(18);
    // No near-opaque black layer: the lift must stay whisper-faint.
    const alphas = [...shadow.matchAll(/#000([0-9a-fA-F])/g)].map((match) => parseInt(match[1] ?? '', 16));
    expect(alphas.length).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0x6);
    // No spread tricks: a shrunk source rect lets the blur dominate and
    // detach into a free-floating oval instead of a grounded drop shadow.
    expect(shadow).not.toMatch(/-\d+px/);
  });

  it('leaves the canvas square with no dark border of its own', () => {
    const rule = cssRule('.photo-frame');
    expect(rule).not.toMatch(/(^|;|\s)border(-radius)?:/);
  });
});
