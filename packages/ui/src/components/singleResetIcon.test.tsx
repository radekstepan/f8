import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, DustSpotsAssist, FaceEnhanceAssist, ObjectRemovalAssist, RepairAssist, SelectiveMaskAssist, StraightenAssist } from './Inspector.js';

// No revert/reset icon in any adjustment header, rendered on the server
// (no jsdom): effects never run, so this pins the markup + prop wiring —
// every section header carries its switch (or ML/Auto button) alone, and
// the only reset icons left in the inspector live outside the section
// headers (the panel header's enhance revert, the crop tool's straighten
// revert) — not click behavior. This sweep guards every header against a
// reset icon creeping back in any state.

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

function faceApplied(): FaceEnhanceAssist {
  return {
    state: 'idle', faces: 2, source: 'onnx', whiteBalance: null, skinAnchored: true,
    liftAmount: 1, redEyeCount: 1, progress: null, note: null, message: null,
    applied: { faces: 2, source: 'onnx', enabled: true, liftAmount: 1, redEyeCount: 1 },
    onDetect: noop, onApply: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function selectiveApplied(): SelectiveMaskAssist {
  return {
    state: 'idle', found: true, coverage: 0.3, source: 'onnx', progress: null,
    note: null, message: null,
    applied: {
      maskB64: 'eA==',
      maskWidth: 4,
      maskHeight: 4,
      enabled: true,
      subject: { exposure: 0.2, contrast: 5, saturation: 5 },
      background: { exposure: -0.2, contrast: -5, saturation: -5 },
      source: 'onnx',
    },
    onDetect: noop, onAdjust: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function denoiseApplied(): DenoiseAssist {
  return {
    state: 'applied', preview: null, applied: { strength: 65, auto: true, source: 'onnx' },
    hasBase: true, progress: null, note: null, message: null,
    onPreview: noop, onApply: noop, onClear: noop, onDismiss: noop,
  };
}

/** Every slider off defaults, both enhance modes' flags set, one repair stamp. */
function fullyAppliedEdit(): EditState {
  return {
    ...DEFAULT_EDIT,
    temperature: 5800, tint: 6, exposure: 0.5, brightness: 10, contrast: -10, highlights: 20,
    shadows: -20, blacks: 5, saturation: 8, vibrance: 16, hue: -30, curve: 25,
    clarity: 20, sharpness: 30, grain: 10, vignette: 40, fade: 15,
    selectiveColor: [{ range: 'blues', hue: 0, saturation: -40, luminance: 0 }],
    autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 },
    retouches: [{ x: 0.5, y: 0.5, size: 20, strength: 100, kind: 'repair' }],
  };
}

function faceIdle(): FaceEnhanceAssist {
  return {
    state: 'idle', faces: 0, source: null, whiteBalance: null, skinAnchored: false,
    liftAmount: 0, redEyeCount: 0, progress: null, note: null, message: null, applied: null,
    onDetect: noop, onApply: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function selectiveIdle(): SelectiveMaskAssist {
  return {
    state: 'idle', found: false, coverage: 0, source: null, progress: null,
    note: null, message: null, applied: null,
    onDetect: noop, onAdjust: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function denoiseIdle(): DenoiseAssist {
  return {
    state: 'idle', preview: null, applied: null, hasBase: false, progress: null,
    note: null, message: null, onPreview: noop, onApply: noop, onClear: noop, onDismiss: noop,
  };
}

function renderAdjust(edit: EditState, enhanceMode: 'classic' | 'scene' | null, applied: boolean): string {
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
      onAutoScene={noop}
      enhanceMode={enhanceMode}
      enhancePure
      onRevertEnhance={noop}
      faceAssist={applied ? faceApplied() : faceIdle()}
      selectiveAssist={applied ? selectiveApplied() : selectiveIdle()}
      denoiseAssist={applied ? denoiseApplied() : denoiseIdle()}
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
  const removal: ObjectRemovalAssist = {
    state: 'ready', detections: [{ label: 'person', score: 0.9, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, checked: true }],
    source: 'onnx', progress: null, note: null, message: null,
    onDetect: noop, onToggle: noop, onApply: noop, onDismiss: noop,
  };
  const dustSpots: DustSpotsAssist = {
    state: 'ready', spots: [{ x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: true }],
    source: 'ml', progress: null, note: null, message: null,
    onDetect: noop, onToggle: noop, onApply: noop, onDismiss: noop,
  };
  const repairAssist: RepairAssist = {
    method: 'heal', quality: 'balanced', seamlessLight: false, featherPx: 2, status: 'ready',
    mlProgress: null, serverDown: false, onRetry: noop, onMethodChange: noop, onQualityChange: noop,
    onSeamlessLightChange: noop, onFeatherChange: noop, removal, dustSpots,
  };
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={fullyAppliedEdit()}
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

function renderCrop(snapshot: number | null): string {
  const straightenAssist: StraightenAssist = {
    state: 'ready', angle: 1.2, confidence: 0.9, source: 'classic', runId: 1,
    message: null, snapshot, onDetect: noop, onDismiss: noop, onRevert: noop,
  };
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool="crop"
      histogram={null}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      straightenAssist={straightenAssist}
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

interface HeaderAudit {
  title: string;
  collapsed: boolean;
  resets: number;
  reverts: number;
}

/** One row per adjustment section: revert/reset icons in the header only (never the content). */
function auditHeaders(html: string): HeaderAudit[] {
  // Sections never nest, so the first </section> closes the chunk; the
  // header is everything before the content div (collapsed sections have no
  // content div, so the whole chunk is the header).
  return html.split('<section class="adjustment-section').slice(1).map((chunk) => {
    const section = chunk.slice(0, chunk.indexOf('</section>'));
    const contentIdx = section.indexOf('adjustment-content');
    const header = contentIdx === -1 ? section : section.slice(0, contentIdx);
    return {
      title: section.match(/<h3>(.*?)<\/h3>/)?.[1] ?? '?',
      collapsed: section.startsWith(' is-collapsed'),
      resets: (header.match(/section-reset/g) ?? []).length,
      reverts: (header.match(/ml-revert/g) ?? []).length,
    };
  });
}

const count = (html: string, token: string): number => (html.match(new RegExp(token, 'g')) ?? []).length;

describe('single reset icon', () => {
  it('shows no revert/reset icon in any adjust header when everything is applied', () => {
    const html = renderAdjust(fullyAppliedEdit(), 'classic', true);
    const headers = auditHeaders(html);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.resets + header.reverts, `${header.title} must show no revert/reset icon`).toBe(0);
    }
    // The old separate revert icon is gone from the adjust tool entirely.
    expect(count(html, 'ml-revert')).toBe(0);
    // Every section shows its toggle on instead — including the manual
    // Curves, Details, and Effects, whose resets the toggles replaced.
    // (The scene toggle stays off: classic is the last-used enhance mode.)
    for (const toggle of ['face-enhance-toggle', 'selective-mask-toggle', 'denoise-toggle', 'white-balance-toggle', 'lightness-toggle', 'color-toggle', 'selective-color-toggle', 'curves-toggle', 'details-toggle', 'effects-toggle'] as const) {
      expect(html).toContain(`class="toggle is-on" data-testid="${toggle}"`);
    }
    expect(html).toContain('class="toggle" data-testid="scene-enhance-toggle"');
    // The classic enhance icon lives in the panel header: exactly one,
    // outside every section. Only the last-used enhance mode carries it.
    expect(headers.find((header) => header.title === 'Auto Enhance')).toBeUndefined();
    expect(html).toContain('aria-label="Reset auto enhance"');
    expect(count(html, 'section-reset')).toBe(1);
    expect(headers.find((header) => header.title === 'Scene Enhance')).toMatchObject({ resets: 0, reverts: 0 });
    // Collapsed sections keep their switch rendered (the header action
    // stays visible while collapsed).
    for (const title of ['Curves', 'Details', 'Effects']) {
      expect(headers.find((header) => header.title === title)).toMatchObject({ collapsed: true, resets: 0, reverts: 0 });
    }
  });

  it('keeps the single enhance icon on the last-used mode in scene mode', () => {
    const html = renderAdjust(fullyAppliedEdit(), 'scene', true);
    const headers = auditHeaders(html);
    for (const header of headers) {
      expect(header.resets + header.reverts, `${header.title} must show no revert/reset icon`).toBe(0);
    }
    // The scene section reverts from its toggle, so it carries no icon;
    // the panel header carries none either while scene is last-used.
    expect(headers.find((header) => header.title === 'Scene Enhance')).toMatchObject({ resets: 0, reverts: 0 });
    expect(html).toContain('class="toggle is-on" data-testid="scene-enhance-toggle"');
    expect(headers.find((header) => header.title === 'Auto Enhance')).toBeUndefined();
    expect(html).not.toContain('aria-label="Reset auto enhance"');
    expect(count(html, 'section-reset')).toBe(0);
    expect(count(html, 'ml-revert')).toBe(0);
  });

  it('shows no revert/reset icon in any adjust header at defaults', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, null, false);
    const headers = auditHeaders(html);
    for (const header of headers) {
      expect(header.resets + header.reverts, `${header.title} must show no revert/reset icon at defaults`).toBe(0);
    }
    // Clean sections render no reset at all — not even hover-only; the
    // snapshot sections likewise render no icon with nothing to restore.
    expect(count(html, 'section-reset')).toBe(0);
    expect(count(html, 'ml-revert')).toBe(0);
  });

  it('shows no header revert/reset icons in the repair tool', () => {
    const html = renderRepair();
    const headers = auditHeaders(html);
    expect(headers.map((header) => header.title)).toEqual(['Brush', 'Reconstruction', 'One-Click Removal', 'Dust Spots', 'Repairs']);
    for (const header of headers) {
      expect(header.resets + header.reverts, `${header.title} must show at most one revert/reset icon`).toBe(0);
    }
    expect(count(html, 'section-reset')).toBe(0);
    expect(count(html, 'ml-revert')).toBe(0);
    // The Repairs section clears from a single content-level icon instead of
    // a header reset; per-group deletes are per-item scope, not a second
    // section reset.
    expect(count(html, 'data-testid="retouch-clear"')).toBe(1);
  });

  it('shows exactly one revert icon in the crop tool while a straighten snapshot lives', () => {
    // The crop tool has no adjustment headers; straighten is a content row
    // whose Auto pairs with the single remaining RevertButton.
    expect(auditHeaders(renderCrop(0))).toEqual([]);
    const html = renderCrop(0);
    expect(count(html, 'ml-revert')).toBe(1);
    expect(count(html, 'section-reset')).toBe(0);
    const clean = renderCrop(null);
    expect(count(clean, 'ml-revert')).toBe(0);
    expect(count(clean, 'section-reset')).toBe(0);
  });
});
