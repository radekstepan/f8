import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, MlCategory, Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, FaceEnhanceAssist, SelectiveMaskAssist } from './Inspector.js';

// Per-adjustment header resets, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring — one reset per
// adjustment header, persistent while its state is non-default — not click
// behavior.

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

function denoiseAssist(overrides: Partial<DenoiseAssist> = {}): DenoiseAssist {
  return {
    state: 'idle', preview: null, applied: null, hasBase: false, progress: null,
    note: null, message: null, onPreview: noop, onApply: noop, onClear: noop, onDismiss: noop,
    ...overrides,
  };
}

function renderAdjust(
  edit: EditState,
  options?: {
    mlApplied?: Partial<Record<MlCategory, boolean>>;
    mlRevert?: Partial<Record<MlCategory, boolean>>;
    enhance?: { mode: 'classic' | 'scene' | null; pure?: boolean };
    assists?: boolean;
    denoise?: Partial<DenoiseAssist>;
  },
): string {
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
      {...(options?.enhance ? { enhanceMode: options.enhance.mode, enhancePure: options.enhance.pure ?? false } : {})}
      {...(options?.assists ? { onAutoScene: noop, faceAssist: faceAssist(), selectiveAssist: selectiveAssist(), denoiseAssist: denoiseAssist(options?.denoise ?? {}) } : {})}
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onRevertWhiteBalance={noop}
      onRevertLightness={noop}
      onRevertColor={noop}
      {...(options?.mlApplied ? { mlApplied: options.mlApplied } : {})}
      {...(options?.mlRevert ? { mlRevert: options.mlRevert } : {})}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

describe('reset per adjustment', () => {
  it('renders no reset on any slider section at defaults — not even hover-only', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).not.toContain('section-reset');
    for (const label of ['Reset white balance', 'Reset lightness', 'Reset hue &amp; saturation', 'Reset curves', 'Reset details', 'Reset effects']) {
      expect(html).not.toContain(`aria-label="${label}"`);
    }
  });

  it('persists the reset of exactly the section whose values left defaults', () => {
    const cases: Array<[Partial<EditState>, string]> = [
      [{ temperature: 5800 }, 'Reset white balance'],
      [{ tint: 6 }, 'Reset white balance'],
      [{ exposure: 0.5 }, 'Reset lightness'],
      [{ brightness: 10 }, 'Reset lightness'],
      [{ contrast: -10 }, 'Reset lightness'],
      [{ highlights: 20 }, 'Reset lightness'],
      [{ shadows: -20 }, 'Reset lightness'],
      [{ blacks: 5 }, 'Reset lightness'],
      [{ saturation: 8 }, 'Reset hue &amp; saturation'],
      [{ vibrance: 16 }, 'Reset hue &amp; saturation'],
      [{ hue: -30 }, 'Reset hue &amp; saturation'],
      [{ curve: 25 }, 'Reset curves'],
      [{ curvePoints: [{ x: 0.25, y: 0.3 }] }, 'Reset curves'],
      [{ clarity: 20 }, 'Reset details'],
      [{ sharpness: 30 }, 'Reset details'],
      [{ grain: 10 }, 'Reset details'],
      [{ vignette: 40 }, 'Reset effects'],
      [{ fade: 15 }, 'Reset effects'],
    ];
    const labels = ['Reset white balance', 'Reset lightness', 'Reset hue &amp; saturation', 'Reset curves', 'Reset details', 'Reset effects'];
    for (const [patch, label] of cases) {
      const html = renderAdjust({ ...DEFAULT_EDIT, ...patch });
      expect(html).toContain(`section-reset is-dirty" data-tooltip="${label}"`);
      for (const other of labels.filter((candidate) => candidate !== label)) {
        expect(html, `${JSON.stringify(patch)} must not render ${other}`).not.toContain(`aria-label="${other}"`);
      }
    }
  });

  it('treats a legacy-disabled category at default values as clean', () => {
    // The enabled flag flips back on the first slider drag, so values
    // alone decide dirtiness: a disabled-but-default section renders no
    // reset at all (and its reset would have nothing to restore).
    const html = renderAdjust({ ...DEFAULT_EDIT, whiteBalanceEnabled: false });
    expect(html).not.toContain('aria-label="Reset white balance"');
  });

  it('keeps the dirty reset in the header while collapsed', () => {
    const html = renderToStaticMarkup(
      <AdjustmentSection title="Lightness" icon={<i />} open={false} onReset={noop} dirty>
        <span>slider-stub</span>
      </AdjustmentSection>,
    );
    expect(html).toContain('is-collapsed');
    expect(html).not.toContain('slider-stub');
    expect(html).toContain('section-reset is-dirty" data-tooltip="Reset lightness"');
  });

  it('carries no separate revert control in any adjust header', () => {
    // Snapshots everywhere at once: enhance, all three ML categories, and
    // every assist section rendered — still exactly one icon per header.
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      {
        mlApplied: { whiteBalance: true, lightness: true, color: true },
        mlRevert: { whiteBalance: true, lightness: true, color: true },
        enhance: { mode: 'scene', pure: false },
        assists: true,
      },
    );
    expect(html).not.toContain('ml-revert');
    expect(html).not.toContain('-ml-revert"');
    expect(html).not.toContain('-auto-revert"');
    expect(html).not.toContain('aria-label="Revert');
    // The snapshot sections still offer their shared-snapshot reset.
    for (const label of ['Reset scene enhance', 'Reset white balance', 'Reset lightness', 'Reset hue &amp; saturation']) {
      expect(html).toContain(`section-reset is-dirty" data-tooltip="${label}"`);
    }
  });

  it('gives Details a header reset exactly while dirty, and Denoise one exactly while applied', () => {
    // Details (reset added in Task 12): dirty values persist the reset.
    const details = renderAdjust({ ...DEFAULT_EDIT, clarity: 20, sharpness: 30 }, { assists: true });
    expect(details).toContain('section-reset is-dirty" data-tooltip="Reset details"');
    // Denoise (header rework, Task 4): no stored denoise, no reset.
    const idle = renderAdjust({ ...DEFAULT_EDIT }, { assists: true });
    expect(idle).not.toContain('aria-label="Reset denoise"');
    // A stored denoise persists the reset (Enhance Faces pattern).
    const stored = { strength: 65, auto: true, source: 'onnx' } as const;
    const applied = renderAdjust(
      { ...DEFAULT_EDIT, denoise: { ...stored } },
      { assists: true, denoise: { state: 'applied', applied: { ...stored }, hasBase: true } },
    );
    expect(applied).toContain('section-reset is-dirty" data-tooltip="Reset denoise"');
  });

  it('keeps the reset box while rendering it only when dirty', () => {
    // Base rule: same 14x19 icon box, always visible — clean sections
    // render no reset at all, so there is nothing to hide until hover.
    expect(cssRule('.section-reset')).toMatch(/width\s*:\s*14px/);
    expect(cssRule('.section-reset')).toMatch(/height\s*:\s*19px/);
    expect(cssRule('.section-reset')).toMatch(/opacity\s*:\s*1/);
    // Dirty rule: standalone selector (for the cssRule helper) matching
    // the markup's always-dirty reset class.
    expect(cssRule('.section-reset.is-dirty')).toMatch(/opacity\s*:\s*1/);
    // The hover-only reveal is retired: no hover or focus rule may resurrect it.
    expect(css()).not.toMatch(/\.adjustment-heading:hover \.section-reset/);
    expect(css()).not.toMatch(/\.section-reset:focus-visible/);
  });
});
