import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo, SelectiveAdjustState } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { SelectiveMaskAssist } from './Inspector.js';

// ML selective-mask control, rendered on the server (no jsdom): effects
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

function assist(overrides: Partial<SelectiveMaskAssist> = {}): SelectiveMaskAssist {
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
    onApply: noop,
    onAdjust: noop,
    onClear: noop,
    onDismiss: noop,
    ...overrides,
  };
}

const APPLIED: SelectiveAdjustState = {
  maskB64: 'eA==',
  maskWidth: 4,
  maskHeight: 4,
  target: 'subject',
  exposure: 0.5,
  contrast: 10,
  saturation: 0,
  source: 'onnx',
};

function renderAdjust(edit: EditState, selectiveAssist?: SelectiveMaskAssist): string {
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
      {...(selectiveAssist === undefined ? {} : { selectiveAssist })}
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

describe('selective mask control', () => {
  it('is absent without a selective assist', () => {
    expect(renderAdjust({ ...DEFAULT_EDIT })).not.toContain('data-testid="selective-mask"');
  });

  it('offers ML brighten-subject-only with an ML badge', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, assist());
    expect(html).toContain('data-testid="selective-mask"');
    expect(html).toContain('data-testid="selective-mask-detect"');
    expect(html).toContain('Brighten Subject Only');
    expect(html).toContain('ml-badge');
    expect(html).toContain('>ML<');
  });

  it('summarizes an ML result with target toggle, sliders, and apply', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ state: 'ready', found: true, coverage: 0.23, source: 'onnx' }),
    );
    expect(html).toContain('data-testid="selective-mask-summary"');
    expect(html).toContain('Subject 23%');
    expect(html).toContain('· ML');
    expect(html).toContain('data-testid="selective-mask-target-subject"');
    expect(html).toContain('data-testid="selective-mask-target-background"');
    expect(html).toContain('data-testid="selective-mask-exposure"');
    expect(html).toContain('data-testid="selective-mask-contrast"');
    expect(html).toContain('data-testid="selective-mask-saturation"');
    expect(html).toContain('data-testid="selective-mask-apply"');
    expect(html).toContain('Apply to subject');
  });

  it('labels classical results as a scan and omits the ML tag', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({
        state: 'ready',
        found: true,
        coverage: 0.31,
        source: 'classic',
        note: 'Classical scan — ML weights are still downloading or offline, so this is approximate.',
      }),
    );
    expect(html).toContain('Subject 31%');
    expect(html).toContain('Classical scan');
    expect(html).toContain('data-testid="selective-mask-apply"');
    expect(html).not.toContain('· ML');
  });

  it('reports no subject and offers retry on error', () => {
    const empty = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'ready', found: false, coverage: 0, source: 'onnx' }));
    expect(empty).toContain('No subject found.');
    const classicalEmpty = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'ready', found: false, coverage: 0, source: 'classic' }));
    expect(classicalEmpty).toContain('No subject found by the classical scan.');
    const failed = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'error', message: 'Photo server unreachable.' }));
    expect(failed).toContain('Photo server unreachable.');
    expect(failed).toContain('data-testid="selective-mask-retry"');
  });

  it('shows the applied badge with live sliders, rescan, and clear', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    expect(html).toContain('data-testid="selective-mask-applied"');
    expect(html).toContain('Subject · +0.5 EV · C +10 · ML');
    expect(html).toContain('data-testid="selective-mask-applied-exposure"');
    expect(html).toContain('data-testid="selective-mask-applied-target-background"');
    expect(html).toContain('data-testid="selective-mask-redetect"');
    expect(html).toContain('data-testid="selective-mask-clear"');
  });

  it('summarizes a background-target adjust without an ML tag for classical masks', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: { ...APPLIED, target: 'background', exposure: 0, contrast: 0, saturation: -20, source: 'classic' } },
      assist({ applied: { ...APPLIED, target: 'background', exposure: 0, contrast: 0, saturation: -20, source: 'classic' } }),
    );
    expect(html).toContain('Background · S -20');
    expect(html).not.toContain('· ML');
  });
});
