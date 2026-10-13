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
    onAdjust: noop,
    onToggle: noop,
    onClear: noop,
    onDismiss: noop,
    ...overrides,
  };
}

const APPLIED: SelectiveAdjustState = {
  maskB64: 'eA==',
  maskWidth: 4,
  maskHeight: 4,
  subject: { exposure: 0.5, contrast: 10, saturation: 0 },
  background: { exposure: 0, contrast: 0, saturation: 0 },
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
      onRevertEnhance={noop}
      {...(selectiveAssist === undefined ? {} : { selectiveAssist })}
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

describe('selective mask control', () => {
  it('is absent without a selective assist', () => {
    expect(renderAdjust({ ...DEFAULT_EDIT })).not.toContain('data-testid="selective-mask"');
  });

  it('runs segmentation from a header ML button, never a full-width bar', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, assist());
    expect(html).toContain('data-testid="selective-mask"');
    expect(html).toContain('data-testid="selective-mask-ml"');
    expect(html).toContain('class="ml-button" data-testid="selective-mask-ml"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('title="Automatically adjust subject &amp; background with ML"');
    expect(html).toContain('>ML<');
    expect(html).toContain('Changes save automatically');
    // No detect bar in the content and no badge doubling the header button.
    expect(html).not.toContain('data-testid="selective-mask-detect"');
    expect(html).not.toContain('Enhance Subject &amp; Background');
    expect(html).not.toContain('ml-badge');
    expect(html).not.toContain('data-testid="selective-mask-ml-revert"');
  });

  it('keeps the section title visible before and after detection', () => {
    // The title names the action in every state, so the sliders always
    // have a visible group; the header ML button drives segment/clear.
    const idle = renderAdjust({ ...DEFAULT_EDIT }, assist());
    expect(idle).toContain('<h3>Subject &amp; Background</h3>');
    expect(idle).toContain('data-testid="selective-mask-ml"');
    const applied = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    expect(applied).toContain('<h3>Subject &amp; Background</h3>');
    expect(applied).toContain('data-testid="selective-mask-ml"');
    expect(applied).toContain('data-testid="selective-mask-ml-revert"');
    expect(applied).not.toContain('data-testid="selective-mask-detect"');
  });

  it('highlights the header ML button and offers revert while a mask is stored', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    expect(html).toContain('class="ml-button is-active" data-testid="selective-mask-ml"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="ML subject &amp; background applied — click to revert"');
    expect(html).toContain('data-testid="selective-mask-ml-revert"');
    expect(html).toContain('aria-label="Revert ML subject &amp; background"');
  });

  it('auto-applies an ML result with no apply step or target toggle', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ state: 'ready', found: true, coverage: 0.23, source: 'onnx' }),
    );
    expect(html).toContain('data-testid="selective-mask-summary"');
    expect(html).toContain('Subject 23%');
    expect(html).toContain('· ML');
    expect(html).toContain('applying to photo');
    expect(html).not.toContain('data-testid="selective-mask-apply"');
    expect(html).not.toContain('-target-subject');
    expect(html).not.toContain('-target-background');
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

  it('shows an on-toggle with both live slider groups, rescan, and clear', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    expect(html).toContain('aria-label="Enable subject and background enhance"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-testid="selective-mask-subject-group"');
    expect(html).toContain('data-testid="selective-mask-subject-exposure"');
    expect(html).toContain('data-testid="selective-mask-subject-contrast"');
    expect(html).toContain('data-testid="selective-mask-background-group"');
    expect(html).toContain('data-testid="selective-mask-background-exposure"');
    expect(html).toContain('data-testid="selective-mask-background-saturation"');
    expect(html).toContain('data-testid="selective-mask-redetect"');
    expect(html).toContain('data-testid="selective-mask-clear"');
    expect(html).not.toContain('data-testid="selective-mask-apply"');
    expect(html).not.toContain('data-testid="selective-mask-detect"');
  });

  it('drops the golden settings summary — the sliders show the values', () => {
    const both: SelectiveAdjustState = {
      ...APPLIED,
      subject: { exposure: 0.5, contrast: 0, saturation: 0 },
      background: { exposure: 0, contrast: 0, saturation: -20 },
      source: 'classic',
    };
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: both },
      assist({ applied: both }),
    );
    expect(html).not.toContain('data-testid="selective-mask-applied"');
    expect(html).not.toContain('Subject (+0.5 EV)');
    expect(html).not.toContain('Background (S -20)');
    expect(html).not.toContain('No changes yet');
    // The sliders themselves still carry both sides' values.
    expect(html).toContain('data-testid="selective-mask-subject-exposure"');
    expect(html).toContain('data-testid="selective-mask-background-saturation"');
  });

  it('keeps the sliders on a stored-but-neutral mask instead of an empty state', () => {
    const neutral: SelectiveAdjustState = {
      ...APPLIED,
      subject: { exposure: 0, contrast: 0, saturation: 0 },
      background: { exposure: 0, contrast: 0, saturation: 0 },
    };
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: neutral },
      assist({ applied: neutral }),
    );
    expect(html).toContain('aria-label="Enable subject and background enhance"');
    expect(html).toContain('data-testid="selective-mask-subject-exposure"');
    expect(html).toContain('data-testid="selective-mask-background-exposure"');
    expect(html).not.toContain('data-testid="selective-mask-detect"');
  });

  it('toggles the stored adjust off and on without deleting the mask', () => {
    const on = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    expect(on).toContain('aria-checked="true"');
    const off = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: { ...APPLIED, enabled: false } },
      assist({ applied: { ...APPLIED, enabled: false } }),
    );
    expect(off).toContain('aria-label="Enable subject and background enhance"');
    expect(off).toContain('aria-checked="false"');
    // The sliders and rescan/clear stay, so values survive the toggle.
    expect(off).toContain('data-testid="selective-mask-subject-exposure"');
    expect(off).toContain('data-testid="selective-mask-background-exposure"');
    expect(off).toContain('data-testid="selective-mask-redetect"');
    expect(off).toContain('data-testid="selective-mask-clear"');
    // The header ML highlight means "mask stored", not "enabled" — the
    // content toggle owns on/off, so bypassing keeps the highlight.
    expect(off).toContain('class="ml-button is-active" data-testid="selective-mask-ml"');
    expect(off).toContain('data-testid="selective-mask-ml-revert"');
  });
});
