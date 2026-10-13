import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { RangeControl } from './EditorUI.js';
import { Inspector } from './Inspector.js';
import type { RepairAssist } from './Inspector.js';

// Brush-size slider line: the vertical mark ~26% through the Brush Size
// slider was the shared RangeControl origin tick drawn at defaultValue
// (45px on a 5–160 range). That tick is meaningful only on bipolar
// (signed) sliders, where it marks the neutral zero — on unsigned sliders
// the default is just a starting preset, so the tick is removed there.
// Rendered on the server (no jsdom): pins the markup, not live behavior.

const noop = () => {};

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

function renderInspector(tool: 'adjust' | 'repair'): string {
  const repairAssist: RepairAssist = {
    method: 'ml-heal',
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
  };
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool={tool}
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

describe('brush slider origin tick', () => {
  it.each([
    ['Brush Size', { label: 'Brush Size', value: 45, min: 5, max: 160, defaultValue: 45, suffix: 'px' }],
    ['Strength', { label: 'Strength', value: 100, min: 1, max: 100, defaultValue: 100, suffix: '%' }],
    ['Blend Feather', { label: 'Blend Feather', value: 2, min: 0, max: 8, step: 1, defaultValue: 2, suffix: 'px' }],
    ['denoise strength', { label: 'Strength', value: 45, min: 0, max: 100, step: 1, defaultValue: 45 }],
  ])('draws no origin tick on the unsigned %s slider', (_name, props) => {
    const html = renderToStaticMarkup(<RangeControl {...props} onChange={noop} />);
    expect(html).not.toContain('range-origin');
  });

  it('keeps the origin tick on a signed (bipolar) slider', () => {
    const html = renderToStaticMarkup(
      <RangeControl label="Exposure" value={20} signed onChange={noop} />,
    );
    expect(html).toContain('range-origin');
  });

  it('keeps double-click reset on unsigned sliders (tick gone, affordance kept)', () => {
    const html = renderToStaticMarkup(
      <RangeControl label="Brush Size" value={80} min={5} max={160} defaultValue={45} suffix="px" onChange={noop} />,
    );
    expect(html).toContain('Double-click to reset brush size');
  });

  it('renders no origin tick anywhere in the repair panel', () => {
    const html = renderInspector('repair');
    expect(html).toContain('data-testid="brush-size"');
    expect(html).toContain('data-testid="brush-strength"');
    expect(html).toContain('data-testid="blend-feather"');
    expect(html).not.toContain('range-origin');
  });

  it('still renders origin ticks in the adjust panel (signed sliders intact)', () => {
    const html = renderInspector('adjust');
    expect(html).toContain('range-origin');
  });
});
