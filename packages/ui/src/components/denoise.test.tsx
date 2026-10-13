import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { DenoiseState, EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist } from './Inspector.js';

// Lightweight-denoise control, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring, not click behavior.

function makePhoto(iso = 3200): Photo {
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
    iso,
    aperture: 'f/8',
    shutter: '1/250',
    focalLength: '35mm',
    raw: false,
    favorite: false,
    rating: 0,
  };
}

const noop = () => {};

function assist(overrides: Partial<DenoiseAssist> = {}): DenoiseAssist {
  return {
    state: 'idle',
    preview: null,
    applied: null,
    hasBase: false,
    progress: null,
    note: null,
    message: null,
    onPreview: noop,
    onApply: noop,
    onClear: noop,
    onDismiss: noop,
    ...overrides,
  };
}

const APPLIED: DenoiseState = { strength: 65, auto: true, source: 'onnx' };

function renderAdjust(edit: EditState, photo: Photo, denoiseAssist?: DenoiseAssist): string {
  return renderToStaticMarkup(
    <Inspector
      photo={photo}
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
      {...(denoiseAssist === undefined ? {} : { denoiseAssist })}
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

describe('denoise control', () => {
  it('is absent without a denoise assist', () => {
    expect(renderAdjust({ ...DEFAULT_EDIT }, makePhoto())).not.toContain('data-testid="denoise"');
  });

  it('starts high-ISO captures on auto with the ISO suggestion and an ML badge', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).toContain('data-testid="denoise"');
    expect(html).toContain('data-testid="denoise-strength"');
    expect(html).toContain('data-testid="denoise-preview"');
    expect(html).toContain('Auto · ISO 3200 → 50');
    expect(html).toContain('ml-badge');
    expect(html).toContain('>ML<');
  });

  it('starts clean captures on a manual strength', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(100), assist());
    expect(html).toContain('Manual strength — previews on a small downsample first');
    expect(html).toContain('data-testid="denoise-preview"');
  });

  it('shows the preview before/after with apply and the ML tag', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      makePhoto(3200),
      assist({
        state: 'preview-ready',
        preview: { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 65, source: 'onnx' },
      }),
    );
    expect(html).toContain('data-testid="denoise-compare"');
    expect(html).toContain('data-testid="denoise-before"');
    expect(html).toContain('data-testid="denoise-after"');
    expect(html).toContain('Preview 65 · ML');
    expect(html).toContain('data-testid="denoise-apply"');
    expect(html).toContain('Apply to photo');
  });

  it('labels classical previews as approximate and omits the ML tag', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      makePhoto(3200),
      assist({
        state: 'preview-ready',
        preview: { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 65, source: 'classic' },
        note: 'Classical denoise — ML weights are still downloading or offline, so this is approximate.',
      }),
    );
    expect(html).toContain('Preview 65');
    expect(html).toContain('Classical denoise');
    expect(html).not.toContain('· ML');
  });

  it('shows the applied state with re-preview and clear', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, denoise: APPLIED },
      makePhoto(3200),
      assist({ state: 'applied', applied: APPLIED, hasBase: true }),
    );
    expect(html).toContain('data-testid="denoise-applied"');
    expect(html).toContain('Denoised 65 · ML');
    expect(html).toContain('data-testid="denoise-repreview"');
    expect(html).toContain('data-testid="denoise-clear"');
  });

  it('offers a one-click restore when the recipe outlives the session pixels', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, denoise: APPLIED },
      makePhoto(3200),
      assist({ state: 'applied', applied: APPLIED, hasBase: false }),
    );
    expect(html).toContain('data-testid="denoise-stale"');
    expect(html).toContain('data-testid="denoise-restore"');
    expect(html).toContain('Restore denoise');
  });

  it('reports errors with retry', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      makePhoto(3200),
      assist({ state: 'error', message: 'Photo server unreachable.' }),
    );
    expect(html).toContain('Photo server unreachable.');
    expect(html).toContain('data-testid="denoise-retry"');
  });

  it('lives inside the ML Enhance section, with no standalone Denoise section', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).not.toContain('<h3>Denoise</h3>');
    const heading = html.indexOf('<h3>ML Enhance</h3>');
    const control = html.indexOf('data-testid="denoise"');
    expect(heading).toBeGreaterThan(-1);
    expect(control).toBeGreaterThan(heading);
    // Still above the histogram, with the other ML actions.
    expect(control).toBeLessThan(html.indexOf('histogram-section'));
  });

  it('uses a slim preview button like the other ML actions', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).toContain('class="slim-button full-width" data-testid="denoise-preview"');
    expect(html).not.toContain('secondary-button');
  });

  it('shows a centered 2x closeup under the small preview pair', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      makePhoto(3200),
      assist({
        state: 'preview-ready',
        preview: { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 65, source: 'onnx' },
      }),
    );
    expect(html).toContain('data-testid="denoise-closeup"');
    expect(html).toContain('data-testid="denoise-closeup-before"');
    expect(html).toContain('data-testid="denoise-closeup-after"');
    expect(html).toContain('Before · 2×');
    expect(html).toContain('After · 2×');
    // Default loupe sits on the center until the user clicks the preview.
    expect(html).toContain('background-position:50% 50%');
    expect(html).toContain('Click to move the 2× closeup');
  });

  it('keeps the closeup as proof after apply and points at Compare', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, denoise: APPLIED },
      makePhoto(3200),
      assist({
        state: 'applied',
        applied: APPLIED,
        hasBase: true,
        preview: { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 65, source: 'onnx' },
      }),
    );
    expect(html).toContain('data-testid="denoise-closeup"');
    expect(html).toContain('Compare (B) shows the noisy original against the clean photo.');
  });

  it('magnifies the closeup boxes 2x without tiling', () => {
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
    const rule = readFileSync(cssPath, 'utf8').match(/\.denoise-zoom\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/background-size\s*:\s*200%/);
    expect(rule).toMatch(/background-repeat\s*:\s*no-repeat/);
  });
});
