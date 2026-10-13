import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT, STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector, type StraightenAssist } from './Inspector.js';

// Auto-straighten button + revert icon, rendered on the server (no
// jsdom): effects never run, so this pins the markup + prop wiring — one
// Auto button that highlights when a horizon is applied (reverting on a
// second click) plus a revert icon whenever a pre-Auto snapshot exists,
// with no Revert/Dismiss panel — not click behavior.

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

function renderCrop(assist: StraightenAssist): string {
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool="crop"
      histogram={null}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      straightenAssist={assist}
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

const idleAssist: StraightenAssist = {
  state: 'idle',
  angle: null,
  confidence: null,
  message: null,
  snapshot: null,
  onDetect: noop,
  onDismiss: noop,
  onRevert: noop,
};

describe('straighten single-button toggle', () => {
  it('renders one idle Auto pill with no revert icon and no dismiss action', () => {
    const html = renderCrop(idleAssist);
    expect(html).toContain('class="auto-small straighten-auto" data-testid="straighten-auto"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('title="Detect the horizon tilt automatically and apply it"');
    expect(html).toContain('>Auto</button>');
    // No suggestion panel, no revert icon, and no Dismiss button.
    expect(html).not.toContain('straighten-suggestion');
    expect(html).not.toContain('data-testid="straighten-auto-revert"');
    expect(html).not.toContain('>Dismiss</button>');
  });

  it('highlights the button and shows a revert icon once a horizon is applied', () => {
    const html = renderCrop({
      ...idleAssist,
      state: 'ready',
      angle: 2.3,
      confidence: STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD,
      source: 'classic',
      runId: 1,
      snapshot: 0,
    });
    expect(html).toContain('class="auto-small straighten-auto is-active" data-testid="straighten-auto"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="Auto-straighten applied — click to revert"');
    expect(html).toContain('data-testid="straighten-auto-revert"');
    expect(html).toContain('aria-label="Revert auto-straighten"');
    expect(html).not.toContain('straighten-suggestion');
    expect(html).not.toContain('>Dismiss</button>');
  });

  it('keeps the revert icon after a manual edit dismissed the highlight', () => {
    // A manual slider move or 90° rotate dismisses the assist (idle, no
    // highlight) while the hook keeps the snapshot for the revert icon.
    const html = renderCrop({ ...idleAssist, snapshot: 0 });
    expect(html).toContain('class="auto-small straighten-auto" data-testid="straighten-auto"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-testid="straighten-auto-revert"');
  });

  it('leaves the button idle when no horizon was detected', () => {
    // Below-threshold results never apply; the over-photo flash (not the
    // sidebar) carries the message, so the button stays untouched — and
    // the hook drops the snapshot, so no revert icon is owed either.
    const html = renderCrop({
      ...idleAssist,
      state: 'ready',
      angle: 0,
      confidence: STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD - 0.01,
      source: 'classic',
      runId: 1,
    });
    expect(html).toContain('class="auto-small straighten-auto" data-testid="straighten-auto"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('straighten-suggestion');
    expect(html).not.toContain('data-testid="straighten-auto-revert"');
  });

  it('disables the button while detecting', () => {
    const html = renderCrop({ ...idleAssist, state: 'detecting', runId: 1 });
    expect(html).toContain('data-testid="straighten-auto"');
    expect(html).toContain('Detecting…');
    expect(html).toContain('Detecting horizon tilt…');
  });

  it('keeps errors inline in the sidebar', () => {
    const html = renderCrop({ ...idleAssist, state: 'error', message: 'Detection timed out.' });
    expect(html).toContain('Detection timed out.');
    expect(html).toContain('class="auto-small straighten-auto" data-testid="straighten-auto"');
  });
});
