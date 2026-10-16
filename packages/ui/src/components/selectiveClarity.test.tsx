import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// Selective Clarity section, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring — the range chips, the
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

/** The header actions row of the Selective Clarity section. */
function selectiveActions(html: string): string {
  const section = html.slice(html.indexOf('<h3>Selective Clarity</h3>'));
  return section.match(/<div class="section-actions">[\s\S]*?<\/div>/)?.[0] ?? '';
}

/** The full Selective Clarity section chunk (header + content). */
function selectiveSection(html: string): string {
  const start = html.lastIndexOf('<section class="adjustment-section', html.indexOf('<h3>Selective Clarity</h3>'));
  const rest = html.slice(start);
  return rest.slice(0, rest.indexOf('</section>'));
}

describe('selective clarity section', () => {
  it('sits between Details and Effects with shadows selected', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    const details = html.indexOf('<h3>Details</h3>');
    const selective = html.indexOf('<h3>Selective Clarity</h3>');
    const effects = html.indexOf('<h3>Effects</h3>');
    expect(details).toBeGreaterThan(-1);
    expect(selective).toBeGreaterThan(details);
    expect(effects).toBeGreaterThan(selective);
    expect(html).toContain('data-testid="selective-clarity-range-shadows" class="selective-clarity-swatch is-active"');
    expect(html).toContain('data-testid="selective-clarity-range-name">Shadows</p>');
  });

  it('renders all three range chips with tooltips', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    for (const range of ['shadows', 'midtones', 'highlights'] as const) {
      expect(html).toContain(`data-testid="selective-clarity-range-${range}"`);
    }
    expect(html).toContain('aria-label="Selective clarity range"');
    // Exactly one selected chip; the rest are unpressed.
    expect(html.match(/selective-clarity-swatch is-active/g)).toHaveLength(1);
  });

  it('shows the selected range’s stored slider values', () => {
    const html = renderAdjust({
      ...DEFAULT_EDIT,
      selectiveClarity: [{ range: 'shadows', texture: 30, clarity: -45 }],
    });
    const section = selectiveSection(html);
    expect(section).toMatch(/selective-clarity-texture"[\s\S]{0,600}?value="30"/);
    expect(section).toMatch(/selective-clarity-clarity"[\s\S]{0,600}?value="-45"/);
  });

  it('marks adjusted ranges on their chips while another range is selected', () => {
    // Selection is local and starts on shadows, so the highlights edit
    // shows only as a dirty dot — the sliders still read the untouched
    // shadows.
    const html = renderAdjust({
      ...DEFAULT_EDIT,
      selectiveClarity: [{ range: 'highlights', texture: 0, clarity: 60 }],
    });
    expect(html).toContain('data-testid="selective-clarity-range-highlights" class="selective-clarity-swatch is-dirty"');
    expect(html).toContain('aria-label="Highlights (adjusted)"');
    expect(html).toContain('data-testid="selective-clarity-range-shadows" class="selective-clarity-swatch is-active"');
    const section = selectiveSection(html);
    expect(section).toMatch(/selective-clarity-clarity"[\s\S]{0,600}?value="0"/);
  });

  it('keeps the manual header toggle off and disabled at defaults', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).toContain('class="toggle" data-testid="selective-clarity-toggle" disabled=""');
    // One switch in the header, no reset button anywhere in the section.
    const actions = selectiveActions(html);
    expect(actions.match(/role="switch"/g)).toHaveLength(1);
    expect(selectiveSection(html)).not.toContain('section-reset');
  });

  it('lights the header toggle once any range is touched', () => {
    const html = renderAdjust({
      ...DEFAULT_EDIT,
      selectiveClarity: [{ range: 'midtones', texture: 25, clarity: 0 }],
    });
    expect(html).toContain('class="toggle is-on" data-testid="selective-clarity-toggle"');
    const toggle = html.match(/<button[^>]*data-testid="selective-clarity-toggle"[^>]*>/)?.[0] ?? '';
    expect(toggle).not.toContain('disabled');
  });

  it('styles the chip row, single active ring, dirty dot, and range caption', () => {
    expect(cssRule('.selective-clarity-swatches')).toMatch(/display\s*:\s*flex/);
    // One tight ring hugging the dot: no padding gap between the color
    // circle and the selection ring (the old offset border read as double
    // circles). Keyboard focus reuses the same tight ring instead of the
    // global offset outline.
    expect(cssRule('.selective-clarity-swatch')).toMatch(/padding\s*:\s*0/);
    expect(cssRule('.selective-clarity-swatch:hover .selective-clarity-dot')).toMatch(/box-shadow[^;]*#55555e/);
    expect(cssRule('.selective-clarity-swatch.is-active .selective-clarity-dot')).toMatch(/box-shadow[^;]*var\(--accent\)/);
    expect(cssRule('.selective-clarity-swatch:focus-visible')).toMatch(/outline\s*:\s*none/);
    expect(cssRule('.selective-clarity-swatch:focus-visible .selective-clarity-dot')).toMatch(/box-shadow[^;]*var\(--accent\)/);
    expect(cssRule('.selective-clarity-dot')).toMatch(/border-radius\s*:\s*50%/);
    expect(cssRule('.selective-clarity-swatch.is-dirty::after')).toMatch(/content\s*:\s*'[^']*'/);
    expect(cssRule('.selective-clarity-range-name')).toMatch(/text-transform\s*:\s*uppercase/);
  });
});
