import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { FaceEnhanceAssist, SelectiveMaskAssist } from './Inspector.js';

// ML Enhance section grouping, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring, not click behavior.

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
    onClear: noop,
    onDismiss: noop,
  };
}

function renderAdjust(edit: EditState, ml?: { scene?: boolean; face?: boolean; selective?: boolean }): string {
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
      {...(ml?.scene ? { onAutoScene: noop } : {})}
      {...(ml?.face ? { faceAssist: faceAssist() } : {})}
      {...(ml?.selective ? { selectiveAssist: selectiveAssist() } : {})}
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

const ALL_ML = { scene: true, face: true, selective: true };

describe('ml enhance section', () => {
  it('groups scene, faces, and subject actions into one collapsible ML section', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(html).toContain('<h3>ML Enhance</h3><span class="ml-badge"');
    expect(html).toContain('data-testid="ml-enhance"');
    const heading = html.indexOf('<h3>ML Enhance</h3>');
    for (const testId of ['data-testid="scene-enhance"', 'data-testid="face-enhance"', 'data-testid="selective-mask"']) {
      expect(html).toContain(testId);
      expect(html.indexOf(testId)).toBeGreaterThan(heading);
    }
    // The whole group sits above the histogram, like the old loose rows did.
    expect(html.indexOf('data-testid="selective-mask"')).toBeLessThan(html.indexOf('histogram-section'));
  });

  it('omits the section without any ML assist but keeps classic Auto Enhance', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).not.toContain('data-testid="ml-enhance"');
    expect(html).not.toContain('<h3>ML Enhance</h3>');
    expect(html).toContain('data-testid="auto-enhance-apply"');
    expect(html).toContain('Auto Enhance');
  });

  it('renders a lone ML assist inside the section', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { face: true });
    expect(html).toContain('<h3>ML Enhance</h3>');
    expect(html).toContain('data-testid="face-enhance"');
    expect(html).not.toContain('data-testid="scene-enhance"');
    expect(html).not.toContain('data-testid="selective-mask"');
  });

  it('uses one slim toggle button for classic Auto Enhance, no switch', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(html).toContain('data-testid="auto-enhance-apply"');
    expect(html).toContain('class="slim-button full-width" data-testid="auto-enhance-apply"');
    expect(html).toContain('aria-pressed="false"');
    // No toggle switches or loose label rows around the enhance actions.
    expect(html).not.toContain('auto-enhance-row');
  });

  it('marks exactly the active enhance mode as pressed', () => {
    const classic = renderAdjust({ ...DEFAULT_EDIT, autoEnhanced: true }, ALL_ML);
    expect(classic).toContain('class="slim-button full-width is-active" data-testid="auto-enhance-apply"');
    expect(classic).toContain('class="slim-button full-width" data-testid="scene-enhance-apply"');
    const scene = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      ALL_ML,
    );
    expect(scene).toContain('class="slim-button full-width" data-testid="auto-enhance-apply"');
    expect(scene).toContain('class="slim-button full-width is-active" data-testid="scene-enhance-apply"');
    expect(scene).toContain('data-testid="scene-enhance-scene"');
    expect(scene).toContain('Night · 90% · ML');
  });

  it('uses slim buttons for every ML action, never chunky secondary ones', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, ALL_ML);
    expect(html).toContain('class="slim-button full-width" data-testid="scene-enhance-apply"');
    expect(html).toContain('class="slim-button full-width" data-testid="face-enhance-detect"');
    expect(html).toContain('class="slim-button full-width" data-testid="selective-mask-detect"');
    expect(html).not.toContain('secondary-button');
  });
});
