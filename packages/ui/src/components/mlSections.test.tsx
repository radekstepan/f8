import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, FaceEnhanceAssist, SelectiveMaskAssist } from './Inspector.js';

// Exploded ML sections, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior.

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
    state: 'idle',
    faces: 0,
    source: null,
    whiteBalance: null,
    skinAnchored: false,
    liftAmount: 0,
    redEyeCount: 0,
    progress: null,
    note: null,
    message: null,
    applied: null,
    onDetect: noop,
    onApply: noop,
    onToggle: noop,
    onClear: noop,
    onDismiss: noop,
  };
}

function selectiveAssist(): SelectiveMaskAssist {
  return {
    state: 'idle',
    found: false,
    coverage: 0,
    source: null,
    progress: null,
    note: null,
    message: null,
    applied: null,
    onDetect: noop,
    onAdjust: noop,
    onToggle: noop,
    onClear: noop,
    onDismiss: noop,
  };
}

function denoiseAssist(): DenoiseAssist {
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
  };
}

function renderAdjust(edit: EditState, ml?: { scene?: boolean; face?: boolean; selective?: boolean; denoise?: boolean }, enhance?: { mode: 'classic' | 'scene' | null; pure?: boolean }): string {
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
      {...(enhance ? { enhanceMode: enhance.mode, enhancePure: enhance.pure ?? false } : {})}
      {...(ml?.scene ? { onAutoScene: noop } : {})}
      {...(ml?.face ? { faceAssist: faceAssist() } : {})}
      {...(ml?.selective ? { selectiveAssist: selectiveAssist() } : {})}
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

const ALL_ML = { scene: true, face: true, selective: true, denoise: true };

/** Each ML action's section title and the control testid living inside it. */
const SECTIONS: Array<[string, string]> = [
  ['Scene Enhance', 'data-testid="scene-enhance"'],
  ['Enhance Faces', 'data-testid="face-enhance"'],
  ['Subject &amp; Background', 'data-testid="selective-mask"'],
  ['Denoise', 'data-testid="denoise"'],
];

describe('ml enhance sections', () => {
  it('explodes scene, faces, subject, and denoise into their own titled sections', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(html).not.toContain('<h3>ML Enhance</h3>');
    expect(html).not.toContain('data-testid="ml-enhance"');
    let previous = -1;
    for (const [title, testId] of SECTIONS) {
      const heading = `<h3>${title}</h3>`;
      expect(html).toContain(heading);
      expect(html).toContain(testId);
      const headingAt = html.indexOf(heading);
      const controlAt = html.indexOf(testId);
      // Each control sits inside its own section, in scene/faces/subject/denoise order.
      expect(controlAt).toBeGreaterThan(headingAt);
      expect(headingAt).toBeGreaterThan(previous);
      previous = controlAt;
    }
    // The whole group sits below the histogram, which leads the panel.
    expect(html.indexOf('data-testid="denoise"')).toBeGreaterThan(html.indexOf('histogram-section'));
  });

  it('marks every model section header with a header ML button, never a badge', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    // Scene, faces, and subject run a model from their header ML button,
    // so they carry the button instead of a badge.
    for (const [title, button] of [['Scene Enhance', 'scene-enhance-ml'], ['Enhance Faces', 'face-enhance-ml'], ['Subject &amp; Background', 'selective-mask-ml']] as const) {
      expect(html).toContain(`data-testid="${button}"`);
      expect(html.match(new RegExp(`<h3>${title}</h3><span class="ml-badge"`)), `${title} header carries no badge`).toBeNull();
    }
  });

  it('runs the denoise suggestion from a header Auto button, never an ML button', () => {
    // Denoise drafts an ISO-ladder suggestion (a heuristic, not a model
    // run), so its header carries the Auto pill like the slider autos.
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(html).toContain('data-testid="denoise-auto"');
    expect(html).not.toContain('data-testid="denoise-ml"');
    expect(html.match(/<h3>Denoise<\/h3><span class="ml-badge"/), 'Denoise header carries no badge').toBeNull();
  });

  it('omits every ML section without any assist but keeps the header Auto', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    for (const [, testId] of SECTIONS) {
      expect(html).not.toContain(testId);
    }
    expect(html).not.toContain('<h3>ML Enhance</h3>');
    expect(html).not.toContain('<h3>Auto Enhance</h3>');
    expect(html).toContain('data-testid="auto-enhance-auto"');
  });

  it('renders a lone ML assist in its own section only', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { face: true });
    expect(html).toContain('<h3>Enhance Faces</h3>');
    expect(html).toContain('data-testid="face-enhance"');
    expect(html).not.toContain('data-testid="scene-enhance"');
    expect(html).not.toContain('data-testid="selective-mask"');
    expect(html).not.toContain('data-testid="denoise"');
  });

  it('runs classic Auto Enhance from the panel header Auto button, no section or bar', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(html).not.toContain('<h3>Auto Enhance</h3>');
    expect(html).toContain('class="auto-small inspector-auto" data-testid="auto-enhance-auto" aria-pressed="false"');
    expect(html).toContain('data-tooltip="Apply auto enhance automatically"');
    expect(html).toContain('>Auto</button>');
    // No standalone section, no full-width bar, no toggle switches, no
    // loose label rows around the enhance actions.
    expect(html).not.toContain('data-testid="auto-enhance-apply"');
    expect(html).not.toContain('classic-enhance');
    expect(html).not.toContain('auto-enhance-row');
  });

  it('marks exactly the pure enhance mode as pressed', () => {
    const classic = renderAdjust({ ...DEFAULT_EDIT, autoEnhanced: true }, ALL_ML, { mode: 'classic', pure: true });
    expect(classic).toContain('class="auto-small inspector-auto is-active" data-testid="auto-enhance-auto"');
    expect(classic).toContain('class="ml-button" data-testid="scene-enhance-ml"');
    expect(classic).toContain('data-tooltip="Auto Enhance applied — click to revert"');
    const scene = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      ALL_ML,
      { mode: 'scene', pure: true },
    );
    expect(scene).toContain('class="auto-small inspector-auto" data-testid="auto-enhance-auto"');
    expect(scene).toContain('class="ml-button is-active" data-testid="scene-enhance-ml"');
    expect(scene).toContain('data-tooltip="ML scene enhance applied — click to revert"');
    expect(scene).toContain('data-testid="scene-enhance-scene"');
    expect(scene).toContain('Night · 90%');
    expect(scene).not.toContain('· ML');
  });

  it('shows a header reset beside the last-used mode only', () => {
    const classic = renderAdjust({ ...DEFAULT_EDIT, autoEnhanced: true }, ALL_ML, { mode: 'classic', pure: true });
    expect(classic).toContain('section-reset is-dirty" data-tooltip="Reset auto enhance"');
    expect(classic).not.toContain('aria-label="Reset scene enhance"');
    const scene = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      ALL_ML,
      { mode: 'scene', pure: true },
    );
    expect(scene).toContain('section-reset is-dirty" data-tooltip="Reset scene enhance"');
    expect(scene).not.toContain('aria-label="Reset auto enhance"');
    // No snapshot, no reset on either enhance section.
    const idle = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(idle).not.toContain('aria-label="Reset auto enhance"');
    expect(idle).not.toContain('aria-label="Reset scene enhance"');
  });

  it('keeps the reset after manual edits cleared the enhance highlight', () => {
    // A slider drag after the enhance drops pure (both buttons idle) while
    // the last-used mode keeps its persistent reset with a re-apply title.
    const classic = renderAdjust({ ...DEFAULT_EDIT, autoEnhanced: true }, ALL_ML, { mode: 'classic', pure: false });
    expect(classic).toContain('class="auto-small inspector-auto" data-testid="auto-enhance-auto"');
    expect(classic).toContain('class="ml-button" data-testid="scene-enhance-ml"');
    expect(classic).toContain('data-tooltip="Re-apply auto enhance"');
    expect(classic).toContain('section-reset is-dirty" data-tooltip="Reset auto enhance"');
    const scene = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      ALL_ML,
      { mode: 'scene', pure: false },
    );
    expect(scene).toContain('class="ml-button" data-testid="scene-enhance-ml"');
    expect(scene).toContain('data-tooltip="Re-apply automatic scene enhance with ML"');
    expect(scene).toContain('section-reset is-dirty" data-tooltip="Reset scene enhance"');
    // The persisted scene badge survives the highlight loss.
    expect(scene).toContain('Night · 90%');
  });

  it('runs classic enhance from the panel header row, with no content bar', () => {
    // The old full-width content bar and its CSS are gone: the Auto button
    // and header reset live in the panel header's own action row (the
    // section-actions row still serves every ML section the same way).
    // Scene enhance's old content row is gone too.
    expect(css()).not.toMatch(/\.classic-enhance/);
    expect(cssRule('.section-actions')).toMatch(/display\s*:\s*flex/);
    expect(cssRule('.section-actions')).toMatch(/align-items\s*:\s*center/);
    expect(cssRule('.inspector-auto-wrap')).toMatch(/display\s*:\s*flex/);
    expect(cssRule('.inspector-auto-wrap')).toMatch(/align-items\s*:\s*center/);
    expect(css()).not.toMatch(/\.scene-enhance-row/);
  });

  it('runs scene, faces, and subject from header ML buttons, never content bars', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(html).toContain('class="ml-button" data-testid="scene-enhance-ml"');
    expect(html).toContain('class="ml-button" data-testid="face-enhance-ml"');
    expect(html).toContain('class="ml-button" data-testid="selective-mask-ml"');
    expect(html).not.toContain('data-testid="scene-enhance-apply"');
    expect(html).not.toContain('data-testid="face-enhance-detect"');
    expect(html).not.toContain('data-testid="selective-mask-detect"');
    expect(html).toContain('class="text-button full-width" data-testid="denoise-preview"');
    expect(html).not.toContain('secondary-button');
  });

  it('leaves no grouping wrapper behind: sections divide themselves', () => {
    // The old .ml-enhance wrapper (and its sibling-spacing rule from the
    // task-10 divider fix) is gone: each action is a top-level section
    // now, divided by the shared AdjustmentSection divider.
    expect(css()).not.toMatch(/\.ml-enhance/);
    // The face/subject controls lost their standalone padding + bottom
    // border with the wrapper — the section content provides the padding.
    expect(cssRule('.face-enhance')).toBe('');
    expect(cssRule('.selective-mask')).toBe('');
    expect(cssRule('.denoise-head')).toBe('');
  });

  it('keeps the shared section divider for legitimate separators', () => {
    // Each exploded section is still divided by the shared
    // AdjustmentSection divider between inspector panels.
    expect(cssRule('.adjustment-section')).toContain('border-bottom');
  });
});
