import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo, Preset } from '@f8/core';
import { PRESETS } from '@f8/core';
import { PresetStrip } from './PhotoStrips.js';

// Portrait preset names must show in full: an earlier fix shrank the whole
// portrait item to the 43px filmstrip width, which truncated "Golden Hour",
// "Soft Light" (and any other long name) to ellipsis. The item is now back
// at a 72px name width while only the thumbnail keeps the narrow 43px
// portrait preview, centered. Rendered on the server (no jsdom): pins
// markup + stylesheet, not pixels.

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
    { id: 'soft', name: 'Soft Light', category: 'Essentials', values: { exposure: 0.18 } },
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

// Conservative per-glyph advances at the 9px preset-label size —
// deliberately above typical system-font metrics, so a passing fit
// assertion carries real margin. No font engine in unit tests (and no
// Playwright per task rules), so the stylesheet pin plus this overestimate
// is the seam: it must fail for the old 43px box and pass for the new one.
function estimateNameWidthPx(name: string): number {
  let width = 0;
  for (const ch of name) {
    if (ch === ' ') width += 3;
    else if (ch === '&') width += 6.5;
    else if ('il.,\'!|:;'.includes(ch)) width += 3;
    else if ('WM'.includes(ch)) width += 8;
    else if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) width += 6.5;
    else if ('mw'.includes(ch)) width += 6.5;
    else width += 5;
  }
  return width;
}

describe('portrait preset box width', () => {
  it('marks the strip portrait only for portrait photos', () => {
    expect(renderStrip(true)).toContain('class="presets-list is-portrait"');
    expect(renderStrip(false)).toContain('class="presets-list"');
    expect(renderStrip(false)).not.toContain('is-portrait');
  });

  it('keeps the portrait item at the full name width', () => {
    const rule = cssRule('.presets-list.is-portrait .preset-item');
    expect(rule).not.toBe('');
    // Fixed flex-basis (no grow) at the name width, not the thumbnail width.
    expect(rule).toMatch(/flex\s*:\s*0\s+0\s+72px/);
    expect(rule).toMatch(/max-width\s*:\s*72px/);
  });

  it('keeps the portrait thumbnail narrow and centered', () => {
    const rule = cssRule('.presets-list.is-portrait .preset-thumbnail');
    expect(rule).not.toBe('');
    expect(rule).toMatch(/width\s*:\s*43px/);
    expect(rule).toMatch(/margin-inline\s*:\s*auto/);
  });

  it('fits every built-in preset name in the portrait box', () => {
    const portrait = pxValue(cssRule('.presets-list.is-portrait .preset-item'), 'flex');
    expect(portrait).not.toBeNull();
    for (const preset of PRESETS) {
      // +8px on top of advances that already run ~13% over real 9px
      // system-font metrics, so the true margin is roughly twice that.
      expect(
        estimateNameWidthPx(preset.name) + 8,
        `"${preset.name}" fits in the portrait box with headroom`,
      ).toBeLessThanOrEqual(portrait!);
    }
    // The longest built-in exceeds the old 43px item: this fit check would
    // have caught the truncation it replaces.
    const longest = Math.max(...PRESETS.map((preset) => estimateNameWidthPx(preset.name)));
    expect(longest).toBeGreaterThan(43);
  });

  it('leaves the landscape item sizing untouched', () => {
    const rule = cssRule('.preset-item');
    expect(rule).toMatch(/flex\s*:\s*1\s+0\s+66px/);
    expect(rule).toMatch(/max-width\s*:\s*118px/);
  });

  it('fits every built-in name at the tightest landscape width too', () => {
    // The ≤1180px breakpoint drops the landscape basis to 64px (items still
    // grow from there); even there the longest name fits without ellipsis.
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
    const css = readFileSync(cssPath, 'utf8');
    const block = css.match(/@media\s*\(max-width:\s*1180px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const basis = block.match(/\.preset-item\s*\{\s*flex-basis:\s*(\d+(?:\.\d+)?)px/)?.[1];
    expect(basis).toBe('64');
    const longest = Math.max(...PRESETS.map((preset) => estimateNameWidthPx(preset.name)));
    expect(longest).toBeLessThanOrEqual(Number(basis));
  });

  it('still letterboxes (never crops) the portrait preview', () => {
    expect(cssRule('.presets-list.is-portrait .preset-thumbnail > img')).toMatch(/object-fit\s*:\s*contain/);
  });

  it('still renders every preset name with its full-name tooltip', () => {
    for (const portrait of [true, false]) {
      const html = renderStrip(portrait);
      expect(html).toContain('>Original</span>');
      expect(html).toContain('>Golden Hour</span>');
      expect(html).toContain('>Soft Light</span>');
      expect(html).toContain('Apply Golden Hour');
      expect(html).toContain('Apply Soft Light');
    }
  });

  it('keeps ellipsis as the fallback for extra-long custom names', () => {
    // User-saved preset names are unbounded, so the label rule keeps its
    // truncation fallback; the tooltip still carries the full custom name.
    expect(cssRule('.preset-item > span:last-child')).toMatch(/text-overflow\s*:\s*ellipsis/);
  });
});
