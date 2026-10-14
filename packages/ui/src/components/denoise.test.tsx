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

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

function makePhoto(iso = 3200, name = 'DSC06308.ARW'): Photo {
  return {
    id: 'p1',
    name,
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

  it('starts high-ISO captures on the auto suggestion with Auto off until applied', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).toContain('data-testid="denoise"');
    expect(html).toContain('data-testid="denoise-strength"');
    expect(html).toContain('data-testid="denoise-preview"');
    expect(html).toContain('Suggested for ISO 3200: 50');
    expect(html).toContain('Auto 50 — drag the slider to fine-tune');
    // The draft starts on the ISO suggestion, but the shared header Auto
    // button (a heuristic, not a model run) stays OFF: nothing is stored
    // yet, and a lit toggle would read as "denoise is on". The slider
    // stays enabled so the suggestion flows into fine-tuning.
    expect(html).toContain('class="auto-small" data-testid="denoise-auto"');
    const autoTag = html.match(/<button[^>]*data-testid="denoise-auto"[^>]*>/)?.[0] ?? '';
    expect(autoTag).toContain('aria-pressed="false"');
    expect(autoTag).not.toContain('disabled');
    expect(html).toContain('data-tooltip="Set strength to the ISO 3200 suggestion (50)"');
    expect(html).toContain('>Auto</button>');
  });

  it('lights Auto only while the stored denoise is the untouched suggestion', () => {
    // The reported case: DSC06322.ARW at ISO 6400 with an auto denoise
    // stored — the lit toggle now means a stored effect, like every other
    // section, and offers to turn it off.
    const stored = renderAdjust(
      { ...DEFAULT_EDIT, denoise: APPLIED },
      makePhoto(6400, 'DSC06322.ARW'),
      assist({ state: 'applied', applied: APPLIED, hasBase: true }),
    );
    expect(stored).toContain('class="auto-small is-active" data-testid="denoise-auto"');
    expect(stored).toContain('aria-pressed="true"');
    expect(stored).toContain('data-tooltip="Auto denoise 65 applied — click to turn off"');
    // Same photo, nothing stored: Auto stays off even at ISO 6400.
    const fresh = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(6400, 'DSC06322.ARW'), assist());
    expect(fresh).toContain('class="auto-small" data-testid="denoise-auto"');
    expect(fresh).toContain('data-tooltip="Set strength to the ISO 6400 suggestion (65)"');
  });

  it('leaves Auto off for a stored manual denoise', () => {
    const manual: DenoiseState = { strength: 65, auto: false, source: 'onnx' };
    const html = renderAdjust(
      { ...DEFAULT_EDIT, denoise: manual },
      makePhoto(3200),
      assist({ state: 'applied', applied: manual, hasBase: true }),
    );
    expect(html).toContain('data-testid="denoise-applied"');
    expect(html).toContain('class="auto-small" data-testid="denoise-auto"');
    expect(html).toContain('data-tooltip="Set strength to the ISO 3200 suggestion (50)"');
  });

  it('starts clean captures on a manual strength with auto disabled', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(100), assist());
    expect(html).toContain('Draft strength — Preview, then Apply, to change the photo');
    expect(html).toContain('data-testid="denoise-preview"');
    expect(html).toContain('ISO 100 looks clean — no suggestion');
    expect(html).toContain('class="auto-small" data-testid="denoise-auto"');
    expect(html).toContain('data-tooltip="ISO 100 needs no denoise"');
    const autoTag = html.match(/<button[^>]*data-testid="denoise-auto"[^>]*>/)?.[0] ?? '';
    expect(autoTag).toContain('disabled');
    // The slider itself is never locked: only the suggestion-less auto is off.
    expect(html).not.toContain('range-control is-disabled');
  });

  it('explains the draft → preview → apply flow where the idle button lives', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(html).toContain('How it works: 1) pick a strength, 2) Preview shows a small before/after below in this panel, 3) Apply denoises the full photo. Only the strength is saved.');
    expect(html).toContain('data-tooltip="Show strength 50 as a small before/after below, in this panel"');
  });

  it('shows an After-only first row with a focus rect, then apply and the ML tag', () => {
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
    // First row is the After image alone — the before/after comparison
    // lives in the 16× closeup pair below.
    expect(html).toContain('data-testid="denoise-after"');
    expect(html).not.toContain('data-testid="denoise-before"');
    expect(html).not.toContain('<figcaption>Before</figcaption>');
    expect(html).toContain('<figcaption>After</figcaption>');
    // The focus rect overlays the After image at the default centered loupe.
    expect(html).toContain('data-testid="denoise-focus-rect"');
    const rectTag = html.match(/<div[^>]*data-testid="denoise-focus-rect"[^>]*>/)?.[0] ?? '';
    expect(rectTag).toContain('aria-hidden="true"');
    expect(rectTag).toContain('left:50%');
    expect(rectTag).toContain('top:50%');
    // The rect wraps the After image (positioning context), before its caption.
    const wrap = html.indexOf('class="denoise-after-wrap"');
    expect(wrap).toBeGreaterThan(-1);
    expect(wrap).toBeLessThan(html.indexOf('data-testid="denoise-focus-rect"'));
    expect(html).toContain('Preview 65 · ML');
    expect(html).toContain('data-testid="denoise-apply"');
    expect(html).toContain('Apply to photo');
    // Apply follows the draft slider (50 here), so its title names it.
    expect(html).toContain('data-tooltip="Denoise the full photo at strength 50 and edit from the clean pixels"');
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
    expect(html).toContain('<h3>Denoise</h3></button>');
    const heading = html.indexOf('<h3>Denoise</h3>');
    const control = html.indexOf('data-testid="denoise"');
    expect(control).toBeGreaterThan(heading);
    // The section header carries the title + Auto action, so the control
    // renders no duplicate inner heading.
    expect(html).not.toContain('denoise-head');
    // Below the histogram, with the other ML actions — the histogram leads the panel.
    expect(control).toBeGreaterThan(html.indexOf('histogram-section'));
  });

  it('runs the suggestion from a right-aligned header Auto button, never an ML button', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    // The header action drafts the ISO suggestion (a heuristic, not a
    // model run), so it carries the Auto pill like the slider autos — the
    // suggestion text stays as a plain row, and no content Auto pill remains.
    const tail = html.slice(html.indexOf('<h3>Denoise</h3>'));
    expect(tail).toContain('data-testid="denoise-auto"');
    expect(tail).not.toContain('data-testid="denoise-ml"');
    expect(tail).not.toContain('>ML</button>');
    expect(html).toContain('data-testid="denoise-suggest-row"');
    expect(html).toContain('Suggested for ISO 3200: 50');
    // The Auto action sits in the shared header row (badge gone) and closes
    // it, like every other header action.
    const header = html.slice(html.indexOf('<h3>Denoise</h3>'), html.indexOf('data-testid="denoise"'));
    expect(header).toContain('section-actions');
    expect(header).toContain('data-testid="denoise-auto"');
    expect(header).not.toContain('ml-badge');
    const after = html.slice(html.indexOf('data-testid="denoise-auto"'), html.indexOf('data-testid="denoise-auto"') + 400);
    expect(after).toMatch(/data-testid="denoise-auto"[^>]*>Auto<\/button><\/div>/);
    // The row itself is pushed right, and the idle tooltip names the
    // suggestion the button fills into the draft.
    const actions = cssRule('.section-actions');
    expect(actions).toMatch(/margin-left\s*:\s*auto/);
    expect(html).toContain('data-tooltip="Set strength to the ISO 3200 suggestion (50)"');
  });

  it('offers a persistent header reset exactly while a denoise is stored', () => {
    // Stored denoise, fresh or stale (session pixels dropped after reload):
    // the reset stays visible and sits left of the Auto button.
    for (const stored of [
      assist({ state: 'applied', applied: APPLIED, hasBase: true }),
      assist({ state: 'applied', applied: APPLIED, hasBase: false }),
    ]) {
      const html = renderAdjust({ ...DEFAULT_EDIT, denoise: APPLIED }, makePhoto(3200), stored);
      expect(html).toContain('section-reset is-dirty" data-tooltip="Reset denoise"');
      expect(html.indexOf('aria-label="Reset denoise"')).toBeLessThan(html.indexOf('data-testid="denoise-auto"'));
    }
    // Nothing stored: no header reset at all (nothing to restore).
    const idle = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(idle).not.toContain('aria-label="Reset denoise"');
  });

  it('renders every denoise action as a golden link, never a grey button', () => {
    // Idle: the preview action is a full-width golden link.
    const idle = renderAdjust({ ...DEFAULT_EDIT }, makePhoto(3200), assist());
    expect(idle).toContain('class="text-button full-width" data-testid="denoise-preview"');
    // Preview-ready: Apply joins the Update/Cancel links in one text row.
    const ready = renderAdjust(
      { ...DEFAULT_EDIT },
      makePhoto(3200),
      assist({
        state: 'preview-ready',
        preview: { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 65, source: 'onnx' },
      }),
    );
    expect(ready).toContain('class="text-button" data-testid="denoise-apply"');
    // Stale (recipe outlives the session pixels): Restore is a link too.
    const stale = renderAdjust(
      { ...DEFAULT_EDIT, denoise: APPLIED },
      makePhoto(3200),
      assist({ state: 'applied', applied: APPLIED, hasBase: false }),
    );
    expect(stale).toContain('class="text-button" data-testid="denoise-restore"');
    // No grey-button class survives anywhere in the Denoise section, in any
    // of the three states above (the header ML pill + reset icon are not
    // in-content actions and keep their own styles).
    for (const html of [idle, ready, stale]) {
      const section = html.slice(html.indexOf('<h3>Denoise</h3>'), html.indexOf('<h3>White Balance</h3>'));
      expect(section).not.toContain('slim-button');
      expect(section).not.toContain('secondary-button');
    }
  });

  it('styles the golden link idle gold, dims it when disabled, and never lights a disabled hover', () => {
    // The link color is the action gold; the idle preview link keeps its
    // 10px top rhythm below the hint (the rule followed the class swap).
    expect(cssRule('.text-button')).toMatch(/color\s*:\s*#b8a279/);
    expect(cssRule('.denoise > .text-button.full-width')).toMatch(/margin-top\s*:\s*10px/);
    expect(css()).not.toMatch(/\.denoise > \.slim-button\.full-width\s*\{/);
    // The preview link disables at strength 0 — the first disabled
    // text-button anywhere — so it dims like a slim button did and the
    // hover brightening explicitly skips disabled, like every other
    // button rule in the sheet.
    expect(cssRule('.text-button:disabled')).toMatch(/opacity\s*:\s*\.45/);
    expect(cssRule('.text-button:disabled')).toMatch(/cursor\s*:\s*default/);
    expect(css()).toMatch(/\.text-button:hover:not\(:disabled\)\s*\{[^}]*color\s*:\s*#f0d496/);
  });

  it('shows a centered 16x closeup pair under the After-only first row', () => {
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
    expect(html).toContain('Before · 16×');
    expect(html).toContain('After · 16×');
    expect(html).toContain('Noisy closeup at 16x magnification');
    expect(html).toContain('Denoised closeup at 16x magnification');
    // Default loupe sits on the center until the user clicks the preview.
    expect(html).toContain('background-position:50% 50%');
    expect(html).toContain('Click to move the 16× closeup');
    // Closeup pair renders below the After-only first row.
    expect(html.indexOf('data-testid="denoise-closeup"')).toBeGreaterThan(html.indexOf('data-testid="denoise-after"'));
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

  it('magnifies the closeup boxes 16x without tiling', () => {
    const rule = cssRule('.denoise-zoom');
    expect(rule).toMatch(/background-size\s*:\s*1600%/);
    expect(rule).toMatch(/background-repeat\s*:\s*no-repeat/);
  });

  it('overlays a 1/16 focus square on the After image without stealing clicks', () => {
    const wrap = cssRule('.denoise-after-wrap');
    expect(wrap).toMatch(/position\s*:\s*relative/);
    const rect = cssRule('.denoise-focus-rect');
    // 1/16 of the preview width, square on screen = exactly the sampled patch.
    expect(rect).toMatch(/position\s*:\s*absolute/);
    expect(rect).toMatch(/width\s*:\s*6\.25%/);
    expect(rect).toMatch(/aspect-ratio\s*:\s*1\s*\/\s*1/);
    expect(rect).toMatch(/transform\s*:\s*translate\(-50%,\s*-50%\)/);
    // Visible on any photo, and clicks pass through to the loupe mover.
    expect(rect).toMatch(/border\s*:/);
    expect(rect).toMatch(/box-shadow\s*:/);
    expect(rect).toMatch(/pointer-events\s*:\s*none/);
  });

  it('lays the suggestion row out in flex and titles the preview like its siblings', () => {
    const suggest = cssRule('.denoise-suggest-row');
    expect(suggest).toMatch(/display\s*:\s*flex/);
    expect(suggest).toMatch(/justify-content\s*:\s*space-between/);
    const title = cssRule('.denoise-preview-title');
    expect(title).toMatch(/text-transform\s*:\s*uppercase/);
    // The locking-toggle row is gone; notes use the shared 8px rhythm from
    // the base rule — no per-section override remains.
    expect(css()).not.toMatch(/\.denoise-auto-row\s*\{/);
    expect(cssRule('.inspector-note')).toMatch(/margin\s*:\s*8px 0 0/);
    expect(css()).not.toMatch(/\.denoise \.inspector-note\s*\{/);
  });
});
