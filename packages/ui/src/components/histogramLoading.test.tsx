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
// used to render flat zero-lines that popped into shape. Now a null
// histogram renders an animated skeleton wave, and the real curves bloom in
// when the data lands. Rendered on the server (no jsdom): pins the markup
// switch, with the animation pinned from the stylesheet (the
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

/** The histogram section's markup. */
function histogramSection(html: string): string {
  return html.match(/<section class="histogram-section[^"]*"[\s\S]*?<\/section>/)?.[0] ?? '';
}

describe('histogram loading', () => {
  it('renders an animated skeleton wave while the data is missing', () => {
    const section = histogramSection(renderAdjust(null));
    expect(section).toContain('histogram-section is-loading');
    expect(section).toContain('histogram-skeleton');
    expect(section).toMatch(/role="status"/);
    expect(section).toContain('Loading histogram');
    // A full bar field with staggered delays (the travelling wave), not a
    // single pulsing block.
    const bars = section.match(/<span style="height:[^"]*animation-delay:[^"]*"><\/span>/g) ?? [];
    expect(bars.length).toBe(28);
    expect(new Set(bars).size).toBeGreaterThan(8);
    // No flat zero-lines and no curves behind the skeleton.
    expect(section).not.toContain('<svg');
    expect(section).not.toContain('histogram-curves');
    expect(section).not.toContain('color distribution');
  });

  it('keeps the heading, axis, and camera settings visible while loading', () => {
    const section = histogramSection(renderAdjust(null));
    expect(section).toContain('Histogram color channel');
    expect(section).toContain('histogram-axis');
    expect(section).toContain('ISO 100');
  });

  it('swaps the skeleton for blooming curves once the data lands', () => {
    const section = histogramSection(renderAdjust(makeHistogram()));
    expect(section).not.toContain('is-loading');
    expect(section).not.toContain('histogram-skeleton');
    expect(section).not.toContain('Loading histogram');
    expect(section).toContain('histogram-curves');
    expect(section).toContain('RGB color distribution');
  });

  it('animates the wave bars and the curve entrance, frozen under reduced motion', () => {
    const skeleton = cssRule('.histogram-skeleton');
    expect(skeleton).toMatch(/display:\s*flex/);
    expect(skeleton).toMatch(/align-items:\s*flex-end/);
    // The skeleton occupies the curves' exact slot (no layout jump on swap).
    expect(skeleton).toMatch(/height:\s*68px/);
    const bars = cssRule('.histogram-skeleton > span');
    expect(bars).toMatch(/histogram-wave/);
    expect(bars).toMatch(/transform-origin/);
    expect(css()).toContain('@keyframes histogram-wave');
    expect(css()).toMatch(/@keyframes histogram-wave \{[^@]*opacity[^@]*scaleY/);
    const curves = cssRule('.histogram-curves');
    expect(curves).toMatch(/histogram-bloom/);
    expect(curves).toMatch(/transform-origin/);
    expect(css()).toContain('@keyframes histogram-bloom');
    expect(css()).toMatch(/prefers-reduced-motion[^{]*\{[\s\S]*?\.histogram-skeleton > span[\s\S]*?animation:\s*none/);
    expect(css()).toMatch(/prefers-reduced-motion[^{]*\{[\s\S]*?\.histogram-curves[\s\S]*?animation:\s*none/);
  });
});
