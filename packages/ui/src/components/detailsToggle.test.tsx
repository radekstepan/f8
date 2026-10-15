import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// Details carries the shared dirtiness switch (Task 11 dropped the old
// visibility toggle, which drove the same local state as the disclosure
// chevron; the switch is back with new semantics — on while the sliders
// are off defaults, resetting on click). The real enable/disable
// semantics (the detailsEnabled recipe flag) live in the edit + the
// slider re-enable wiring, untouched by this change. Rendered on the
// server (no jsdom): pins markup + prop wiring, not click behavior.

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

/** One section's markup, from its <section> open tag to the next heading. */
function sectionSlice(html: string, title: string, nextTitle: string): string {
  const heading = html.indexOf(`<h3>${title}</h3>`);
  const start = html.lastIndexOf('<section', heading);
  const end = html.indexOf(`<h3>${nextTitle}</h3>`);
  return html.slice(start, end);
}

describe('Details header toggle', () => {
  it('renders the dirtiness switch in the Details header', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).not.toContain('Show details');
    const details = sectionSlice(html, 'Details', 'Effects');
    expect(details).toContain('class="toggle" data-testid="details-toggle"');
    expect(details).toContain('role="switch"');
    expect(details).toContain('aria-checked="false"');
    expect(details).toContain('aria-label="Details"');
  });

  it('collapses Details through the shared disclosure, like Curves and Effects', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    // Same collapsed shape three times: collapsed section class,
    // collapsed disclosure, hidden sliders, switch in the header.
    for (const [title, next, toggle] of [['Curves', 'Details', 'curves-toggle'], ['Details', 'Effects', 'details-toggle']] as const) {
      const section = sectionSlice(html, title, next);
      expect(section).toContain('adjustment-section is-collapsed');
      expect(section).toContain('aria-expanded="false"');
      expect(section).toContain('lucide-chevron-right');
      expect(section).toContain(`class="toggle" data-testid="${toggle}"`);
    }
    // Scoped to the Details slice: the open Selective Clarity section
    // below owns its own Texture/Clarity sliders.
    const detailsOnly = sectionSlice(html, 'Details', 'Selective Clarity');
    expect(detailsOnly).not.toContain('>Clarity</label>');
    expect(detailsOnly).not.toContain('>Sharpness</label>');
    expect(detailsOnly).not.toContain('>Grain</label>');
  });

  it('lights the Details switch with dirty sliders (no reset beside it)', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, clarity: 20, sharpness: 30, grain: 10 });
    expect(html).not.toContain('Show details');
    const details = sectionSlice(html, 'Details', 'Effects');
    expect(details).toContain('class="toggle is-on" data-testid="details-toggle"');
    expect(details).toContain('aria-checked="true"');
    expect(details).toContain('aria-expanded="false"');
    expect(details).not.toContain('section-reset');
    expect(details).not.toContain('aria-label="Reset details"');
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

  it('gives Black & White the shared header switch: toggle plus content button, no reset', () => {
    // Black & White flips both ways from its header switch (off-to-on
    // converts, on-to-off restores color), so the switch is the state
    // indicator every other section has — the explicit content button
    // ("Make Black & White"/"Restore Color") stays as the labeled action,
    // and the old header reset is gone. The section always renders (the
    // retired "Add Adjustment" gate is gone), so the wiring pins at
    // source level.
    const inspector = source('Inspector.tsx');
    const start = inspector.indexOf('title="Black & White"');
    expect(start).toBeGreaterThan(-1);
    const blackAndWhite = inspector.slice(start, inspector.indexOf('</AdjustmentSection>', start));
    expect(blackAndWhite).toContain("toggle={{ id: 'black-and-white', checked: edit.blackAndWhite");
    expect(blackAndWhite).toContain('onToggle: () => onChange({ blackAndWhite: !edit.blackAndWhite })');
    expect(blackAndWhite).not.toContain('onReset');
    expect(blackAndWhite).not.toContain('dirty=');
    expect(blackAndWhite).toContain('Restore Color');
    expect(blackAndWhite).toContain('Make Black & White');
  });
});
