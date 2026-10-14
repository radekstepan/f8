import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';
import { Inspector } from './Inspector.js';
import type {
  DenoiseAssist,
  DustSpotsAssist,
  FaceEnhanceAssist,
  ObjectRemovalAssist,
  RepairAssist,
  SelectiveMaskAssist,
  StraightenAssist,
} from './Inspector.js';

// Cancel / Cancel repair / Dismiss padding + alignment, rendered on the
// server (no jsdom): pins that every in-content dismissive control sits in
// the shared .suggestion-actions row — never a bare link under a progress
// note — and pins the row's spacing rules. Modal Cancel buttons are dialog
// chrome (Task 13 boundary) and keep their footer style.

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
  onResetWhiteBalance: noop,
  onResetLightness: noop,
  onResetColor: noop,
  onCopy: noop,
  onPaste: noop,
  onSavePreset: noop,
  onBrushSize: noop,
  onBrushStrength: noop,
  onClose: noop,
} as const;

function renderRepair(removal?: ObjectRemovalAssist, dustSpots?: DustSpotsAssist, repairOverrides: Partial<RepairAssist> = {}): string {
  const repairAssist: RepairAssist = {
    method: 'heal',
    quality: 'balanced',
    seamlessLight: false,
    featherPx: 2,
    status: 'ready',
    mlProgress: null,
    serverDown: false,
    onRetry: noop,
    onMethodChange: noop,
    onQualityChange: noop,
    onSeamlessLightChange: noop,
    onFeatherChange: noop,
    ...repairOverrides,
    ...(removal === undefined ? {} : { removal }),
    ...(dustSpots === undefined ? {} : { dustSpots }),
  };
  return renderToStaticMarkup(
    <Inspector photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} tool="repair" repairAssist={repairAssist} {...INSPECTOR_PROPS} />,
  );
}

function renderAdjust(edit: EditState, assists: { faceAssist?: FaceEnhanceAssist; selectiveAssist?: SelectiveMaskAssist; denoiseAssist?: DenoiseAssist } = {}): string {
  return renderToStaticMarkup(
    <Inspector photo={makePhoto()} edit={edit} tool="adjust" {...assists} {...INSPECTOR_PROPS} />,
  );
}

function renderCrop(straightenAssist: StraightenAssist): string {
  return renderToStaticMarkup(
    <Inspector photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} tool="crop" straightenAssist={straightenAssist} {...INSPECTOR_PROPS} />,
  );
}

function idleRemoval(overrides: Partial<ObjectRemovalAssist> = {}): ObjectRemovalAssist {
  return {
    state: 'idle', detections: [], source: null, progress: null, note: null, message: null,
    onDetect: noop, onToggle: noop, onApply: noop, onDismiss: noop,
    ...overrides,
  };
}

function idleDustSpots(overrides: Partial<DustSpotsAssist> = {}): DustSpotsAssist {
  return {
    state: 'idle', spots: [], source: null, progress: null, note: null, message: null,
    onDetect: noop, onToggle: noop, onApply: noop, onDismiss: noop,
    ...overrides,
  };
}

function idleFace(overrides: Partial<FaceEnhanceAssist> = {}): FaceEnhanceAssist {
  return {
    state: 'idle', faces: 0, source: null, whiteBalance: null, skinAnchored: false,
    liftAmount: 0, redEyeCount: 0, progress: null, note: null, message: null, applied: null,
    onDetect: noop, onApply: noop, onToggle: noop, onClear: noop, onDismiss: noop,
    ...overrides,
  };
}

function idleSelective(overrides: Partial<SelectiveMaskAssist> = {}): SelectiveMaskAssist {
  return {
    state: 'idle', found: false, coverage: 0, source: null, progress: null,
    note: null, message: null, applied: null,
    onDetect: noop, onAdjust: noop, onToggle: noop, onClear: noop, onDismiss: noop,
    ...overrides,
  };
}

function idleDenoise(overrides: Partial<DenoiseAssist> = {}): DenoiseAssist {
  return {
    state: 'idle', preview: null, applied: null, hasBase: false, progress: null,
    note: null, message: null, onPreview: noop, onApply: noop, onClear: noop, onDismiss: noop,
    ...overrides,
  };
}

const ROW_OPEN = '<div class="suggestion-actions">';
const DIV_CLOSE = '</div>';
const DISMISSIVE_LABELS = ['>Cancel</button>', '>Dismiss</button>', '>Cancel repair</button>'];

// Action rows hold buttons only (no nested divs), so a dismissive label is
// inside a row exactly when the nearest preceding row-open beats the
// nearest preceding div-close.
function dismissiveOutsideRow(html: string): string[] {
  const outside: string[] = [];
  for (const label of DISMISSIVE_LABELS) {
    let from = 0;
    for (;;) {
      const at = html.indexOf(label, from);
      if (at === -1) break;
      const rowOpen = html.lastIndexOf(ROW_OPEN, at);
      const divClose = html.lastIndexOf(DIV_CLOSE, at);
      if (rowOpen === -1 || divClose > rowOpen) outside.push(`${label} at offset ${at}`);
      from = at + label.length;
    }
  }
  return outside;
}

function dismissiveCount(html: string): number {
  return DISMISSIVE_LABELS.reduce((total, label) => total + html.split(label).length - 1, 0);
}

function expectAligned(cases: Array<[string, string, number]>) {
  for (const [name, html, expected] of cases) {
    expect(dismissiveCount(html), `${name}: dismissive count`).toBe(expected);
    expect(dismissiveOutsideRow(html), `${name}: outside a row`).toEqual([]);
  }
}

const ACTIVE_PROGRESS = { fraction: 0.2, stage: 'Repairing…', job: 'heal' as const };

describe('cancel / dismiss alignment', () => {
  it('keeps every repair-tool Cancel, Dismiss, and Cancel repair in the shared action row', () => {
    const listed = idleRemoval({
      state: 'ready',
      detections: [{ label: 'person', score: 0.9, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, checked: true }],
      source: 'onnx',
    });
    const spotted = idleDustSpots({
      state: 'ready',
      spots: [{ x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: true }],
      source: 'ml',
    });
    expectAligned([
      ['people detecting', renderRepair(idleRemoval({ state: 'detecting', progress: ACTIVE_PROGRESS })), 1],
      ['people empty', renderRepair(idleRemoval({ state: 'ready' })), 1],
      ['people listed', renderRepair(listed), 1],
      ['people error', renderRepair(idleRemoval({ state: 'error', message: 'Model download failed: HTTP 404.' })), 1],
      ['dust detecting', renderRepair(undefined, idleDustSpots({ state: 'detecting', progress: ACTIVE_PROGRESS })), 1],
      ['dust empty', renderRepair(undefined, idleDustSpots({ state: 'ready' })), 1],
      ['dust listed', renderRepair(undefined, spotted), 1],
      ['dust error', renderRepair(undefined, idleDustSpots({ state: 'error', message: 'Photo server unreachable.' })), 1],
    ]);
  });

  it('renders Cancel repair in the shared row, not as a bare link under the progress note', () => {
    const html = renderRepair(undefined, undefined, { method: 'ml-heal', mlProgress: ACTIVE_PROGRESS, onCancelHeal: noop });
    expect(dismissiveCount(html)).toBe(1);
    expect(html).toContain(`${ROW_OPEN}<button class="text-button" data-testid="ml-cancel"`);
    expect(dismissiveOutsideRow(html)).toEqual([]);
  });

  it('keeps every adjust-tool Cancel and Dismiss in the shared action row', () => {
    const faceReady = idleFace({
      state: 'ready', faces: 2, source: 'onnx',
      whiteBalance: { temperature: 5600, tint: 4 }, skinAnchored: true, liftAmount: 0.4, redEyeCount: 1,
    });
    const denoiseReady = idleDenoise({
      state: 'preview-ready',
      preview: { beforeUrl: 'data:before', afterUrl: 'data:after', strength: 65, source: 'onnx' },
    });
    expectAligned([
      ['face detecting', renderAdjust({ ...DEFAULT_EDIT }, { faceAssist: idleFace({ state: 'detecting', progress: null }) }), 1],
      ['face empty', renderAdjust({ ...DEFAULT_EDIT }, { faceAssist: idleFace({ state: 'ready', faces: 0, source: 'onnx' }) }), 1],
      ['face ready', renderAdjust({ ...DEFAULT_EDIT }, { faceAssist: faceReady }), 1],
      ['face error', renderAdjust({ ...DEFAULT_EDIT }, { faceAssist: idleFace({ state: 'error', message: 'Photo server unreachable.' }) }), 1],
      ['selective detecting', renderAdjust({ ...DEFAULT_EDIT }, { selectiveAssist: idleSelective({ state: 'detecting', progress: null }) }), 1],
      ['selective empty', renderAdjust({ ...DEFAULT_EDIT }, { selectiveAssist: idleSelective({ state: 'ready', found: false, source: 'onnx' }) }), 1],
      ['selective error', renderAdjust({ ...DEFAULT_EDIT }, { selectiveAssist: idleSelective({ state: 'error', message: 'Photo server unreachable.' }) }), 1],
      ['denoise working', renderAdjust({ ...DEFAULT_EDIT }, { denoiseAssist: idleDenoise({ state: 'previewing', progress: ACTIVE_PROGRESS }) }), 1],
      ['denoise preview-ready', renderAdjust({ ...DEFAULT_EDIT }, { denoiseAssist: denoiseReady }), 1],
      ['denoise error', renderAdjust({ ...DEFAULT_EDIT }, { denoiseAssist: idleDenoise({ state: 'error', message: 'Photo server unreachable.' }) }), 1],
    ]);
  });

  it('renders the straighten warmup cancel in the shared row too', () => {
    const html = renderCrop({
      state: 'detecting', angle: null, confidence: null, message: null, snapshot: null,
      mlProgress: { fraction: 0.1, stage: 'Warming up…' }, mlWarming: true,
      onDetect: noop, onDismiss: noop, onRevert: noop, onCancelMl: noop,
    });
    expect(dismissiveCount(html)).toBe(1);
    expect(html).toContain(`${ROW_OPEN}<button class="text-button" data-testid="ml-cancel"`);
    expect(dismissiveOutsideRow(html)).toEqual([]);
  });

  it('spaces the shared row 10px below its note with equal 27px links', () => {
    const row = cssRule('.suggestion-actions');
    expect(row).toMatch(/display\s*:\s*flex/);
    expect(row).toMatch(/gap\s*:\s*8px/);
    expect(row).toMatch(/margin-top\s*:\s*10px/);
    const link = cssRule('.suggestion-actions > button');
    expect(link).toMatch(/flex\s*:\s*1/);
    expect(link).toMatch(/height\s*:\s*27px/);
    expect(link).toMatch(/font-size\s*:\s*9\.5px/);
    // No one-off row spacing survives anywhere: the boxed error row uses
    // the same 10px as every other Dismiss row.
    expect(css()).not.toContain('.assist-message .suggestion-actions');
  });

  it('leaves dialog Cancel buttons and inline applied rows on their own treatments', () => {
    // Modal footers are dialog chrome (Task 13 boundary): grey Cancel,
    // right-aligned footer, untouched.
    const album = renderToStaticMarkup(
      <EditorDialogs dialog="album" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} />,
    );
    expect(album).toContain('<div class="modal-footer"><button class="secondary-button" type="button">Cancel</button>');
    // Rescan/Clear ride inline in applied status rows next to the toggle,
    // so their compact override stays.
    expect(cssRule('.face-enhance-row .suggestion-actions')).toMatch(/margin\s*:\s*0 0 0 auto/);
    expect(cssRule('.selective-mask-row .suggestion-actions')).toMatch(/margin\s*:\s*0 0 0 auto/);
  });
});
