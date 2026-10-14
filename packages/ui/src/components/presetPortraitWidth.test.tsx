import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo, Preset } from '@f8/core';
import { PresetStrip } from './PhotoStrips.js';

// Portrait preset box width: every preset thumb shows the same photo, so on
// a portrait photo the strip flips to .is-portrait — but the rule only
// switched the image to object-fit: contain while keeping the landscape
// item width (flex-basis 66px, growing to 118px). The narrow portrait
// preview letterboxed inside the wide box, reading as ~3x too wide. The
// fix shrinks the item to the 43px portrait width (the filmstrip's
// .is-portrait precedent): just the preview plus the name below.
// Rendered on the server (no jsdom): pins markup + stylesheet, not pixels.

const noop = () => {};

function makePhoto(portrait: boolean): Photo {
  return {
    id: 'p1',
    name: 'DSC06322.ARW',
    title: 'Alpine morning',
    src: 'http://localhost/photo.jpg',
    thumbnail: 'http://localhost/thumb.jpg',
    albumId: 'a1',
    location: 'Dolomites',
    date: '2024-01-01',
    width: portrait ? 2000 : 3000,
    height: portrait ? 3000 : 2000,
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

function makePresets(): Preset[] {
  return [
    { id: 'original', name: 'Original', category: 'Essentials', values: {} },
    { id: 'golden', name: 'Golden Hour', category: 'Essentials', values: { exposure: 0.12 } },
  ];
}

function renderStrip(portrait: boolean): string {
  return renderToStaticMarkup(
    <PresetStrip photo={makePhoto(portrait)} presets={makePresets()} selected="Original" onSelect={noop} onAdd={noop} onToggle={noop} />,
  );
}

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

const pxValue = (rule: string, property: string): number | null => {
  const match = rule.match(new RegExp(`${property}\\s*:\\s*(?:\\d+\\s+\\d+\\s+)?(\\d+(?:\\.\\d+)?)px`));
  return match ? Number(match[1]) : null;
};

describe('portrait preset box width', () => {
  it('marks the strip portrait only for portrait photos', () => {
    expect(renderStrip(true)).toContain('class="presets-list is-portrait"');
    expect(renderStrip(false)).toContain('class="presets-list"');
    expect(renderStrip(false)).not.toContain('is-portrait');
  });

  it('shrinks portrait items to a fixed narrow width', () => {
    const rule = cssRule('.presets-list.is-portrait .preset-item');
    expect(rule).not.toBe('');
    // Fixed flex-basis (no grow) at the filmstrip portrait width.
    expect(rule).toMatch(/flex\s*:\s*0\s+0\s+43px/);
    expect(rule).toMatch(/max-width\s*:\s*43px/);
  });

  it('keeps the portrait width well under the landscape width', () => {
    const portrait = pxValue(cssRule('.presets-list.is-portrait .preset-item'), 'flex');
    const landscapeBasis = pxValue(cssRule('.preset-item'), 'flex');
    const landscapeMax = pxValue(cssRule('.preset-item'), 'max-width');
    expect(portrait).not.toBeNull();
    expect(landscapeBasis).not.toBeNull();
    expect(landscapeMax).not.toBeNull();
    // ~1/3 of the grown landscape box, and under its starting basis.
    expect(portrait! / landscapeMax!).toBeLessThan(0.5);
    expect(portrait!).toBeLessThan(landscapeBasis!);
  });

  it('leaves the landscape item sizing untouched', () => {
    const rule = cssRule('.preset-item');
    expect(rule).toMatch(/flex\s*:\s*1\s+0\s+66px/);
    expect(rule).toMatch(/max-width\s*:\s*118px/);
  });

  it('still letterboxes (never crops) the portrait preview', () => {
    expect(cssRule('.presets-list.is-portrait .preset-thumbnail > img')).toMatch(/object-fit\s*:\s*contain/);
  });

  it('still renders every preset name with its full-name tooltip', () => {
    const html = renderStrip(true);
    expect(html).toContain('>Original</span>');
    expect(html).toContain('>Golden Hour</span>');
    // Long names truncate in the narrow box; the tooltip keeps the full name.
    expect(html).toContain('Apply Golden Hour');
  });
});
