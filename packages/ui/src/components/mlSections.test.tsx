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

  it('marks every ML section header with an ML badge or button', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    // Scene, faces, and subject run from their header ML button (White
    // Balance pattern), so they carry the button instead of a badge.
    for (const [title, button] of [['Scene Enhance', 'scene-enhance-ml'], ['Enhance Faces', 'face-enhance-ml'], ['Subject &amp; Background', 'selective-mask-ml']] as const) {
      expect(html).toContain(`data-testid="${button}"`);
      expect(html.match(new RegExp(`<h3>${title}</h3><span class="ml-badge"`)), `${title} header carries no badge`).toBeNull();
    }
    const heading = html.match(/<h3>Denoise<\/h3><span class="ml-badge"/);
    expect(heading, 'Denoise header carries an ML badge').not.toBeNull();
  });

  it('omits every ML section without any assist but keeps classic Auto Enhance', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    for (const [, testId] of SECTIONS) {
      expect(html).not.toContain(testId);
    }
    expect(html).not.toContain('<h3>ML Enhance</h3>');
    expect(html).toContain('data-testid="auto-enhance-apply"');
    expect(html).toContain('Auto Enhance');
  });

  it('renders a lone ML assist in its own section only', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { face: true });
    expect(html).toContain('<h3>Enhance Faces</h3>');
    expect(html).toContain('data-testid="face-enhance"');
    expect(html).not.toContain('data-testid="scene-enhance"');
    expect(html).not.toContain('data-testid="selective-mask"');
    expect(html).not.toContain('data-testid="denoise"');
  });

  it('uses one slim toggle button for classic Auto Enhance, no switch', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(html).toContain('data-testid="auto-enhance-apply"');
    expect(html).toContain('class="slim-button full-width" data-testid="auto-enhance-apply"');
    expect(html).toContain('aria-pressed="false"');
    // No toggle switches or loose label rows around the enhance actions.
    expect(html).not.toContain('auto-enhance-row');
  });

  it('marks exactly the pure enhance mode as pressed', () => {
    const classic = renderAdjust({ ...DEFAULT_EDIT, autoEnhanced: true }, ALL_ML, { mode: 'classic', pure: true });
    expect(classic).toContain('class="slim-button full-width is-active" data-testid="auto-enhance-apply"');
    expect(classic).toContain('class="ml-button" data-testid="scene-enhance-ml"');
    expect(classic).toContain('title="Auto Enhance applied — click to revert"');
    const scene = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      ALL_ML,
      { mode: 'scene', pure: true },
    );
    expect(scene).toContain('class="slim-button full-width" data-testid="auto-enhance-apply"');
    expect(scene).toContain('class="ml-button is-active" data-testid="scene-enhance-ml"');
    expect(scene).toContain('title="ML scene enhance applied — click to revert"');
    expect(scene).toContain('data-testid="scene-enhance-scene"');
    expect(scene).toContain('Night · 90% · ML');
  });

  it('shows the enhance revert icon beside the last-used mode only', () => {
    const classic = renderAdjust({ ...DEFAULT_EDIT, autoEnhanced: true }, ALL_ML, { mode: 'classic', pure: true });
    expect(classic).toContain('data-testid="auto-enhance-revert"');
    expect(classic).toContain('aria-label="Revert auto enhance"');
    expect(classic).not.toContain('data-testid="scene-enhance-ml-revert"');
    const scene = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      ALL_ML,
      { mode: 'scene', pure: true },
    );
    expect(scene).toContain('data-testid="scene-enhance-ml-revert"');
    expect(scene).toContain('aria-label="Revert ML scene enhance"');
    expect(scene).not.toContain('data-testid="auto-enhance-revert"');
    // No snapshot, no revert icon anywhere.
    const idle = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(idle).not.toContain('data-testid="auto-enhance-revert"');
    expect(idle).not.toContain('data-testid="scene-enhance-ml-revert"');
  });

  it('keeps the revert icon after manual edits cleared the enhance highlight', () => {
    // A slider drag after the enhance drops pure (both buttons idle) while
    // the last-used mode keeps its revert icon with a re-apply title.
    const classic = renderAdjust({ ...DEFAULT_EDIT, autoEnhanced: true }, ALL_ML, { mode: 'classic', pure: false });
    expect(classic).toContain('class="slim-button full-width" data-testid="auto-enhance-apply"');
    expect(classic).toContain('class="ml-button" data-testid="scene-enhance-ml"');
    expect(classic).toContain('title="Re-apply automatic enhancement"');
    expect(classic).toContain('data-testid="auto-enhance-revert"');
    const scene = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      ALL_ML,
      { mode: 'scene', pure: false },
    );
    expect(scene).toContain('class="ml-button" data-testid="scene-enhance-ml"');
    expect(scene).toContain('title="Re-apply automatic scene enhance with ML"');
    expect(scene).toContain('data-testid="scene-enhance-ml-revert"');
    // The persisted scene badge survives the highlight loss.
    expect(scene).toContain('Night · 90% · ML');
  });

  it('lays the classic enhance button and revert icon out in a flex row', () => {
    // The full-width button shares its row with the revert icon: flex
    // row, button grows, icon sits beside it. Scene enhance runs from the
    // header ML button now, so its old content row and CSS are gone.
    expect(cssRule('.classic-enhance')).toMatch(/display\s*:\s*flex/);
    expect(cssRule('.classic-enhance')).toMatch(/align-items\s*:\s*center/);
    expect(cssRule('.classic-enhance .slim-button.full-width')).toMatch(/flex\s*:\s*1/);
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
    expect(html).toContain('class="slim-button full-width" data-testid="denoise-preview"');
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
