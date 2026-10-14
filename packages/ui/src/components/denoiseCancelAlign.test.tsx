import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { DenoiseState, EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, RepairAssist } from './Inspector.js';

// Denoise Cancel + action alignment, rendered on the server (no jsdom):
// pins that the preview-ready Cancel exists in the shared action row (its
// handler used to be a state-machine no-op — see dismissDenoiseStatus in
// @f8/core) and that every in-content tool action sits in a shared
// .suggestion-actions row — block rows full-width stretched, inline rows
// (alert/applied status lines) compact and right-pushed. Header actions
// (.section-actions chrome) and the straighten status row are out of scope.

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
    iso: 3200,
    aperture: 'f/8',
    shutter: '1/250',
    focalLength: '35mm',
    raw: false,
    favorite: false,
    rating: 0,
  };
}

const noop = () => {};

const INSPECTOR_PROPS = {
  histogram: null,
  brushSize: 45,
  brushStrength: 100,
  canPaste: false,
  onChange: noop,
  onRotate: noop,
  onStraighten: noop,
  onReset: noop,
  onAuto: noop,
  onRevertEnhance: noop,
  onAutoWhiteBalance: noop,
  onAutoLightness: noop,
  onAutoColor: noop,
  onRevertWhiteBalance: noop,
  onRevertLightness: noop,
  onRevertColor: noop,
  onCopy: noop,
  onPaste: noop,
  onSavePreset: noop,
  onBrushSize: noop,
  onBrushStrength: noop,
  onClose: noop,
} as const;

function idleDenoise(overrides: Partial<DenoiseAssist> = {}): DenoiseAssist {
  return {
    state: 'idle', preview: null, applied: null, hasBase: false, progress: null,
    note: null, message: null, onPreview: noop, onApply: noop, onClear: noop, onDismiss: noop,
    ...overrides,
  };
}

function renderAdjust(edit: EditState, denoiseAssist: DenoiseAssist): string {
  return renderToStaticMarkup(
    <Inspector photo={makePhoto()} edit={edit} tool="adjust" denoiseAssist={denoiseAssist} {...INSPECTOR_PROPS} />,
  );
}

function renderOfflineRepair(): string {
  const repairAssist: RepairAssist = {
    method: 'ml-heal', quality: 'balanced', seamlessLight: false, featherPx: 2,
    status: 'ready', mlProgress: null, serverDown: true,
    onRetry: noop, onMethodChange: noop, onQualityChange: noop,
    onSeamlessLightChange: noop, onFeatherChange: noop,
  };
  return renderToStaticMarkup(
    <Inspector photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} tool="repair" repairAssist={repairAssist} {...INSPECTOR_PROPS} />,
  );
}

const APPLIED: DenoiseState = { strength: 65, auto: true, source: 'onnx' };
const PREVIEW = { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 65, source: 'onnx' as const };

const ROW_OPEN = '<div class="suggestion-actions">';
const DIV_CLOSE = '</div>';

// Action rows hold buttons only (no nested divs), so a testid is inside a
// row exactly when the nearest preceding row-open beats the nearest
// preceding div-close.
function testIdInRow(html: string, testId: string): boolean {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at === -1) return false;
  const rowOpen = html.lastIndexOf(ROW_OPEN, at);
  const divClose = html.lastIndexOf(DIV_CLOSE, at);
  return rowOpen !== -1 && divClose < rowOpen;
}

function denoiseSection(html: string): string {
  return html.slice(html.indexOf('<h3>Denoise</h3>'), html.indexOf('<h3>White Balance</h3>'));
}

describe('denoise cancel', () => {
  it('gives the preview-ready Cancel a testid inside the shared action row', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      idleDenoise({ state: 'preview-ready', preview: PREVIEW }),
    );
    expect(html).toContain('data-testid="denoise-cancel-preview"');
    expect(html).toContain('>Cancel</button>');
    expect(testIdInRow(html, 'denoise-cancel-preview')).toBe(true);
    // The row still offers the full trio: apply, re-preview, cancel.
    expect(testIdInRow(html, 'denoise-apply')).toBe(true);
    expect(testIdInRow(html, 'denoise-repreview')).toBe(true);
  });

  it('keeps the working Cancel in the shared row while a run is in flight', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      idleDenoise({ state: 'previewing', progress: { fraction: 0.2, stage: 'Denoising…' } }),
    );
    expect(testIdInRow(html, 'denoise-cancel')).toBe(true);
  });
});

describe('action alignment', () => {
  it('renders the idle Preview in the shared row, never as a bare full-width button', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, idleDenoise());
    expect(html).toContain('<div class="suggestion-actions"><button class="text-button" data-testid="denoise-preview"');
    expect(testIdInRow(html, 'denoise-preview')).toBe(true);
    expect(denoiseSection(html)).not.toContain('full-width');
    // The one-off denoise button rule is gone with the bare button.
    expect(css()).not.toMatch(/\.denoise > \.text-button\.full-width\s*\{/);
  });

  it('keeps every denoise phase on the shared row — no bare or floated actions', () => {
    const cases: Array<[string, string]> = [
      ['idle', renderAdjust({ ...DEFAULT_EDIT }, idleDenoise())],
      ['working', renderAdjust({ ...DEFAULT_EDIT }, idleDenoise({ state: 'previewing', progress: { fraction: 0.2, stage: 'Denoising…' } }))],
      ['preview-ready', renderAdjust({ ...DEFAULT_EDIT }, idleDenoise({ state: 'preview-ready', preview: PREVIEW }))],
      ['applied', renderAdjust({ ...DEFAULT_EDIT, denoise: APPLIED }, idleDenoise({ state: 'applied', applied: APPLIED, hasBase: true }))],
      ['stale', renderAdjust({ ...DEFAULT_EDIT, denoise: APPLIED }, idleDenoise({ state: 'applied', applied: APPLIED, hasBase: false }))],
      ['error', renderAdjust({ ...DEFAULT_EDIT }, idleDenoise({ state: 'error', message: 'Photo server unreachable.' }))],
    ];
    for (const [name, html] of cases) {
      const section = denoiseSection(html);
      expect(section, `${name}: has an action row`).toContain(ROW_OPEN);
      expect(section, `${name}: no bare full-width action`).not.toContain('full-width');
      expect(section, `${name}: no grey buttons`).not.toContain('slim-button');
      expect(section, `${name}: no grey buttons`).not.toContain('secondary-button');
    }
  });

  it('block rows stretch full-width with centered golden links', () => {
    const row = cssRule('.suggestion-actions');
    expect(row).toMatch(/display\s*:\s*flex/);
    expect(row).toMatch(/margin-top\s*:\s*10px/);
    expect(cssRule('.suggestion-actions > button')).toMatch(/flex\s*:\s*1/);
    expect(cssRule('.text-button')).toMatch(/justify-content\s*:\s*center/);
  });

  it('keeps the offline Retry in a compact right-pushed row, like the applied rows', () => {
    const html = renderOfflineRepair();
    expect(html).toContain('data-testid="ml-offline"');
    expect(html).toContain('<div class="suggestion-actions"><button class="text-button" data-testid="ml-retry"');
    expect(testIdInRow(html, 'ml-retry')).toBe(true);
    // Inline rows share one treatment: no top margin (they ride a status
    // line), pushed right, buttons compact.
    for (const selector of ['.face-enhance-row', '.selective-mask-row', '.ml-offline']) {
      expect(cssRule(`${selector} .suggestion-actions`), selector).toMatch(/margin\s*:\s*0 0 0 auto/);
      expect(cssRule(`${selector} .suggestion-actions > button`), selector).toMatch(/flex\s*:\s*none/);
      expect(cssRule(`${selector} .suggestion-actions > button`), selector).toMatch(/height\s*:\s*auto/);
    }
  });
});
