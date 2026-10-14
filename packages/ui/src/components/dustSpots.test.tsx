import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DustSpotsAssist } from './Inspector.js';

// Auto dust-spot assist surfaces, rendered on the server (no jsdom): effects
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

function renderRepair(dustSpots?: DustSpotsAssist): string {
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
        ...(dustSpots === undefined ? {} : { dustSpots }),
      }}
      onChange={noop}
      onRotate={noop}
      onStraighten={noop}
      onReset={noop}
      onAuto={noop}
      onRevertEnhance={noop}
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

describe('dust spots control', () => {
  it('is absent without a dust-spots assist', () => {
    expect(renderRepair()).not.toContain('data-testid="dust-spots"');
  });

  it('runs detection from a right-aligned header Auto button, with no detect bar', () => {
    const html = renderRepair(idleDustSpots);
    expect(html).toContain('data-testid="dust-spots"');
    expect(html).toContain('<h3>Dust Spots</h3></button>');
    // The idle state is just the explanatory note — detection runs from
    // the header Auto button (Face Enhance pattern). The scan is a
    // classical proposer plus a hand-tuned filter — no trained weights
    // run — so the section carries Auto, never ML.
    expect(html).toContain('Scans for dust and spots automatically, then repairs each accepted one like a brush stroke. Nothing is repaired until you apply.');
    expect(html).not.toContain('data-testid="dust-spots-detect"');
    expect(html).not.toContain('>Find dust spots</button>');
    // The Auto action sits in the shared header row (badge gone) and closes
    // it, like every other section.
    const header = html.slice(html.indexOf('<h3>Dust Spots</h3>'), html.indexOf('data-testid="dust-spots"'));
    expect(header).toContain('section-actions');
    expect(header).toContain('data-testid="dust-spots-auto"');
    expect(header).not.toContain('ml-badge');
    const after = html.slice(html.indexOf('data-testid="dust-spots-auto"'), html.indexOf('data-testid="dust-spots-auto"') + 400);
    expect(after).toMatch(/data-testid="dust-spots-auto"[^>]*>Auto<\/button><\/div>/);
    expect(html).toContain('data-tooltip="Find dust spots automatically, then review before repairing"');
  });

  it('keeps the header Auto idle-styled in every state, disabled only while detecting', () => {
    // The assist is ephemeral — apply dismisses back to idle and the
    // strokes live in Repairs — so the button never highlights and the
    // section carries no reset; every click runs a fresh detection.
    const idle = renderRepair(idleDustSpots);
    expect(idle).toContain('class="auto-small" data-testid="dust-spots-auto" aria-pressed="false"');
    expect(idle).not.toContain('aria-label="Reset dust spots"');
    const ready = renderRepair({
      ...idleDustSpots,
      state: 'ready',
      source: 'ml',
      spots: [{ x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: true }],
    });
    expect(ready).toContain('class="auto-small" data-testid="dust-spots-auto" aria-pressed="false"');
    expect(ready).toContain('data-tooltip="Detect dust spots again"');
    expect(ready).not.toContain('aria-label="Reset dust spots"');
    const failed = renderRepair({ ...idleDustSpots, state: 'error', message: 'Photo server unreachable.' });
    expect(failed).toContain('data-tooltip="Detect dust spots again"');
    const working = renderRepair({ ...idleDustSpots, state: 'detecting', progress: { fraction: 0.2, stage: 'Scanning for dust spots…' } });
    expect(working).toContain('data-testid="dust-spots-auto" aria-pressed="false" data-tooltip="Detecting dust spots…" disabled=""');
  });

  it('lists detected spots with per-spot checkboxes and a count apply', () => {
    const html = renderRepair({
      ...idleDustSpots,
      state: 'ready',
      source: 'ml',
      spots: [
        { x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: true },
        { x: 0.7, y: 0.7, radius: 0.015, score: 0.68, polarity: 'bright', checked: false },
      ],
    });
    expect(html).toContain('data-testid="dust-spots-list"');
    expect(html).toContain('Spot 1 · 92%');
    expect(html).toContain('Spot 2 · 68%');
    expect(html).not.toContain('· ML');
    expect(html).toContain('data-testid="dust-spots-apply"');
    expect(html).toContain('Repair 1 selected');
  });

  it('shows spots sorted by confidence descending with each score', () => {
    const html = renderRepair({
      ...idleDustSpots,
      state: 'ready',
      source: 'ml',
      spots: [
        { x: 0.7, y: 0.7, radius: 0.015, score: 0.68, polarity: 'bright', checked: true },
        { x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: true },
        { x: 0.5, y: 0.5, radius: 0.012, score: 0.81, polarity: 'dark', checked: false },
      ],
    });
    const first = html.indexOf('Spot 1 · 92%');
    const second = html.indexOf('Spot 2 · 81%');
    const third = html.indexOf('Spot 3 · 68%');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('keeps the highlight on the hovered spot after sorting', () => {
    const html = renderRepair({
      ...idleDustSpots,
      state: 'ready',
      source: 'ml',
      highlighted: 0, // the 68% spot: lowest score, so it renders as the last row
      spots: [
        { x: 0.7, y: 0.7, radius: 0.015, score: 0.68, polarity: 'bright', checked: true },
        { x: 0.2, y: 0.2, radius: 0.01, score: 0.92, polarity: 'dark', checked: true },
      ],
    });
    expect(html.match(/retouch-group is-highlighted/g)?.length).toBe(1);
    expect(html).toContain('is-highlighted" data-testid="dust-spots-item-1"');
    const row = html.indexOf('dust-spots-item-1');
    expect(html.indexOf('Spot 2 · 68%')).toBeGreaterThan(row);
  });

  it('labels classical results as a scan, never ML', () => {
    const html = renderRepair({
      ...idleDustSpots,
      state: 'ready',
      source: 'classic',
      note: 'Classical scan — the false-positive filter is disabled or its custom weights are unreadable, so this is approximate.',
      spots: [{ x: 0.5, y: 0.5, radius: 0.01, score: 0.5, polarity: 'dark', checked: true }],
    });
    expect(html).toContain('Spot 1 · 50%');
    expect(html).not.toContain('· ML');
    expect(html).toContain('Classical scan');
  });

  it('reports errors with a retry', () => {
    const html = renderRepair({ ...idleDustSpots, state: 'error', message: 'Photo server unreachable.' });
    expect(html).toContain('Photo server unreachable.');
    expect(html).toContain('data-testid="dust-spots-retry"');
  });
});
