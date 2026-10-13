import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, InpaintMethod, Photo, SelectiveAdjustState } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, DustSpotsAssist, FaceEnhanceAssist, ObjectRemovalAssist, RepairAssist, SelectiveMaskAssist } from './Inspector.js';

// Adjustment styling consistency, rendered on the server (no jsdom): one
// place pinning the six complaints fixed together — heuristic header
// actions say Auto (ML is reserved for model runs), collapsing keeps the
// header action, description notes share one tight rhythm, the header
// reset never hides, headers carry no toggles, and Black & White resets
// to its default like every other section. Per-area behavior stays in the
// area test files; this file pins the cross-section contract only.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');
const source = (file: string) => readFileSync(resolve(here, file), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*{([^}]*)}`))?.[1] ?? '';
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

const APPLIED_SELECTIVE: SelectiveAdjustState = {
  maskB64: 'eA==',
  maskWidth: 4,
  maskHeight: 4,
  subject: { exposure: 0.5, contrast: 10, saturation: 0 },
  background: { exposure: 0, contrast: 0, saturation: 0 },
  source: 'onnx',
};

function faceAssist(applied: FaceEnhanceAssist['applied'] = null): FaceEnhanceAssist {
  return {
    state: 'idle', faces: 0, source: null, whiteBalance: null, skinAnchored: false,
    liftAmount: 0, redEyeCount: 0, progress: null, note: null, message: null, applied,
    onDetect: noop, onApply: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function selectiveAssist(applied: SelectiveMaskAssist['applied'] = null): SelectiveMaskAssist {
  return {
    state: 'idle', found: false, coverage: 0, source: null, progress: null,
    note: null, message: null, applied,
    onDetect: noop, onAdjust: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function denoiseAssist(): DenoiseAssist {
  return {
    state: 'idle', preview: null, applied: null, hasBase: false, progress: null,
    note: null, message: null, onPreview: noop, onApply: noop, onClear: noop, onDismiss: noop,
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

function renderAdjust(edit: EditState, ml?: { scene?: boolean; faceApplied?: FaceEnhanceAssist['applied']; selectiveApplied?: SelectiveMaskAssist['applied']; denoise?: boolean }): string {
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
      {...(ml?.scene ? { onAutoScene: noop } : {})}
      {...(ml?.faceApplied !== undefined ? { faceAssist: faceAssist(ml.faceApplied) } : {})}
      {...(ml?.selectiveApplied !== undefined ? { selectiveAssist: selectiveAssist(ml.selectiveApplied) } : {})}
      {...(ml?.denoise ? { denoiseAssist: denoiseAssist() } : {})}
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

function renderRepair(method: InpaintMethod): string {
  const repairAssist: RepairAssist = {
    method, quality: 'balanced', seamlessLight: false, featherPx: 2, status: 'ready',
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

/** Every header actions row in the markup (sections never nest). */
function actionsRows(html: string): string[] {
  return html.match(/<div class="section-actions">[\s\S]*?<\/div>/g) ?? [];
}

describe('adjustment styling consistency', () => {
  it('labels heuristic header actions Auto and model runs ML', () => {
    // The header Auto, the slider autos, and the denoise suggestion are
    // heuristics (no model runs when clicked); scene, faces, and subject
    // run a model. The header label names the engine, honestly either way.
    const html = renderAdjust({ ...DEFAULT_EDIT }, { scene: true, denoise: true, faceApplied: null, selectiveApplied: null });
    for (const id of ['auto-enhance', 'white-balance', 'lightness', 'color', 'denoise'] as const) {
      expect(html).toContain(`data-testid="${id}-auto"`);
      expect(html).not.toContain(`data-testid="${id}-ml"`);
    }
    for (const id of ['scene-enhance', 'face-enhance', 'selective-mask'] as const) {
      expect(html).toContain(`data-testid="${id}-ml"`);
      expect(html).not.toContain(`data-testid="${id}-auto"`);
    }
    // The repair tool's detection runs are models too.
    const repair = renderRepair('heal');
    expect(repair).toContain('data-testid="object-removal-ml"');
    expect(repair).toContain('data-testid="dust-spots-ml"');
    expect(repair).not.toContain('-auto"');
  });

  it('keeps the header action and reset rendered while collapsed', () => {
    // Collapsing hides the sliders, never the header controls — the Auto
    // action stays one click away, exactly like the reset.
    const html = renderToStaticMarkup(
      <AdjustmentSection
        title="Lightness"
        icon={<i />}
        ml={{ id: 'lightness', kind: 'auto', applied: false, canRevert: false, onToggle: noop, onRevert: noop }}
        onReset={noop}
        dirty
        open={false}
      >
        <span>slider-stub</span>
      </AdjustmentSection>,
    );
    expect(html).toContain('is-collapsed');
    expect(html).not.toContain('slider-stub');
    expect(html).toContain('data-testid="lightness-auto"');
    expect(html).toContain('aria-label="Reset lightness"');
  });

  it('gives every description note the same tight rhythm', () => {
    // The base note margin used to be 18px top / 9px bottom while five
    // sections overrode it to 8px top — so notes like the retired Auto
    // Enhance section's "Automatically enhance exposure…" floated in
    // padding its siblings never had. One tight base rule, zero overrides.
    expect(cssRule('.inspector-note')).toMatch(/margin\s*:\s*8px 0 0/);
    for (const selector of ['.object-removal .inspector-note', '.face-enhance .inspector-note', '.selective-mask .inspector-note', '.denoise .inspector-note', '.superres-field .inspector-note'] as const) {
      expect(cssRule(selector), `${selector} override is gone`).toBe('');
    }
    // The progress note keeps its own flush rhythm (bar above, nothing below).
    expect(cssRule('.ml-progress .inspector-note')).toMatch(/margin\s*:\s*0 0 2px/);
    // The relocated Auto Enhance carries no description note at all — a
    // header pill plus tooltip, not a padded section.
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).not.toContain('<h3>Auto Enhance</h3>');
    expect(html).not.toContain('Automatically enhance exposure, contrast, and color.');
  });

  it('never hides the header reset at any viewport', () => {
    // The reset used to vanish between 761–850px (a breakpoint display:none
    // with a mobile re-show) — a functional control must not depend on
    // window width. No display declaration on .section-reset anywhere now.
    expect(css()).not.toMatch(/\.section-reset[^{]*\{[^}]*display\s*:/);
    expect(cssRule('.section-reset')).not.toMatch(/display\s*:/);
  });

  it('keeps toggles out of headers: content bypass and setting switches only', () => {
    // No header carries a switch: the retired Black & White header toggle
    // duplicated its content button while offering no reset. Switches
    // remain only where they mean bypass-without-deleting (faces, subject)
    // or a plain setting (seamless light).
    const applied: NonNullable<FaceEnhanceAssist['applied']> = { faces: 2, source: 'onnx', enabled: true, liftAmount: 0.4, redEyeCount: 1 };
    const adjust = renderAdjust({ ...DEFAULT_EDIT }, { faceApplied: applied, selectiveApplied: { ...APPLIED_SELECTIVE, enabled: true } });
    const rows = actionsRows(adjust);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toContain('role="switch"');
    }
    expect(adjust).toContain('aria-label="Enable face enhance"');
    expect(adjust).toContain('aria-label="Enable subject and background enhance"');
    // The panel header's Auto group follows the same rule: pill plus
    // revert icon, no switch.
    const headerGroup = adjust.match(/<div class="inspector-auto-wrap">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(headerGroup.length).toBeGreaterThan(0);
    expect(headerGroup).not.toContain('role="switch"');
    const repair = renderRepair('heal');
    for (const row of actionsRows(repair)) {
      expect(row).not.toContain('role="switch"');
    }
    expect(repair).toContain('aria-label="Seamless light adaptation"');
  });

  it('resets Black & White to its actual default, like every other section', () => {
    // Enabled used to mean "no reset at all" for Black & White; now the
    // header reset restores color — and the restore target is pinned to
    // the recipe default, not a second hardcoded guess.
    expect(DEFAULT_EDIT.blackAndWhite).toBe(false);
    const inspector = source('Inspector.tsx');
    const start = inspector.indexOf('title="Black & White"');
    expect(start).toBeGreaterThan(-1);
    const blackAndWhite = inspector.slice(start, inspector.indexOf('</AdjustmentSection>', start));
    expect(blackAndWhite).toContain('onReset={() => onChange({ blackAndWhite: false })}');
    expect(blackAndWhite).toContain('dirty={edit.blackAndWhite}');
  });
});
