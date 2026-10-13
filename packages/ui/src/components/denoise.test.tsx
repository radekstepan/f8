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
      onRevertEnhance={noop}
      {...(denoiseAssist === undefined ? {} : { denoiseAssist })}
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onRevertWhiteBalance={noop}
      onRevertLightness={noop}
      onRevertColor={noop}
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

  it('starts high-ISO captures on the auto suggestion with the slider still editable', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).toContain('data-testid="denoise"');
    expect(html).toContain('data-testid="denoise-strength"');
    expect(html).toContain('data-testid="denoise-preview"');
    expect(html).toContain('Suggested for ISO 3200: 50');
    expect(html).toContain('Auto 50 — drag the slider to fine-tune');
    // Auto is a pressed momentary button (straighten pattern), not a locking
    // toggle: the slider stays enabled so Auto flows into fine-tuning.
    expect(html).toContain('class="auto-small is-active" data-testid="denoise-auto"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('disabled');
    expect(html).toContain('ml-badge');
    expect(html).toContain('>ML<');
  });

  it('starts clean captures on a manual strength with auto disabled', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(100), assist());
    expect(html).toContain('Draft strength — Preview, then Apply, to change the photo');
    expect(html).toContain('data-testid="denoise-preview"');
    expect(html).toContain('ISO 100 looks clean — no suggestion');
    expect(html).toContain('class="auto-small" data-testid="denoise-auto"');
    expect(html).toContain('title="ISO 100 needs no denoise"');
    const autoTag = html.match(/<button[^>]*data-testid="denoise-auto"[^>]*>/)?.[0] ?? '';
    expect(autoTag).toContain('disabled');
    // The slider itself is never locked: only the meaningless Auto is off.
    expect(html).not.toContain('range-control is-disabled');
  });

  it('explains the draft → preview → apply flow where the idle button lives', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).toContain('How it works: 1) pick a strength, 2) Preview shows a small before/after below in this panel, 3) Apply denoises the full photo. Only the strength is saved.');
    expect(html).toContain('title="Show strength 50 as a small before/after below, in this panel"');
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
    expect(html).toContain('data-testid="denoise-preview-title"');
    expect(html).toContain('Preview — small downsample, shown here');
    expect(html).toContain('data-testid="denoise-compare"');
    expect(html).toContain('data-testid="denoise-before"');
    expect(html).toContain('data-testid="denoise-after"');
    expect(html).toContain('Preview 65 · ML');
    expect(html).toContain('data-testid="denoise-apply"');
    expect(html).toContain('Apply to photo');
    // Apply follows the draft slider (50 here), so its title names it.
    expect(html).toContain('title="Denoise the full photo at strength 50 and edit from the clean pixels"');
  });

  it('flags the preview as stale when the draft moved past it', () => {
    // Draft starts at the ISO 3200 suggestion (50); the on-screen preview
    // shows 65, so the control must say the slider moved on.
    const stale = renderAdjust(
      { ...DEFAULT_EDIT },
      makePhoto(3200),
      assist({
        state: 'preview-ready',
        preview: { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 65, source: 'onnx' },
      }),
    );
    expect(stale).toContain('data-testid="denoise-preview-stale"');
    expect(stale).toContain('Strength is now 50 — update the preview to see it.');
    // A preview at the current draft shows no such note.
    const fresh = renderAdjust(
      { ...DEFAULT_EDIT },
      makePhoto(3200),
      assist({
        state: 'preview-ready',
        preview: { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 50, source: 'onnx' },
      }),
    );
    expect(fresh).not.toContain('data-testid="denoise-preview-stale"');
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
    expect(html).toContain('Preview another strength');
    expect(html).not.toContain('Try another strength');
    expect(html).toContain('data-testid="denoise-clear"');
  });

  it('flags the applied draft when it differs from the applied strength', () => {
    // Draft starts at the ISO 3200 suggestion (50); applied holds 65.
    const drifted = renderAdjust(
      { ...DEFAULT_EDIT, denoise: APPLIED },
      makePhoto(3200),
      assist({ state: 'applied', applied: APPLIED, hasBase: true }),
    );
    expect(drifted).toContain('data-testid="denoise-draft-diff"');
    expect(drifted).toContain('Draft 50 differs from applied 65 — preview it below before applying.');
    // A draft matching the applied strength shows no such note.
    const matching = renderAdjust(
      { ...DEFAULT_EDIT, denoise: { strength: 50, auto: true, source: 'onnx' } },
      makePhoto(3200),
      assist({ state: 'applied', applied: { strength: 50, auto: true, source: 'onnx' }, hasBase: true }),
    );
    expect(matching).not.toContain('data-testid="denoise-draft-diff"');
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

  it('lives in its own Denoise section, with no inner heading of its own', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).toContain('<h3>Denoise</h3><span class="ml-badge"');
    const heading = html.indexOf('<h3>Denoise</h3>');
    const control = html.indexOf('data-testid="denoise"');
    expect(control).toBeGreaterThan(heading);
    // The section header carries the title + ML badge, so the control
    // renders no duplicate inner heading.
    expect(html).not.toContain('denoise-head');
    // Below the histogram, with the other ML actions — the histogram leads the panel.
    expect(control).toBeGreaterThan(html.indexOf('histogram-section'));
  });

  it('uses a slim preview button like the other ML actions', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).toContain('class="slim-button full-width" data-testid="denoise-preview"');
    expect(html).not.toContain('secondary-button');
  });

  it('shows a centered 4x closeup under the small preview pair', () => {
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
    expect(html).toContain('Before · 4×');
    expect(html).toContain('After · 4×');
    expect(html).toContain('Noisy closeup at 4x magnification');
    expect(html).toContain('Denoised closeup at 4x magnification');
    // Default loupe sits on the center until the user clicks the preview.
    expect(html).toContain('background-position:50% 50%');
    expect(html).toContain('Click to move the 4× closeup');
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
    expect(html).toContain('data-testid="denoise-compare-hint"');
    expect(html).toContain('On the photo, Compare (B in the toolbar) toggles the noisy original against this clean photo.');
  });

  it('magnifies the closeup boxes 4x without tiling', () => {
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
    const rule = readFileSync(cssPath, 'utf8').match(/\.denoise-zoom\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/background-size\s*:\s*400%/);
    expect(rule).toMatch(/background-repeat\s*:\s*no-repeat/);
  });

  it('lays the suggestion row out in flex and titles the preview like its siblings', () => {
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
    const css = readFileSync(cssPath, 'utf8');
    const suggest = css.match(/\.denoise-suggest-row\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(suggest).toMatch(/display\s*:\s*flex/);
    expect(suggest).toMatch(/justify-content\s*:\s*space-between/);
    const title = css.match(/\.denoise-preview-title\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(title).toMatch(/text-transform\s*:\s*uppercase/);
    // The locking-toggle row is gone; notes use the sibling 8px rhythm.
    expect(css).not.toMatch(/\.denoise-auto-row\s*\{/);
    expect(css).toMatch(/\.denoise \.inspector-note\s*\{[^}]*margin:\s*8px 0 0/);
  });
});
