import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { ObjectRemovalAssist } from './Inspector.js';

// One-click removal surfaces, rendered on the server (no jsdom): effects
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

function renderRepair(removal?: ObjectRemovalAssist): string {
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool="repair"
      histogram={null}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      repairAssist={{
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
        ...(removal === undefined ? {} : { removal }),
      }}
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

describe('object removal control', () => {
  it('is absent without a removal assist', () => {
    expect(renderRepair()).not.toContain('data-testid="object-removal"');
  });

  it('offers ML people removal with an ML badge when idle', () => {
    const html = renderRepair(idleRemoval);
    expect(html).toContain('data-testid="object-removal"');
    expect(html).toContain('data-testid="object-removal-detect"');
    expect(html).toContain('Remove people');
    expect(html).toContain('ml-badge');
    expect(html).toContain('>ML<');
  });

  it('lists ML detections with confirm checkboxes and a count apply', () => {
    const html = renderRepair({
      ...idleRemoval,
      state: 'ready',
      source: 'onnx',
      detections: [
        { label: 'person', score: 0.9, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, checked: true },
        { label: 'person', score: 0.7, box: { x0: 0.5, y0: 0.5, x1: 1, y1: 1 }, checked: false },
      ],
    });
    expect(html).toContain('data-testid="object-removal-list"');
    expect(html).toContain('Person 1 · 90% · ML');
    expect(html).toContain('Person 2 · 70%');
    expect(html).toContain('data-testid="object-removal-apply"');
    expect(html).toContain('Remove 1 selected');
  });

  it('labels classical results as a scan, never ML', () => {
    const html = renderRepair({
      ...idleRemoval,
      state: 'ready',
      source: 'classic',
      note: 'Classical scan — ML weights are still downloading or offline, so this is approximate.',
      detections: [{ label: 'person', score: 0.5, box: { x0: 0, y0: 0, x1: 1, y1: 1 }, checked: true }],
    });
    expect(html).toContain('Person 1 · 50%');
    expect(html).not.toContain('· ML');
    expect(html).toContain('Classical scan');
  });

  it('reports errors with a retry', () => {
    const html = renderRepair({ ...idleRemoval, state: 'error', message: 'Photo server unreachable.' });
    expect(html).toContain('Photo server unreachable.');
    expect(html).toContain('data-testid="object-removal-retry"');
  });

  it('renders errors as a message box holding both options', () => {
    const html = renderRepair({ ...idleRemoval, state: 'error', message: 'Model download failed: HTTP 404.' });
    expect(html).toContain('data-testid="object-removal-error"');
    expect(html).toContain('assist-message is-error');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Model download failed: HTTP 404.');
    // Both options live inside the message: Retry first, then Dismiss.
    const box = html.indexOf('data-testid="object-removal-error"');
    const retry = html.indexOf('data-testid="object-removal-retry"');
    const dismiss = html.indexOf('data-testid="object-removal-dismiss"');
    expect(box).toBeGreaterThan(-1);
    expect(retry).toBeGreaterThan(box);
    expect(dismiss).toBeGreaterThan(retry);
    expect(html).toContain('class="slim-button" data-testid="object-removal-retry"');
  });
});
