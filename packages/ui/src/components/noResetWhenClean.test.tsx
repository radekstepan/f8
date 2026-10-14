import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// No reset button in any section header (the Task 10 clean-section gate,
// extended to every state), rendered on the server (no jsdom): sections
// show their dirtiness through the header switch — off and disabled at
// defaults for the suggestion-less Curves/Details/Effects, lit on the
// first tweak — and the shared header owns no reset control at all.

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

const here = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(resolve(here, file), 'utf8');

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

/** Markup of the Curves section only, bounded by its neighboring headings. */
function curvesSection(html: string): string {
  return html.slice(html.indexOf('<h3>Curves</h3>'), html.indexOf('<h3>Details</h3>'));
}

/** Markup of the Effects section only, bounded by its neighbors (Details, end of adjust). */
function effectsSection(html: string): string {
  return html.slice(html.indexOf('<h3>Effects</h3>'));
}

describe('no reset on clean sections', () => {
  it('renders the Curves switch off and disabled at defaults, lit once the curve leaves defaults', () => {
    const clean = curvesSection(renderAdjust({ ...DEFAULT_EDIT }));
    expect(clean).toContain('class="toggle" data-testid="curves-toggle"');
    expect(clean).not.toContain('section-reset');
    expect(clean).not.toContain('aria-label="Reset curves"');
    const dirty = curvesSection(renderAdjust({ ...DEFAULT_EDIT, curve: 25 }));
    expect(dirty).toContain('class="toggle is-on" data-testid="curves-toggle"');
    expect(dirty).not.toContain('section-reset');
    expect(dirty).not.toContain('aria-label="Reset curves"');
  });

  it('renders the Effects switch off and disabled at defaults, lit once vignette or fade leaves defaults', () => {
    const clean = effectsSection(renderAdjust({ ...DEFAULT_EDIT }));
    expect(clean).toContain('class="toggle" data-testid="effects-toggle"');
    expect(clean).not.toContain('section-reset');
    expect(clean).not.toContain('aria-label="Reset effects"');
    for (const patch of [{ vignette: 40 }, { fade: 15 }]) {
      const dirty = effectsSection(renderAdjust({ ...DEFAULT_EDIT, ...patch }));
      expect(dirty, JSON.stringify(patch)).toContain('class="toggle is-on" data-testid="effects-toggle"');
      expect(dirty, JSON.stringify(patch)).not.toContain('section-reset');
      expect(dirty, JSON.stringify(patch)).not.toContain('aria-label="Reset effects"');
    }
  });

  it('renders no reset in any slider section, clean or dirty — the removal is shared, not per-section', () => {
    // Curves/Effects/Details were the report, but the reset lived in the
    // shared AdjustmentSection: removing it there fixes every section at
    // once, in every state.
    const html = renderAdjust({ ...DEFAULT_EDIT, temperature: 5800, exposure: 0.5, saturation: 8, curve: 25, clarity: 20, vignette: 40 });
    expect(html).not.toContain('section-reset');
    for (const label of ['Reset white balance', 'Reset lightness', 'Reset hue &amp; saturation', 'Reset curves', 'Reset details', 'Reset effects']) {
      expect(html).not.toContain(`aria-label="${label}"`);
    }
  });

  it('owns no reset control in the shared header module', () => {
    // Structural pin (the collapsePanels.test.tsx precedent): the shared
    // header cannot render a reset — no reset class, no reset icon, no
    // reset props — so no future section can bring one back by accident.
    const shared = source('AdjustmentSection.tsx');
    expect(shared).not.toContain('section-reset');
    expect(shared).not.toContain('RotateCcw');
    expect(shared).not.toContain('onReset');
    expect(shared).not.toContain('canRevert');
  });
});
