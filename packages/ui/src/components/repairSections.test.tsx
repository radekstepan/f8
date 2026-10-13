import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DustSpotsAssist, ObjectRemovalAssist, RepairAssist } from './Inspector.js';

// Repair sidebar grouping + slim actions + hover-preview wiring, rendered on
// the server (no jsdom): pins the markup + prop wiring, not pointer behavior.
// Preview geometry itself is unit-tested in @f8/core detectionPreview.

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

function renderRepair(removal?: ObjectRemovalAssist, dustSpots?: DustSpotsAssist): string {
  const repairAssist: RepairAssist = {
    method: 'heal',
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
    ...(removal === undefined ? {} : { removal }),
    ...(dustSpots === undefined ? {} : { dustSpots }),
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
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

const idleRemoval: ObjectRemovalAssist = {
  state: 'idle',
  detections: [],
  source: null,
  progress: null,
  note: null,
  message: null,
  onDetect: noop,
  onToggle: noop,
  onApply: noop,
  onDismiss: noop,
};

const idleDustSpots: DustSpotsAssist = {
  state: 'idle',
  spots: [],
  source: null,
  progress: null,
  note: null,
  message: null,
  onDetect: noop,
  onToggle: noop,
  onApply: noop,
  onDismiss: noop,
};

describe('repair sidebar sections', () => {
  it('groups brush, reconstruction, ML assists, and repairs into sections', () => {
    const html = renderRepair(idleRemoval, idleDustSpots);
    for (const title of ['Brush', 'Reconstruction', 'One-Click Removal', 'Dust Spots', 'Repairs']) {
      expect(html).toContain(`<h3>${title}</h3>`);
    }
    // Brush sliders live inside the Brush section, not under the intro.
    expect(html.indexOf('<h3>Brush</h3>')).toBeLessThan(html.indexOf('data-testid="brush-size"'));
    expect(html.indexOf('data-testid="brush-strength"')).toBeLessThan(html.indexOf('<h3>Reconstruction</h3>'));
  });

  it('omits the ML sections without their assists', () => {
    const html = renderRepair();
    expect(html).toContain('<h3>Brush</h3>');
    expect(html).toContain('<h3>Reconstruction</h3>');
    expect(html).toContain('<h3>Repairs</h3>');
    expect(html).not.toContain('One-Click Removal');
    expect(html).not.toContain('Dust Spots');
  });

  it('carries the ML badge in the ML section headings', () => {
    const html = renderRepair(idleRemoval, idleDustSpots);
    expect(html).toContain('<h3>One-Click Removal</h3><span class="ml-badge"');
    expect(html).toContain('<h3>Dust Spots</h3><span class="ml-badge"');
  });

  it('uses slim buttons for detect and apply, never chunky secondary ones', () => {
    const html = renderRepair(
      {
        ...idleRemoval,
        state: 'ready',
        source: 'onnx',
        detections: [{ label: 'person', score: 0.9, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, checked: true }],
      },
      {
        ...idleDustSpots,
        state: 'ready',
        source: 'ml',
        spots: [{ x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: true }],
      },
    );
    expect(html).toContain('data-testid="object-removal-apply"');
    expect(html).toContain('data-testid="dust-spots-apply"');
    expect(html).toContain('slim-button');
    expect(html).not.toContain('secondary-button');
    const idle = renderRepair(idleRemoval, idleDustSpots);
    expect(idle).toContain('class="slim-button full-width" data-testid="object-removal-detect"');
    expect(idle).toContain('class="slim-button full-width" data-testid="dust-spots-detect"');
  });

  it('marks the hovered person and spot rows as highlighted', () => {
    const html = renderRepair(
      {
        ...idleRemoval,
        state: 'ready',
        source: 'onnx',
        highlighted: 1,
        detections: [
          { label: 'person', score: 0.9, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, checked: true },
          { label: 'person', score: 0.7, box: { x0: 0.5, y0: 0.5, x1: 1, y1: 1 }, checked: true },
        ],
      },
      {
        ...idleDustSpots,
        state: 'ready',
        source: 'ml',
        highlighted: 0,
        spots: [
          { x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: true },
          { x: 0.7, y: 0.7, radius: 0.015, score: 0.68, polarity: 'bright', checked: true },
        ],
      },
    );
    expect(html).toContain('data-testid="object-removal-item-1"');
    expect(html).toContain('data-testid="dust-spots-item-0"');
    // Exactly the two hovered rows carry the highlight class.
    expect(html.match(/retouch-group is-highlighted/g)?.length).toBe(2);
  });
});
