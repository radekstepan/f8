import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, FaceEnhanceAssist, SelectiveMaskAssist } from './Inspector.js';

// The histogram leads the Adjustments panel: it renders before every ML
// section and every slider section. (Auto Enhance is a header pill above
// the scroll region, not a panel contender.) Rendered on the server (no
// jsdom): effects never run, so this pins markup order, not click behavior.

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

function renderAdjust(): string {
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
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
      denoiseAssist={denoiseAssist()}
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

describe('histogram leads the adjustments panel', () => {
  it('renders before every ML section and every slider section', () => {
    const html = renderAdjust();
    const histogramAt = html.indexOf('histogram-section');
    expect(histogramAt).toBeGreaterThan(-1);
    // Auto Enhance is no section anymore — a header pill above the scroll
    // region — so it cannot precede the histogram from inside the panel.
    expect(html).not.toContain('<h3>Auto Enhance</h3>');
    // Every contender that used to (or could) precede it now follows it.
    for (const marker of [
      'data-testid="scene-enhance"',
      'data-testid="face-enhance"',
      'data-testid="selective-mask"',
      'data-testid="denoise"',
      '<h3>White Balance</h3>',
      '<h3>Lightness</h3>',
      '<h3>Hue &amp; Saturation</h3>',
    ]) {
      const at = html.indexOf(marker);
      expect(at, `${marker} is rendered`).toBeGreaterThan(-1);
      expect(histogramAt, `histogram precedes ${marker}`).toBeLessThan(at);
    }
    // The header Auto sits above the scroll region, before the histogram.
    const auto = html.indexOf('data-testid="auto-enhance-auto"');
    expect(auto).toBeGreaterThan(-1);
    expect(auto).toBeLessThan(histogramAt);
  });

  it('is the first child of the adjust scroll region', () => {
    const html = renderAdjust();
    const scrollAt = html.indexOf('class="inspector-scroll"');
    expect(scrollAt).toBeGreaterThan(-1);
    const histogramAt = html.indexOf('histogram-section');
    const between = html.slice(scrollAt, histogramAt);
    // Nothing but the scroll div's own opening tag sits between.
    expect(between).toMatch(/^class="inspector-scroll"><section class="[^"]*$/);
  });
});
