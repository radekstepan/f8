import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { RepairAssist } from './Inspector.js';

// Silent repair warmup: entering the Repair tool prefetches the ML tier in
// the background, but that check must not surface a progress bar or a
// "Cancel repair" button — those belong to a user-started heal only.
// Rendered on the server (no jsdom): pins the markup, not live behavior.

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

function renderRepair(overrides: Partial<RepairAssist> = {}): string {
  const repairAssist: RepairAssist = {
    method: 'ml-heal',
    quality: 'balanced',
    seamlessLight: false,
    featherPx: 2,
    status: 'ready',
    mlProgress: null,
    serverDown: false,
    onCancelHeal: noop,
    onRetry: noop,
    onMethodChange: noop,
    onQualityChange: noop,
    onSeamlessLightChange: noop,
    onFeatherChange: noop,
    ...overrides,
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

describe('silent repair warmup', () => {
  it.each([
    ['server check', { fraction: 0, stage: 'Checking photo server…' }],
    ['model download', { fraction: 0.45, stage: 'Downloading models… 45%' }],
    ['model prep', { fraction: 0, stage: 'Preparing models…' }],
  ])('hides the warmup %s: no progress bar, no Cancel repair', (_name, stage) => {
    const html = renderRepair({ mlProgress: { ...stage, job: 'warmup', areas: null } });
    expect(html).not.toContain('data-testid="ml-progress"');
    expect(html).not.toContain('data-testid="ml-cancel"');
    expect(html).not.toContain('Cancel repair');
  });

  it('hides the warmup success note: Server ready stays silent', () => {
    const html = renderRepair({ mlProgress: { fraction: 1, stage: 'Server ready.', job: 'warmup', areas: null, updatedAt: Date.now() } });
    expect(html).not.toContain('data-testid="ml-progress"');
    expect(html).not.toContain('Server ready.');
  });

  it('still shows progress + Cancel repair for a user-started heal', () => {
    const html = renderRepair({ mlProgress: { fraction: 0.4, stage: 'Neural fill…', job: 'heal', areas: 2, updatedAt: Date.now() } });
    expect(html).toContain('data-testid="ml-progress"');
    expect(html).toContain('data-testid="ml-cancel"');
    expect(html).toContain('Cancel repair');
  });

  it('still surfaces a warmup failure as an error (without Cancel repair)', () => {
    const html = renderRepair({ mlProgress: { fraction: 0, stage: 'Model unavailable: Photo server is still preparing models — try again shortly.', job: 'warmup', areas: null } });
    expect(html).toContain('data-testid="ml-progress"');
    expect(html).toContain('Model unavailable');
    expect(html).not.toContain('data-testid="ml-cancel"');
  });

  it('still replaces quality + progress with the offline line when the server is down', () => {
    const html = renderRepair({ serverDown: true, mlProgress: { fraction: 0, stage: 'Checking photo server…', job: 'warmup', areas: null } });
    expect(html).toContain('data-testid="ml-offline"');
    expect(html).toContain('data-testid="ml-retry"');
    expect(html).not.toContain('data-testid="ml-progress"');
    expect(html).not.toContain('data-testid="ml-cancel"');
  });

  it('keeps non-ML methods free of repair progress entirely', () => {
    const html = renderRepair({ method: 'heal', mlProgress: { fraction: 0.4, stage: 'Repairing…', job: 'heal', areas: 1 } });
    expect(html).not.toContain('data-testid="ml-progress"');
    expect(html).not.toContain('data-testid="ml-cancel"');
  });
});
