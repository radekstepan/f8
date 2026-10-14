import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DustSpotsAssist, ObjectRemovalAssist, RepairAssist } from './Inspector.js';

// Repair sidebar grouping + golden-link actions + hover-preview wiring,
// rendered on the server (no jsdom): pins the markup + prop wiring, not
// pointer behavior. Preview geometry itself is unit-tested in
// @f8/core detectionPreview.

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
    // Brush sliders live inside the Brush section.
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

  it('runs the removal ML assist and the dust Auto assist from right-aligned header buttons, never badges', () => {
    const html = renderRepair(idleRemoval, idleDustSpots);
    expect(html).toContain('<h3>One-Click Removal</h3></button>');
    expect(html).toContain('<h3>Dust Spots</h3></button>');
    // Each action sits in the shared header row and closes it, like every
    // other section. Removal runs a YOLO detector (ML); dust spots run a
    // classical proposer plus a hand-tuned filter (Auto).
    for (const [heading, next, button, label] of [
      ['<h3>One-Click Removal</h3>', '<h3>Dust Spots</h3>', 'object-removal-ml', 'ML'],
      ['<h3>Dust Spots</h3>', '<h3>Repairs</h3>', 'dust-spots-auto', 'Auto'],
    ] as const) {
      const section = html.slice(html.indexOf(heading), html.indexOf(next));
      expect(section).toContain('section-actions');
      expect(section).toContain(`data-testid="${button}"`);
      expect(section).not.toContain('ml-badge');
      const after = html.slice(html.indexOf(`data-testid="${button}"`), html.indexOf(`data-testid="${button}"`) + 400);
      expect(after).toMatch(new RegExp(`data-testid="${button}"[^>]*>${label}</button></div>`));
    }
    expect(html).not.toContain('data-testid="dust-spots-ml"');
    // The row itself is pushed right.
    expect(cssRule('.section-actions')).toMatch(/margin-left\s*:\s*auto/);
  });

  it('renders every repair action as a golden link, never a grey button', () => {
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
    expect(html).toContain('class="text-button" data-testid="object-removal-apply"');
    expect(html).toContain('class="text-button" data-testid="dust-spots-apply"');
    const idle = renderRepair(idleRemoval, idleDustSpots);
    // Idle has no detect bars: detection runs from the header buttons.
    expect(idle).not.toContain('object-removal-detect');
    expect(idle).not.toContain('dust-spots-detect');
    expect(idle).toContain('class="ml-button" data-testid="object-removal-ml"');
    expect(idle).toContain('class="auto-small" data-testid="dust-spots-auto"');
    // The people retry matches the dust retry: both golden links now.
    const failed = renderRepair(
      { ...idleRemoval, state: 'error', message: 'Photo server unreachable.' },
      { ...idleDustSpots, state: 'error', message: 'Photo server unreachable.' },
    );
    expect(failed).toContain('class="text-button" data-testid="object-removal-retry"');
    expect(failed).toContain('class="text-button" data-testid="dust-spots-retry"');
    // No grey action button survives anywhere in the repair tool.
    for (const render of [html, idle, failed]) {
      expect(render).not.toContain('slim-button');
      expect(render).not.toContain('secondary-button');
    }
  });

  it('dims the apply links through the shared disabled rule when nothing is checked', () => {
    const html = renderRepair(
      {
        ...idleRemoval,
        state: 'ready',
        source: 'onnx',
        detections: [{ label: 'person', score: 0.9, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, checked: false }],
      },
      {
        ...idleDustSpots,
        state: 'ready',
        source: 'ml',
        spots: [{ x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: false }],
      },
    );
    expect(html).toContain('data-testid="object-removal-apply" disabled=""');
    expect(html).toContain('data-testid="dust-spots-apply" disabled=""');
    expect(html).toContain('Remove 0 selected');
    expect(html).toContain('Repair 0 selected');
    // The dim comes from the Task 9 shared rule, reused, not duplicated.
    expect(cssRule('.text-button:disabled')).toContain('opacity: .45');
    expect(cssRule('.text-button:disabled')).toContain('cursor: default');
  });

  it('drops the dead slim-button rules from the sheet', () => {
    expect(css()).not.toMatch(/\.slim-button/);
  });

  it('shows no intro hint block above the repair sections', () => {
    const html = renderRepair(idleRemoval, idleDustSpots);
    expect(html).not.toContain('tool-intro');
    expect(html).not.toContain('Less distraction');
    expect(html).not.toContain('Rebuild small');
    // The sidebar opens straight onto the Brush section.
    expect(html.indexOf('<h3>Brush</h3>')).toBeGreaterThan(-1);
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
