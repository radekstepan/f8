import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';

// Details drops its header toggle (Task 11): the toggle drove the same
// local visibility state as the disclosure chevron — a leftover from when
// every slider section had one — while the real enable/disable semantics
// (the detailsEnabled recipe flag) live in the edit + the slider
// re-enable wiring, untouched by this change. Rendered on the server (no
// jsdom): pins markup + prop wiring, not click behavior.

const here = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(resolve(here, file), 'utf8');

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

/** One section's markup, from its <section> open tag to the next heading. */
function sectionSlice(html: string, title: string, nextTitle: string): string {
  const heading = html.indexOf(`<h3>${title}</h3>`);
  const start = html.lastIndexOf('<section', heading);
  const end = html.indexOf(`<h3>${nextTitle}</h3>`);
  return html.slice(start, end);
}

describe('Details without a header toggle', () => {
  it('renders no toggle in the Details header', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).not.toContain('Show details');
    const details = sectionSlice(html, 'Details', 'Effects');
    expect(details).not.toContain('role="switch"');
    expect(details).not.toContain('aria-checked');
  });

  it('collapses Details through the shared disclosure, like Curves and Effects', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    // Same collapsed shape three times: collapsed section class,
    // collapsed disclosure, hidden sliders.
    for (const [title, next] of [['Curves', 'Details'], ['Details', 'Effects']] as const) {
      const section = sectionSlice(html, title, next);
      expect(section).toContain('adjustment-section is-collapsed');
      expect(section).toContain('aria-expanded="false"');
      expect(section).toContain('lucide-chevron-right');
      expect(section).not.toContain('role="switch"');
    }
    expect(html).not.toContain('>Clarity</label>');
    expect(html).not.toContain('>Sharpness</label>');
    expect(html).not.toContain('>Grain</label>');
  });

  it('keeps Details toggle-free with dirty sliders (reset arrives in Task 12)', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, clarity: 20, sharpness: 30, grain: 10 });
    expect(html).not.toContain('Show details');
    const details = sectionSlice(html, 'Details', 'Effects');
    expect(details).not.toContain('role="switch"');
    expect(details).toContain('aria-expanded="false"');
  });

  it('preserves the detailsEnabled recipe semantics outside the header', () => {
    // The flag still defaults on and still gates the render path (core
    // pins the gating); the header never touched it.
    expect(DEFAULT_EDIT.detailsEnabled).toBe(true);
    // Static markup cannot observe the onChange closure, so pin the
    // wiring at the source, the collapsePanels.test.tsx precedent: every
    // Details slider still flows through rangeEnabled with detailsEnabled,
    // re-enabling a legacy-disabled category on first drag.
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain("rangeEnabled('detailsEnabled', 'clarity', 'Clarity')");
    expect(inspector).toContain("rangeEnabled('detailsEnabled', 'sharpness', 'Sharpness'");
    expect(inspector).toContain("rangeEnabled('detailsEnabled', 'grain', 'Grain'");
    // A legacy-disabled recipe still renders its collapsed Details
    // heading — nothing depended on the removed visibility state.
    const html = renderAdjust({ ...DEFAULT_EDIT, detailsEnabled: false });
    expect(html).toContain('<h3>Details</h3>');
    expect(sectionSlice(html, 'Details', 'Effects')).toContain('aria-expanded="false"');
  });

  it('keeps the shared onToggle path for semantic toggles (Black & White)', () => {
    // Only Details' visibility-duplicate toggle went away: a section whose
    // toggle carries real effect state still renders its switch.
    const html = renderToStaticMarkup(
      <AdjustmentSection title="Black & White" icon={<i />} enabled toggleLabel="Enable black & white" onToggle={noop}>
        <span>slider-stub</span>
      </AdjustmentSection>,
    );
    expect(html).toContain('role="switch" aria-checked="true" aria-label="Enable black &amp; white"');
  });
});
