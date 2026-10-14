import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector, ToneCurveEditor } from './Inspector.js';

// Curves reset + addable points, rendered on the server (no jsdom): pins
// the markup + prop wiring — the Midtones slider carries no double-click
// reset (the header reset owns that now), and each anchor renders as a
// keyboard-focusable dot — not pointer behavior (see toneCurve.test.ts
// for the add/move/remove reducers the gestures call into). The graph
// renders through the exported editor: the Curves section starts
// collapsed, so the Inspector markup never includes its children.

const here = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(resolve(here, file), 'utf8');
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

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

function renderGraph(edit: EditState): string {
  return renderToStaticMarkup(
    <ToneCurveEditor points={edit.curvePoints} midtone={edit.curve} onChange={noop} />,
  );
}

/** One section's markup, from its <section> open tag to the next heading. */
function sectionSlice(html: string, title: string, nextTitle: string): string {
  const heading = html.indexOf(`<h3>${title}</h3>`);
  const start = html.lastIndexOf('<section', heading);
  const end = html.indexOf(`<h3>${nextTitle}</h3>`);
  return html.slice(start, end);
}

const curvesSection = (html: string): string => sectionSlice(html, 'Curves', 'Details');

describe('Curves reset and points', () => {
  it('renders no Curves reset at defaults', () => {
    const curves = curvesSection(renderAdjust({ ...DEFAULT_EDIT }));
    expect(curves).not.toContain('section-reset');
    expect(curves).not.toContain('aria-label="Reset curves"');
  });

  it('draws the graph with add instructions and no dots at defaults', () => {
    const graph = renderGraph({ ...DEFAULT_EDIT });
    expect(graph).not.toContain('curve-point');
    expect(graph).toContain('Tone curve graph. Click the line to add a point');
    expect(graph).toContain('data-tooltip="Click the line to add a point — drag points to reshape, right-click one to remove"');
    // Default line is the pinned diagonal (see toneCurveDisplayPath tests
    // for the bend/anchor shapes; here only the shell is pinned).
    expect(graph).toContain('M0 160');
    expect(graph).toContain('L240 0');
  });

  it('drops the double-click reset from the Midtones slider only', () => {
    // The Curves section starts collapsed, so the slider wiring is pinned
    // at the source (the detailsReset.test.tsx precedent): Midtones opts
    // out because the header reset owns Curves resets now — and it is the
    // only slider in the inspector that does.
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain("{range('curve', 'Midtones', { disableReset: true })}");
    expect(inspector.split('disableReset').length - 1).toBe(1);
    // ...while the rendered open sections keep their double-click hints.
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).toContain('Double-click to reset exposure');
    expect(html).toContain('Double-click to reset temperature');
  });

  it('renders one keyboard-focusable dot per anchor at graph coordinates', () => {
    const graph = renderGraph(
      { ...DEFAULT_EDIT, curvePoints: [{ x: 0.25, y: 0.75 }, { x: 0.75, y: 0.25 }] },
    );
    expect(graph.split('class="curve-point"')).toHaveLength(3);
    expect(graph).toContain('cx="60" cy="40"');
    expect(graph).toContain('cx="180" cy="120"');
    expect(graph).toContain('role="slider" aria-label="Curve point 1 of 2"');
    expect(graph).toContain('aria-valuetext="input 25 percent, output 75 percent"');
    expect(graph).toContain('aria-valuetext="input 75 percent, output 25 percent"');
  });

  it('persists the Curves reset while anchors exist, without lighting other sections', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, curvePoints: [{ x: 0.5, y: 0.6 }] });
    expect(curvesSection(html)).toContain('section-reset is-dirty" data-tooltip="Reset curves"');
    for (const label of ['Reset white balance', 'Reset lightness', 'Reset hue &amp; saturation', 'Reset details', 'Reset effects']) {
      expect(html, `curve anchors must not render ${label}`).not.toContain(`aria-label="${label}"`);
    }
  });

  it('mirrors the reset patch keys in dirty exactly', () => {
    // Static markup cannot observe the onChange closure, so pin the
    // wiring at the source (the detailsReset.test.tsx precedent): the
    // reset restores Midtones plus the anchors, and dirty reads exactly
    // those — the reset can never get stuck on.
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain('onReset={() => onChange({ curve: 0, curvePoints: [] })}');
    expect(inspector).toContain('dirty={edit.curve !== 0 || edit.curvePoints.length !== 0}');
  });

  it('styles the dots as grabbable points on the line', () => {
    expect(cssRule('.curve-point')).toMatch(/fill\s*:\s*#f3d492/);
    expect(cssRule('.curve-point')).toMatch(/cursor\s*:\s*grab/);
    expect(cssRule('.curve-point:focus-visible')).toMatch(/stroke\s*:\s*#fffdf4/);
  });
});
