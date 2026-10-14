import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// Details header toggle (the Task 12 header reset, converted), rendered
// on the server (no jsdom): Details follows the uniform switch contract
// — the toggle lights while clarity, sharpness, or grain is off defaults
// and resets on click, disabled while off since Details has no automatic
// action — with no reset button in the header.

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
  it('renders the Details switch off and disabled at defaults', () => {
    const details = sectionSlice(renderAdjust({ ...DEFAULT_EDIT }), 'Details', 'Effects');
    expect(details).toContain('class="toggle" data-testid="details-toggle"');
    expect(details).toContain('data-tooltip="Details at defaults"');
    const tag = details.match(/<button[^>]*data-testid="details-toggle"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('disabled');
    expect(details).not.toContain('section-reset');
    expect(details).not.toContain('aria-label="Reset details"');
  });

  it('lights the Details switch while any of clarity, sharpness, or grain is off defaults', () => {
    for (const patch of [{ clarity: 20 }, { sharpness: 30 }, { grain: 10 }] as const) {
      const details = sectionSlice(renderAdjust({ ...DEFAULT_EDIT, ...patch }), 'Details', 'Effects');
      expect(details, JSON.stringify(patch)).toContain('class="toggle is-on" data-testid="details-toggle"');
      expect(details, JSON.stringify(patch)).toContain('data-tooltip="Details on — click to reset to defaults"');
      expect(details, JSON.stringify(patch)).not.toContain('section-reset');
    }
  });

  it('keeps the lit Details switch in the header while collapsed', () => {
    // Details starts collapsed (Task 11); the switch must show without expanding.
    const details = sectionSlice(
      renderAdjust({ ...DEFAULT_EDIT, clarity: 20, sharpness: 30, grain: 10 }),
      'Details',
      'Effects',
    );
    expect(details).toContain('adjustment-section is-collapsed');
    expect(details).toContain('aria-expanded="false"');
    expect(details).toContain('class="toggle is-on" data-testid="details-toggle"');
  });

  it('treats a legacy-disabled Details at default values as clean', () => {
    // Values alone decide dirtiness (the Task 3 convention): the enabled
    // flag flips back on the first slider drag, so a disabled-but-default
    // section renders its switch off — and a disabled-but-dirty one lit.
    const clean = sectionSlice(
      renderAdjust({ ...DEFAULT_EDIT, detailsEnabled: false }),
      'Details',
      'Effects',
    );
    expect(clean).toContain('class="toggle" data-testid="details-toggle"');
    const dirty = sectionSlice(
      renderAdjust({ ...DEFAULT_EDIT, detailsEnabled: false, clarity: 20 }),
      'Details',
      'Effects',
    );
    expect(dirty).toContain('class="toggle is-on" data-testid="details-toggle"');
  });

  it('lights no other section switch for dirty Details values', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, clarity: 20, sharpness: 30, grain: 10 });
    expect(html).toContain('class="toggle is-on" data-testid="details-toggle"');
    for (const toggle of ['white-balance-toggle', 'lightness-toggle', 'color-toggle', 'curves-toggle', 'effects-toggle']) {
      expect(html, `dirty Details must not light ${toggle}`).toContain(`class="toggle" data-testid="${toggle}"`);
    }
  });

  it('mirrors the toggle-off patch keys in the dirtiness check exactly', () => {
    // Static markup cannot observe the onToggle closure, so pin the
    // wiring at the source (the collapsePanels.test.tsx precedent): the
    // toggle-off restores exactly clarity/sharpness/grain, and the
    // dirtiness flag reads exactly those keys — the switch can never get
    // stuck on.
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain('onToggle: () => onChange({ clarity: 0, sharpness: 0, grain: 0 })');
    expect(inspector).toContain('const detailsDirty = edit.clarity !== 0 || edit.sharpness !== 0 || edit.grain !== 0;');
  });
});
