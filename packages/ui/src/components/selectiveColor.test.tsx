import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// Selective Color section, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring — the swatch row, the
// per-range slider values, and the manual header toggle — not clicks.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

function makePhoto(): Photo {
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
  };
}

const noop = () => {};

function renderAdjust(edit: EditState): string {
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={edit}
      tool="adjust"
      histogram={null}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      onChange={noop}
      onRotate={noop}
      onStraighten={noop}
      onReset={noop}
      onAuto={noop}
      onRevertEnhance={noop}
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onResetWhiteBalance={noop}
      onResetLightness={noop}
      onResetColor={noop}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

/** The header actions row of the Selective Color section. */
function selectiveActions(html: string): string {
  const section = html.slice(html.indexOf('<h3>Selective Color</h3>'));
  return section.match(/<div class="section-actions">[\s\S]*?<\/div>/)?.[0] ?? '';
}

/** The full Selective Color section chunk (header + content). */
function selectiveSection(html: string): string {
  const start = html.lastIndexOf('<section class="adjustment-section', html.indexOf('<h3>Selective Color</h3>'));
  const rest = html.slice(start);
  return rest.slice(0, rest.indexOf('</section>'));
}

describe('selective color section', () => {
  it('sits between Hue & Saturation and Curves with reds selected', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    const color = html.indexOf('<h3>Hue &amp; Saturation</h3>');
    const selective = html.indexOf('<h3>Selective Color</h3>');
    const curves = html.indexOf('<h3>Curves</h3>');
    expect(color).toBeGreaterThan(-1);
    expect(selective).toBeGreaterThan(color);
    expect(curves).toBeGreaterThan(selective);
    expect(html).toContain('data-testid="selective-color-range-reds" class="selective-color-swatch is-active"');
    expect(html).toContain('data-testid="selective-color-range-name">Reds</p>');
  });

  it('renders all eleven range swatches with tooltips', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    for (const range of ['reds', 'oranges', 'yellows', 'greens', 'aquas', 'blues', 'purples', 'magentas', 'whites', 'neutrals', 'blacks'] as const) {
      expect(html).toContain(`data-testid="selective-color-range-${range}"`);
    }
    expect(html).toContain('aria-label="Selective color range"');
    // Exactly one selected swatch; the rest are unpressed.
    expect(html.match(/selective-color-swatch is-active/g)).toHaveLength(1);
  });

  it('shows the selected range’s stored slider values', () => {
    const html = renderAdjust({
      ...DEFAULT_EDIT,
      selectiveColor: [{ range: 'reds', hue: 20, saturation: -40, luminance: 15 }],
    });
    const section = selectiveSection(html);
    expect(section).toMatch(/selective-color-hue"[\s\S]{0,600}?value="20"/);
    expect(section).toMatch(/selective-color-saturation"[\s\S]{0,600}?value="-40"/);
    expect(section).toMatch(/selective-color-luminance"[\s\S]{0,600}?value="15"/);
  });

  it('marks adjusted ranges on their swatches while another range is selected', () => {
    // Selection is local and starts on reds, so the blues edit shows only
    // as a dirty dot — the sliders still read the untouched reds.
    const html = renderAdjust({
      ...DEFAULT_EDIT,
      selectiveColor: [{ range: 'blues', hue: 0, saturation: -40, luminance: 0 }],
    });
    expect(html).toContain('data-testid="selective-color-range-blues" class="selective-color-swatch is-dirty"');
    expect(html).toContain('aria-label="Blues (adjusted)"');
    expect(html).toContain('data-testid="selective-color-range-reds" class="selective-color-swatch is-active"');
    const section = selectiveSection(html);
    expect(section).toMatch(/selective-color-saturation"[\s\S]{0,600}?value="0"/);
  });

  it('keeps the manual header toggle off and disabled at defaults', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).toContain('class="toggle" data-testid="selective-color-toggle" disabled=""');
    // One switch in the header, no reset button anywhere in the section.
    const actions = selectiveActions(html);
    expect(actions.match(/role="switch"/g)).toHaveLength(1);
    expect(selectiveSection(html)).not.toContain('section-reset');
  });

  it('lights the header toggle once any range is touched', () => {
    const html = renderAdjust({
      ...DEFAULT_EDIT,
      selectiveColor: [{ range: 'neutrals', hue: 0, saturation: 0, luminance: -30 }],
    });
    expect(html).toContain('class="toggle is-on" data-testid="selective-color-toggle"');
    const toggle = html.match(/<button[^>]*data-testid="selective-color-toggle"[^>]*>/)?.[0] ?? '';
    expect(toggle).not.toContain('disabled');
  });

  it('styles the swatch row, active ring, dirty dot, and range caption', () => {
    expect(cssRule('.selective-color-swatches')).toMatch(/display\s*:\s*flex/);
    expect(cssRule('.selective-color-swatch.is-active')).toMatch(/border-color\s*:/);
    expect(cssRule('.selective-color-dot')).toMatch(/border-radius\s*:\s*50%/);
    expect(cssRule('.selective-color-swatch.is-dirty::after')).toMatch(/content\s*:\s*'[^']*'/);
    expect(cssRule('.selective-color-range-name')).toMatch(/text-transform\s*:\s*uppercase/);
  });
});
