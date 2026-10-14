import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { FaceEnhanceAssist } from './Inspector.js';

// ML face-enhance control, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior.

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

function assist(overrides: Partial<FaceEnhanceAssist> = {}): FaceEnhanceAssist {
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
    ...overrides,
  };
}

function renderAdjust(edit: EditState, faceAssist?: FaceEnhanceAssist): string {
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
      {...(faceAssist === undefined ? {} : { faceAssist })}
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

describe('face enhance control', () => {
  it('is absent without a face assist', () => {
    expect(renderAdjust({ ...DEFAULT_EDIT })).not.toContain('data-testid="face-enhance"');
  });

  it('runs face detection from a header toggle with an ML badge, never a repeated bar', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, assist());
    expect(html).toContain('data-testid="face-enhance"');
    expect(html).toContain('data-testid="face-enhance-toggle"');
    expect(html).toContain('class="toggle" data-testid="face-enhance-toggle"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('data-tooltip="Detect faces with ML"');
    // A model runs here, so the tool name carries the little ML badge.
    expect(html).toContain('<h3>Enhance Faces</h3><span class="ml-badge"');
    expect(html).toContain('Nothing changes until you apply');
    // No detect bar repeating the section title, no header button, no reset.
    expect(html).not.toContain('data-testid="face-enhance-detect"');
    expect(html).not.toContain('data-testid="face-enhance-ml"');
    expect(html).not.toContain('aria-label="Reset enhance faces"');
  });

  it('keeps the section title visible before and after applying', () => {
    const idle = renderAdjust({ ...DEFAULT_EDIT }, assist());
    expect(idle).toContain('<h3>Enhance Faces</h3>');
    expect(idle).toContain('data-testid="face-enhance-toggle"');
    const applied = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ applied: { faces: 1, source: 'onnx', enabled: true, liftAmount: 0.4, redEyeCount: 0 } }),
    );
    expect(applied).toContain('<h3>Enhance Faces</h3>');
    expect(applied).toContain('data-testid="face-enhance-toggle"');
    expect(applied).not.toContain('aria-label="Reset enhance faces"');
    expect(applied).not.toContain('data-testid="face-enhance-detect"');
  });

  it('lights the header toggle while a face adjust is stored, with no reset beside it', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ applied: { faces: 1, source: 'onnx', enabled: true, liftAmount: 0.4, redEyeCount: 0 } }),
    );
    expect(html).toContain('class="toggle is-on" data-testid="face-enhance-toggle"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-tooltip="Face enhance on — click to clear"');
    expect(html).not.toContain('aria-label="Reset enhance faces"');
  });

  it('summarizes an ML result with skin WB, lift, and red-eye', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({
        state: 'ready',
        faces: 2,
        source: 'onnx',
        whiteBalance: { temperature: 5600, tint: 4 },
        skinAnchored: true,
        liftAmount: 0.4,
        redEyeCount: 1,
      }),
    );
    expect(html).toContain('data-testid="face-enhance-summary"');
    expect(html).toContain('2 faces');
    expect(html).toContain('skin WB 5600K +4');
    expect(html).toContain('lift +0.4 EV');
    expect(html).toContain('1 red-eye');
    expect(html).toContain('· ML');
    expect(html).toContain('class="text-button" data-testid="face-enhance-apply"');
    expect(html).not.toContain('slim-button');
  });

  it('labels classical results as a scan and omits the ML tag', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({
        state: 'ready',
        faces: 1,
        source: 'classic',
        whiteBalance: { temperature: 5800, tint: 0 },
        skinAnchored: false,
        note: 'Classical scan — ML weights are still downloading or offline, so this is approximate.',
      }),
    );
    expect(html).toContain('1 face');
    expect(html).toContain('Classical scan');
    expect(html).not.toContain('· ML');
  });

  it('reports no faces and offers retry on error', () => {
    const empty = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'ready', faces: 0, source: 'onnx' }));
    expect(empty).toContain('No faces found.');
    const failed = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'error', message: 'Photo server unreachable.' }));
    expect(failed).toContain('Photo server unreachable.');
    expect(failed).toContain('data-testid="face-enhance-retry"');
  });

  it('shows a recorded no-face scan without the toggle, with rescan and clear', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ applied: { faces: 0, source: 'onnx', enabled: true, liftAmount: 0, redEyeCount: 0 } }),
    );
    expect(html).toContain('data-testid="face-enhance-applied"');
    expect(html).toContain('>No faces found<');
    expect(html).not.toContain('· ML');
    expect(html).not.toContain('0 faces');
    expect(html).toContain('Checked — no faces found. Rescan to run detection again.');
    // Nothing to bypass, so no toggle — but the scan clears like a hit.
    expect(html).not.toContain('aria-label="Enable face enhance"');
    expect(html).toContain('data-testid="face-enhance-redetect"');
    expect(html).toContain('data-testid="face-enhance-clear"');
    expect(html).toContain('Remove the recorded no-face scan');
    // No change was applied, so the header stays quiet: the toggle is
    // off (back to offering a fresh scan) and no reset renders.
    expect(html).toContain('class="toggle" data-testid="face-enhance-toggle"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('data-tooltip="Detect faces with ML"');
    expect(html).not.toContain('aria-label="Reset enhance faces"');
  });

  it('labels a recorded classical no-face scan without the ML tag', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ applied: { faces: 0, source: 'classic', enabled: true, liftAmount: 0, redEyeCount: 0 } }),
    );
    expect(html).toContain('>No faces found<');
    expect(html).not.toContain('· ML');
    expect(html).not.toContain('aria-label="Enable face enhance"');
  });

  it('shows the applied badge with rescan and clear', () => {
    const html = renderAdjust(
      {
        ...DEFAULT_EDIT,
        faceAdjust: { boxes: [{ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }], amount: 0.4, redEye: [], source: 'onnx' },
      },
      assist({ applied: { faces: 1, source: 'onnx', enabled: true, liftAmount: 0.4, redEyeCount: 0 } }),
    );
    expect(html).toContain('data-testid="face-enhance-applied"');
    expect(html).toContain('1 face · lift +0.4 EV · ML');
    expect(html).toContain('data-testid="face-enhance-redetect"');
    expect(html).toContain('data-testid="face-enhance-clear"');
  });

  it('shows a progress bar the whole time detection runs, even before the first report', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'detecting', progress: null }));
    expect(html).toContain('data-testid="ml-progress"');
    expect(html).toContain('Preparing photo…');
    expect(html).toContain('data-testid="face-enhance-cancel"');
  });

  it('toggles the stored adjust off and on without deleting it', () => {
    const on = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ applied: { faces: 2, source: 'onnx', enabled: true, liftAmount: 0.4, redEyeCount: 1 } }),
    );
    expect(on).toContain('aria-label="Enable face enhance"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('2 faces · lift +0.4 EV · 1 red-eye · ML');
    expect(on).not.toContain('scene-enhance-scene is-off');
    const off = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ applied: { faces: 2, source: 'onnx', enabled: false, liftAmount: 0.4, redEyeCount: 1 } }),
    );
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('is-off');
    // The badge stays with rescan/clear so the stored adjust survives the toggle.
    expect(off).toContain('data-testid="face-enhance-redetect"');
    expect(off).toContain('data-testid="face-enhance-clear"');
    // The header toggle means "face adjust stored", not "enabled" —
    // the content toggle owns on/off, so bypassing keeps the header on.
    expect(off).toContain('class="toggle is-on" data-testid="face-enhance-toggle"');
    expect(off).not.toContain('aria-label="Reset enhance faces"');
  });
});
