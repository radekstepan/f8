import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';

// No hover-tease reset on clean sections (Task 10), rendered on the server
// (no jsdom): a section at defaults renders no reset control at all — the
// hover-only base Task 3 kept for Curves/Effects is retired, and the same
// gate covers every other slider section.

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

function renderAdjust(edit: EditState): string {
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

/** Markup of the Curves section only, bounded by its neighboring headings. */
function curvesSection(html: string): string {
  return html.slice(html.indexOf('<h3>Curves</h3>'), html.indexOf('<h3>Details</h3>'));
}

/** Markup of the Effects section only, bounded by its neighbors (Details, end of adjust). */
function effectsSection(html: string): string {
  return html.slice(html.indexOf('<h3>Effects</h3>'));
}

describe('no reset on clean sections', () => {
  it('renders no Curves reset until the curve leaves defaults', () => {
    const clean = curvesSection(renderAdjust({ ...DEFAULT_EDIT }));
    expect(clean).not.toContain('section-reset');
    expect(clean).not.toContain('aria-label="Reset curves"');
    const dirty = curvesSection(renderAdjust({ ...DEFAULT_EDIT, curve: 25 }));
    expect(dirty).toContain('section-reset is-dirty" title="Reset curves"');
  });

  it('renders no Effects reset until vignette or fade leaves defaults', () => {
    const clean = effectsSection(renderAdjust({ ...DEFAULT_EDIT }));
    expect(clean).not.toContain('section-reset');
    expect(clean).not.toContain('aria-label="Reset effects"');
    for (const patch of [{ vignette: 40 }, { fade: 15 }]) {
      const dirty = effectsSection(renderAdjust({ ...DEFAULT_EDIT, ...patch }));
      expect(dirty, JSON.stringify(patch)).toContain('section-reset is-dirty" title="Reset effects"');
    }
  });

  it('renders no reset in any clean slider section — the gate is shared, not per-section', () => {
    // Curves/Effects were the report, but White Balance, Lightness, and
    // Hue & Saturation passed the same unconditional onReset: the
    // AdjustmentSection gate fixes all five at once.
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).not.toContain('section-reset');
  });

  it('gates the shared header control on dirtiness or a live snapshot', () => {
    const section = (props: Partial<React.ComponentProps<typeof AdjustmentSection>>) =>
      renderToStaticMarkup(
        <AdjustmentSection title="Curves" icon={<i />} onReset={noop} {...props}>
          <span>slider-stub</span>
        </AdjustmentSection>,
      );
    // onReset alone renders nothing: the hover-tease state is gone.
    expect(section({})).not.toContain('section-reset');
    // Dirty values render the persistent reset.
    expect(section({ dirty: true })).toContain('section-reset is-dirty" title="Reset curves"');
    // A live snapshot renders it even at default values.
    expect(
      section({ ml: { id: 'curves', applied: false, canRevert: true, onToggle: noop, onRevert: noop } }),
    ).toContain('section-reset is-dirty" title="Reset curves"');
  });
});
