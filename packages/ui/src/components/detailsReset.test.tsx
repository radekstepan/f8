import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// Details header reset (Task 12), rendered on the server (no jsdom):
// Details was the last slider section without a header reset. It now
// follows the uniform contract — onReset + dirty, gated by the shared
// AdjustmentSection rule (Task 10: renders only while non-default).

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

describe('Details header reset', () => {
  it('renders no Details reset at defaults', () => {
    const details = sectionSlice(renderAdjust({ ...DEFAULT_EDIT }), 'Details', 'Effects');
    expect(details).not.toContain('section-reset');
    expect(details).not.toContain('aria-label="Reset details"');
  });

  it('persists the Details reset while any of clarity, sharpness, or grain is off defaults', () => {
    for (const patch of [{ clarity: 20 }, { sharpness: 30 }, { grain: 10 }] as const) {
      const details = sectionSlice(renderAdjust({ ...DEFAULT_EDIT, ...patch }), 'Details', 'Effects');
      expect(details, JSON.stringify(patch)).toContain('section-reset is-dirty" title="Reset details"');
    }
  });

  it('keeps the dirty Details reset in the header while collapsed', () => {
    // Details starts collapsed (Task 11); the reset must show without expanding.
    const details = sectionSlice(
      renderAdjust({ ...DEFAULT_EDIT, clarity: 20, sharpness: 30, grain: 10 }),
      'Details',
      'Effects',
    );
    expect(details).toContain('adjustment-section is-collapsed');
    expect(details).toContain('aria-expanded="false"');
    expect(details).toContain('section-reset is-dirty" title="Reset details"');
  });

  it('treats a legacy-disabled Details at default values as clean', () => {
    // Values alone decide dirtiness (the Task 3 convention): the enabled
    // flag flips back on the first slider drag, so a disabled-but-default
    // section renders no reset — and a disabled-but-dirty one still does.
    const clean = sectionSlice(
      renderAdjust({ ...DEFAULT_EDIT, detailsEnabled: false }),
      'Details',
      'Effects',
    );
    expect(clean).not.toContain('aria-label="Reset details"');
    const dirty = sectionSlice(
      renderAdjust({ ...DEFAULT_EDIT, detailsEnabled: false, clarity: 20 }),
      'Details',
      'Effects',
    );
    expect(dirty).toContain('section-reset is-dirty" title="Reset details"');
  });

  it('renders no other section reset for dirty Details values', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, clarity: 20, sharpness: 30, grain: 10 });
    for (const label of ['Reset white balance', 'Reset lightness', 'Reset hue &amp; saturation', 'Reset curves', 'Reset effects']) {
      expect(html, `dirty Details must not render ${label}`).not.toContain(`aria-label="${label}"`);
    }
  });

  it('mirrors the reset patch keys in dirty exactly', () => {
    // Static markup cannot observe the onChange closure, so pin the
    // wiring at the source (the collapsePanels.test.tsx precedent): the
    // reset restores exactly clarity/sharpness/grain, and dirty reads
    // exactly those keys — the reset can never get stuck on.
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain('onReset={() => onChange({ clarity: 0, sharpness: 0, grain: 0 })}');
    expect(inspector).toContain('dirty={edit.clarity !== 0 || edit.sharpness !== 0 || edit.grain !== 0}');
  });
});
