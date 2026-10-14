import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DustSpotsAssist, FaceEnhanceAssist, ObjectRemovalAssist, RepairAssist, SelectiveMaskAssist } from './Inspector.js';

// Section-leading description alignment, rendered on the server (no
// jsdom): the assist descriptions (Classify the scene, Finds faces, …) used
// to sit 8px below the section header while the first slider label
// (Temperature, Exposure) starts flush — so every description-led
// section looked sunken next to its slider siblings. Leading notes now
// start flush like the first slider label; notes below other controls
// keep the generic 8px rhythm.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*{([^}]*)}`))?.[1] ?? '';
};

/** The declaration block of the multi-selector leading-note rule. */
const leadingNoteBlock = (): { selectors: string; declarations: string } => {
  const text = css();
  const start = text.indexOf('.scene-enhance > .inspector-note:first-child');
  if (start === -1) return { selectors: '', declarations: '' };
  const open = text.indexOf('{', start);
  const close = text.indexOf('}', open);
  return { selectors: text.slice(start, open), declarations: text.slice(open + 1, close) };
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

function faceAssist(): FaceEnhanceAssist {
  return {
    state: 'idle', faces: 0, source: null, whiteBalance: null, skinAnchored: false,
    liftAmount: 0, redEyeCount: 0, progress: null, note: null, message: null, applied: null,
    onDetect: noop, onApply: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function selectiveAssist(): SelectiveMaskAssist {
  return {
    state: 'idle', found: false, coverage: 0, source: null, progress: null,
    note: null, message: null, applied: null,
    onDetect: noop, onAdjust: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function removalAssist(): ObjectRemovalAssist {
  return {
    state: 'idle', detections: [], source: null, progress: null, note: null, message: null,
    onDetect: noop, onToggle: noop, onApply: noop, onDismiss: noop,
  };
}

function dustSpotsAssist(): DustSpotsAssist {
  return {
    state: 'idle', spots: [], source: null, progress: null, note: null, message: null,
    onDetect: noop, onToggle: noop, onApply: noop, onDismiss: noop,
  };
}

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
      onAutoScene={noop}
      faceAssist={faceAssist()}
      selectiveAssist={selectiveAssist()}
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

function renderRepair(): string {
  const repairAssist: RepairAssist = {
    method: 'heal', quality: 'balanced', seamlessLight: false, featherPx: 2, status: 'ready',
    mlProgress: null, serverDown: false, onRetry: noop, onMethodChange: noop,
    onQualityChange: noop, onSeamlessLightChange: noop, onFeatherChange: noop,
    removal: removalAssist(), dustSpots: dustSpotsAssist(),
  };
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool="repair"
      histogram={null}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      repairAssist={repairAssist}
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

describe('adjustment description alignment', () => {
  it('starts the first slider label flush with the content top', () => {
    // The alignment target: no top padding on the content box, no top
    // margin on the first slider — Temperature/Exposure begin at the
    // header edge, and the descriptions must meet them there.
    expect(cssRule('.adjustment-content')).toMatch(/padding\s*:\s*0 20px 9px/);
    expect(cssRule('.range-control')).not.toMatch(/margin/);
  });

  it('sits every section-leading description flush, like the first slider label', () => {
    const { selectors, declarations } = leadingNoteBlock();
    // One rule covers every description-led section — the three Adjust
    // ML sections plus the two Repair detection sections, which share
    // the .object-removal wrapper.
    for (const wrapper of ['.scene-enhance', '.face-enhance', '.selective-mask', '.object-removal'] as const) {
      expect(selectors).toContain(`${wrapper} > .inspector-note:first-child`);
    }
    expect(declarations).toMatch(/margin-top\s*:\s*0/);
    // The removal wrapper itself adds no gap either: it used to push its
    // note 4px down on top of the note's own 8px.
    expect(cssRule('.object-removal')).toMatch(/margin-top\s*:\s*0/);
    // The applied scene label is the same section's leading text once
    // enhance runs — flush too, so applying never shifts the row down.
    expect(cssRule('.scene-enhance .scene-enhance-scene')).toMatch(/margin-top\s*:\s*0/);
  });

  it('keeps the 8px rhythm for notes below other controls', () => {
    // Only the leading note aligns flush: mid-content notes (draft
    // hints, how-it-works, status lines under a slider or button) keep
    // the generic separating margin.
    expect(cssRule('.inspector-note')).toMatch(/margin\s*:\s*8px 0 0/);
  });

  it('renders each Adjust description as the leading note its selector expects', () => {
    // The flush rule keys on :first-child — if the markup ever puts
    // another element before the note, the selector silently stops
    // matching. Pin the order, not just the text.
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).toContain(
      '<div class="scene-enhance" data-testid="scene-enhance"><p class="inspector-note">Classify the scene automatically',
    );
    expect(html).toContain(
      '<div class="face-enhance" data-testid="face-enhance"><p class="inspector-note">Finds faces with ML',
    );
    expect(html).toContain(
      '<div class="selective-mask" data-testid="selective-mask"><p class="inspector-note">Finds the subject with ML',
    );
  });

  it('renders each Repair detection description as the leading note its selector expects', () => {
    const html = renderRepair();
    expect(html).toContain(
      '<div class="object-removal" data-testid="object-removal"><p class="inspector-note">Finds people with ML',
    );
    expect(html).toContain(
      '<div class="object-removal dust-spots" data-testid="dust-spots"><p class="inspector-note">Scans for dust and spots automatically',
    );
  });
});
