import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, FaceEnhanceAssist, SelectiveMaskAssist } from './Inspector.js';
import type { HistogramData } from './PhotoCanvas.js';

// Histogram loading: before the canvas computes the distribution the panel
// starts flat — the svg shell (grid + zero baseline + axis) renders with no
// curve paths at all, so there is no skeleton-bar placeholder morphing into
// curves. When the data lands the curves mount inside .histogram-live and
// rise from the zero baseline. Rendered on the server (no jsdom): pins the
// markup switch, with the animation pinned from the stylesheet (the
// photoBacklink.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');

const cssRule = (selector: string): string => {
  // Anchored at line start so indented reduced-motion overrides never win
  // over the top-level rule.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';
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

function makeHistogram(): HistogramData {
  const bump = (center: number) => Array.from({ length: 64 }, (_, i) => Math.max(0, 900 - Math.abs(i - center) * 28));
  return { red: bump(20), green: bump(32), blue: bump(44) };
}

const noop = () => {};

function faceAssist(): FaceEnhanceAssist {
  return {
    state: 'idle', faces: 0, source: null, whiteBalance: null, skinAnchored: false,
    liftAmount: 0, redEyeCount: 0, progress: null, note: null, message: null,
    applied: null, onDetect: noop, onApply: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function selectiveAssist(): SelectiveMaskAssist {
  return {
    state: 'idle', found: false, coverage: 0, source: null, progress: null,
    note: null, message: null, applied: null, onDetect: noop, onAdjust: noop,
    onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function denoiseAssist(): DenoiseAssist {
  return {
    state: 'idle', preview: null, applied: null, hasBase: false, progress: null,
    note: null, message: null, onPreview: noop, onApply: noop, onClear: noop, onDismiss: noop,
  };
}

function renderAdjust(histogram: HistogramData | null): string {
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool="adjust"
      histogram={histogram}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      onChange={noop}
      onRotate={noop}
      onStraighten={noop}
      onReset={noop}
      onAuto={noop}
      onRevertEnhance={noop}
      onAutoScene={noop}
      faceAssist={faceAssist()}
      selectiveAssist={selectiveAssist()}
      denoiseAssist={denoiseAssist()}
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

/** The histogram section's markup. */
function histogramSection(html: string): string {
  return html.match(/<section class="histogram-section[^"]*"[\s\S]*?<\/section>/)?.[0] ?? '';
}

describe('histogram loading', () => {
  it('starts flat: grid shell with no curve paths while the data is missing', () => {
    const section = histogramSection(renderAdjust(null));
    expect(section).toContain('histogram-section is-loading');
    expect(section).toContain('aria-busy="true"');
    // The svg shell renders immediately (same slot as the live curves, so no
    // layout jump), labelled as loading.
    expect(section).toContain('<svg class="histogram-curves"');
    expect(section).toContain('Loading color distribution');
    expect(section).toContain('histogram-grid');
    // Flat means flat: no live group, no colored areas (fill-opacity only
    // exists on curve paths; grid + markers carry none), and no skeleton
    // bars left behind.
    expect(section).not.toContain('histogram-live');
    expect(section).not.toContain('fill-opacity');
    expect(section).not.toContain('mix-blend-mode');
    expect(section).not.toContain('histogram-skeleton');
    expect(section).not.toContain('RGB color distribution');
    // Only the 6 grid lines + 2 range markers — no curve geometry.
    expect(section.match(/<path/g)?.length ?? 0).toBe(8);
  });

  it('keeps the heading, axis, and camera settings visible while loading', () => {
    const section = histogramSection(renderAdjust(null));
    expect(section).toContain('Histogram color channel');
    expect(section).toContain('histogram-axis');
    expect(section).toContain('ISO 100');
  });

  it('mounts the curves inside the rising group once the data lands', () => {
    const section = histogramSection(renderAdjust(makeHistogram()));
    expect(section).not.toContain('is-loading');
    expect(section).not.toContain('aria-busy');
    expect(section).not.toContain('histogram-skeleton');
    expect(section).not.toContain('Loading color distribution');
    expect(section).toContain('<svg class="histogram-curves"');
    expect(section).toContain('RGB color distribution');
    expect(section).toContain('<g class="histogram-live">');
    // All three channel areas, each with the translucent screen-blended fill.
    for (const color of ['#df7a72', '#93b67b', '#779db9']) {
      expect(section).toContain(`fill="${color}"`);
    }
    expect(section.match(/fill-opacity="\.55"/g)?.length ?? 0).toBe(3);
  });

  it('adds only the live curve group when the data lands, swapping no shell markup', () => {
    const loading = histogramSection(renderAdjust(null));
    const loaded = histogramSection(renderAdjust(makeHistogram()));
    const stripLive = (markup: string) => markup.replace(/<g class="histogram-live">[\s\S]*?<\/g>/, '');
    const normalize = (markup: string) => stripLive(markup)
      .replace('histogram-section is-loading', 'histogram-section')
      .replace(' aria-busy="true"', '')
      .replace('Loading color distribution', 'CHANNEL')
      .replace('RGB color distribution', 'CHANNEL');
    expect(normalize(loaded)).toBe(normalize(loading));
  });

  it('rises the curves from the zero baseline, frozen under reduced motion', () => {
    // No skeleton or wave remnants anywhere in the stylesheet.
    expect(css()).not.toContain('histogram-skeleton');
    expect(css()).not.toContain('histogram-wave');
    // The entrance animation lives on the live curve group only: bottom
    // origin so scaleY grows upward from the zero baseline, while the grid
    // shell above it stays static (no animation on .histogram-curves).
    const live = cssRule('.histogram-live');
    expect(live).toMatch(/histogram-bloom/);
    expect(live).toMatch(/transform-box:\s*fill-box/);
    expect(live).toMatch(/transform-origin:\s*50% 100%/);
    expect(cssRule('.histogram-curves')).not.toMatch(/animation/);
    // Bloom starts fully collapsed at the baseline, not mid-height.
    expect(css()).toContain('@keyframes histogram-bloom');
    expect(css()).toMatch(/@keyframes histogram-bloom \{ from \{ opacity: 0; transform: scaleY\(0\); \}/);
    // The shell occupies the fixed curves slot in both states.
    expect(cssRule('.histogram-graph > svg')).toMatch(/height:\s*68px/);
    expect(css()).toMatch(/prefers-reduced-motion[^{]*\{[\s\S]*?\.histogram-live[\s\S]*?animation:\s*none/);
  });
});
