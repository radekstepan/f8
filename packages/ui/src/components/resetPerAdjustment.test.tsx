import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, FaceEnhanceAssist, SelectiveMaskAssist } from './Inspector.js';

// Per-adjustment header toggles, rendered on the server (no jsdom):
// effects never run, so this pins the markup + prop wiring — one switch
// per adjustment header, lit while its state is non-default, and no
// reset button in any section header — not click behavior. (The retired
// per-section resets gave every manual section its own reset icon; the
// toggles below replaced them.)

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

describe('reset per adjustment', () => {
  it('renders every section switch off at defaults, and no reset anywhere', () => {
    // No assists rendered, so the panel-header enhance icon is absent too:
    // the whole adjust tool is reset-free at defaults.
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).not.toContain('section-reset');
    for (const label of ['Reset white balance', 'Reset lightness', 'Reset hue &amp; saturation', 'Reset curves', 'Reset details', 'Reset effects']) {
      expect(html).not.toContain(`aria-label="${label}"`);
    }
    for (const toggle of ['white-balance-toggle', 'lightness-toggle', 'color-toggle', 'curves-toggle', 'details-toggle', 'effects-toggle']) {
      expect(html).toContain(`class="toggle" data-testid="${toggle}"`);
    }
  });

  it('lights the toggle — never a reset — of exactly the manual section whose values left defaults', () => {
    // Curves, Details, and Effects have no automatic action, so their
    // switches disable while off — but a tweak lights exactly one.
    const cases: Array<[Partial<EditState>, string]> = [
      [{ curve: 25 }, 'curves-toggle'],
      [{ curvePoints: [{ x: 0.25, y: 0.3 }] }, 'curves-toggle'],
      [{ clarity: 20 }, 'details-toggle'],
      [{ sharpness: 30 }, 'details-toggle'],
      [{ grain: 10 }, 'details-toggle'],
      [{ vignette: 40 }, 'effects-toggle'],
      [{ fade: 15 }, 'effects-toggle'],
    ];
    const toggles = ['white-balance-toggle', 'lightness-toggle', 'color-toggle', 'curves-toggle', 'details-toggle', 'effects-toggle'];
    for (const [patch, toggle] of cases) {
      const html = renderAdjust({ ...DEFAULT_EDIT, ...patch });
      expect(html, JSON.stringify(patch)).toContain(`class="toggle is-on" data-testid="${toggle}"`);
      for (const other of toggles.filter((candidate) => candidate !== toggle)) {
        expect(html, `${JSON.stringify(patch)} must not light ${other}`).toContain(`class="toggle" data-testid="${other}"`);
      }
      expect(html).not.toContain('section-reset');
      expect(html).not.toContain('aria-label="Reset curves"');
      expect(html).not.toContain('aria-label="Reset details"');
      expect(html).not.toContain('aria-label="Reset effects"');
    }
  });

  it('lights the toggle — never a reset — of exactly the auto section whose values left defaults', () => {
    const cases: Array<[Partial<EditState>, string]> = [
      [{ temperature: 5800 }, 'white-balance-toggle'],
      [{ tint: 6 }, 'white-balance-toggle'],
      [{ exposure: 0.5 }, 'lightness-toggle'],
      [{ brightness: 10 }, 'lightness-toggle'],
      [{ contrast: -10 }, 'lightness-toggle'],
      [{ highlights: 20 }, 'lightness-toggle'],
      [{ shadows: -20 }, 'lightness-toggle'],
      [{ blacks: 5 }, 'lightness-toggle'],
      [{ saturation: 8 }, 'color-toggle'],
      [{ vibrance: 16 }, 'color-toggle'],
      [{ hue: -30 }, 'color-toggle'],
    ];
    const toggles = ['white-balance-toggle', 'lightness-toggle', 'color-toggle', 'curves-toggle', 'details-toggle', 'effects-toggle'];
    for (const [patch, toggle] of cases) {
      const html = renderAdjust({ ...DEFAULT_EDIT, ...patch });
      expect(html, JSON.stringify(patch)).toContain(`class="toggle is-on" data-testid="${toggle}"`);
      for (const other of toggles.filter((candidate) => candidate !== toggle)) {
        expect(html, `${JSON.stringify(patch)} must not light ${other}`).toContain(`class="toggle" data-testid="${other}"`);
      }
      // The toggle replaces the reset on these sections entirely.
      expect(html).not.toContain('section-reset');
      expect(html).not.toContain('aria-label="Reset white balance"');
      expect(html).not.toContain('aria-label="Reset lightness"');
      expect(html).not.toContain('aria-label="Reset hue &amp; saturation"');
    }
  });

  it('treats a legacy-disabled category at default values as clean', () => {
    // The enabled flag flips back on the first slider drag, so values
    // alone decide dirtiness: a disabled-but-default section renders its
    // toggle off.
    for (const [patch, toggle] of [
      [{ whiteBalanceEnabled: false }, 'white-balance-toggle'],
      [{ detailsEnabled: false }, 'details-toggle'],
    ] as const) {
      const html = renderAdjust({ ...DEFAULT_EDIT, ...patch });
      expect(html).toContain(`class="toggle" data-testid="${toggle}"`);
      expect(html).not.toContain('section-reset');
    }
  });

  it('keeps the lit toggle in the header while collapsed', () => {
    const html = renderToStaticMarkup(
      <AdjustmentSection title="Lightness" icon={<i />} open={false} toggle={{ id: 'lightness', checked: true, onToggle: noop, hint: 'Lightness on — click to reset to defaults' }}>
        <span>slider-stub</span>
      </AdjustmentSection>,
    );
    expect(html).toContain('is-collapsed');
    expect(html).not.toContain('slider-stub');
    expect(html).toContain('class="toggle is-on" data-testid="lightness-toggle"');
  });

  it('carries no separate revert control in any adjust header', () => {
    // Everything applied at once: enhance, dirty slider sections, and
    // every assist section rendered — still no revert icon anywhere in
    // the sections (the panel header's enhance revert and the crop
    // tool's straighten row keep the only RevertButtons).
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 }, temperature: 5800, exposure: 0.5, saturation: 8, curve: 25, clarity: 20, vignette: 40 },
      {
        enhance: { mode: 'scene', pure: false },
        assists: true,
      },
    );
    expect(html).not.toContain('ml-revert');
    expect(html).not.toContain('-ml-revert"');
    expect(html).not.toContain('-auto-revert"');
    expect(html).not.toContain('aria-label="Revert');
    // Every section shows its toggle on, with no reset beside.
    for (const toggle of ['scene-enhance-toggle', 'white-balance-toggle', 'lightness-toggle', 'color-toggle', 'curves-toggle', 'details-toggle', 'effects-toggle']) {
      expect(html).toContain(`class="toggle is-on" data-testid="${toggle}"`);
    }
    expect(html).not.toContain('aria-label="Reset scene enhance"');
    expect(html).not.toContain('aria-label="Reset white balance"');
    expect(html).not.toContain('aria-label="Reset curves"');
    expect(html).not.toContain('aria-label="Reset details"');
    expect(html).not.toContain('aria-label="Reset effects"');
  });

  it('gives Details a header toggle exactly while dirty, and Denoise a toggle exactly while applied', () => {
    // Details: dirty values light the switch (off and disabled at defaults).
    const details = renderAdjust({ ...DEFAULT_EDIT, clarity: 20, sharpness: 30 }, { assists: true });
    expect(details).toContain('class="toggle is-on" data-testid="details-toggle"');
    expect(details).not.toContain('aria-label="Reset details"');
    // Denoise: no stored denoise, toggle off and no reset.
    const idle = renderAdjust({ ...DEFAULT_EDIT }, { assists: true });
    expect(idle).toContain('class="toggle" data-testid="denoise-toggle"');
    expect(idle).not.toContain('aria-label="Reset denoise"');
    // A stored denoise lights the toggle (no reset — toggling off clears).
    const stored = { strength: 65, auto: true, source: 'onnx' } as const;
    const applied = renderAdjust(
      { ...DEFAULT_EDIT, denoise: { ...stored } },
      { assists: true, denoise: { state: 'applied', applied: { ...stored }, hasBase: true } },
    );
    expect(applied).toContain('class="toggle is-on" data-testid="denoise-toggle"');
    expect(applied).not.toContain('aria-label="Reset denoise"');
  });

  it('keeps the reset box for the panel-header enhance icon', () => {
    // The section headers render no reset anymore; the class survives
    // only on the panel header's enhance-revert icon (rendered solely
    // while a pre-enhance snapshot lives). Same 14x19 icon box, always
    // visible — and the hover-only reveal stays retired.
    expect(cssRule('.section-reset')).toMatch(/width\s*:\s*14px/);
    expect(cssRule('.section-reset')).toMatch(/height\s*:\s*19px/);
    expect(cssRule('.section-reset')).toMatch(/opacity\s*:\s*1/);
    // Dirty rule: standalone selector (for the cssRule helper) matching
    // the markup's always-dirty reset class.
    expect(cssRule('.section-reset.is-dirty')).toMatch(/opacity\s*:\s*1/);
    expect(css()).not.toMatch(/\.adjustment-heading:hover \.section-reset/);
    expect(css()).not.toMatch(/\.section-reset:focus-visible/);
  });
});
