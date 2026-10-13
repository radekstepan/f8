import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo, SuperresExportBinding } from '@f8/core';
import { EditorDialogs, ExportQualityPreview } from './EditorDialogs.js';

// Lossy-format quality preview, rendered on the server (no jsdom): effects
// never run, so the dialog pins the loading placeholder + gating, while
// the preview component pins the full-view/zoom markup with an injected
// URL (the same prop-injection the denoise tests use). Click behavior
// (moving the focus, keeping it across preset switches) is structural:
// one dialog-owned focus state, reset only on photo change.

const here = dirname(fileURLToPath(import.meta.url));
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

const binding: SuperresExportBinding = {
  run: async (image) => ({ width: image.width * 2, height: image.height * 2, data: new Uint8ClampedArray(image.width * 2 * image.height * 2 * 4), source: 'onnx' }),
  health: async () => ({ ready: true, source: 'onnx', downloading: false, downloadPct: 1, weightsReady: true, error: null }),
};

function renderExport(initialSuperres?: boolean): string {
  return renderToStaticMarkup(
    <EditorDialogs
      dialog="export"
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      superres={binding}
      initialSuperres={initialSuperres}
      onClose={noop}
      onToast={noop}
      onCreateAlbum={noop}
      onSavePreset={noop}
      onRemovePhoto={noop}
    />,
  );
}

function renderPreview(props: { format?: string; quality?: number; previewUrl?: string | null; estimating?: boolean; focus?: { x: number; y: number } }): string {
  return renderToStaticMarkup(
    <ExportQualityPreview
      format={props.format ?? 'jpeg'}
      quality={props.quality ?? 90}
      previewUrl={props.previewUrl === undefined ? 'blob:preview' : props.previewUrl}
      estimating={props.estimating ?? false}
      focus={props.focus ?? { x: 50, y: 50 }}
      onFocus={noop}
    />,
  );
}

describe('export quality preview', () => {
  it('shows a rendering placeholder in the dialog before the async preview lands', () => {
    // Effects never run in static markup, so the preview URL never
    // exists: the lossy default (JPEG) renders the loading state.
    const html = renderExport();
    expect(html).toContain('data-testid="export-quality-preview"');
    expect(html).toContain('data-testid="export-quality-title"');
    expect(html).toContain('Quality preview');
    expect(html).toContain('data-testid="export-quality-loading"');
    expect(html).toContain('Rendering quality preview…');
  });

  it('sits with the export settings, after the estimate line and before the super-resolution option', () => {
    const html = renderExport();
    expect(html.indexOf('data-testid="export-quality-preview"')).toBeGreaterThan(html.indexOf('data-testid="export-size-estimate"'));
    expect(html.indexOf('data-testid="export-quality-preview"')).toBeLessThan(html.indexOf('data-testid="export-superres"'));
  });

  it('hides entirely when 2x is armed, whose pixels do not exist yet', () => {
    const html = renderExport(true);
    expect(html).not.toContain('data-testid="export-quality-preview"');
    expect(html).not.toContain('Rendering quality preview…');
  });

  it('renders nothing for lossless PNG, where there are no artifacts to judge', () => {
    expect(renderPreview({ format: 'png' })).toBe('');
  });

  it('renders nothing when the run failed, like the size line', () => {
    expect(renderPreview({ previewUrl: null, estimating: false })).toBe('');
  });

  it('shows the loading placeholder while the run is pending', () => {
    const html = renderPreview({ previewUrl: null, estimating: true });
    expect(html).toContain('data-testid="export-quality-preview"');
    expect(html).toContain('Rendering quality preview…');
    expect(html).not.toContain('data-testid="export-quality-views"');
  });

  it('shows the full export with a focus box next to a 16x zoom of the focused area', () => {
    const html = renderPreview({});
    expect(html).toContain('data-testid="export-quality-views"');
    // Full view first, zoom second: side by side in DOM order.
    expect(html).toContain('data-testid="export-quality-full"');
    expect(html).toContain('data-testid="export-quality-zoom"');
    expect(html.indexOf('data-testid="export-quality-full"')).toBeLessThan(html.indexOf('data-testid="export-quality-zoom"'));
    expect(html).toContain('Full export');
    expect(html).toContain('16×');
    expect(html).toContain('Export closeup at 16x magnification');
    // Both views show the encoded output, not the source photo.
    expect(html).toContain('src="blob:preview"');
    expect(html).toContain('blob:preview');
    // Default focus sits centered until the user clicks the full view.
    const rectTag = html.match(/<div[^>]*data-testid="export-quality-focus"[^>]*>/)?.[0] ?? '';
    expect(rectTag).toContain('aria-hidden="true"');
    expect(rectTag).toContain('left:50%');
    expect(rectTag).toContain('top:50%');
    expect(html).toContain('background-position:50% 50%');
    expect(html).toContain('Click to move the 16× closeup');
    // The note names the actual output: format + quality.
    expect(html).toContain('data-testid="export-quality-note"');
    expect(html).toContain('Actual JPEG output at 90%');
  });

  it('follows an off-center focus in both the box and the zoom', () => {
    // The preview is controlled: whatever focus the dialog holds renders
    // here, so preset switches (which never touch the dialog state) keep it.
    const html = renderPreview({ focus: { x: 20, y: 80 } });
    const rectTag = html.match(/<div[^>]*data-testid="export-quality-focus"[^>]*>/)?.[0] ?? '';
    expect(rectTag).toContain('left:20%');
    expect(rectTag).toContain('top:80%');
    expect(html).toContain('background-position:20% 80%');
  });

  it('clamps an edge focus so the box stays inside the full view', () => {
    const html = renderPreview({ focus: { x: 0, y: 100 } });
    const rectTag = html.match(/<div[^>]*data-testid="export-quality-focus"[^>]*>/)?.[0] ?? '';
    // Half a 6.25% box inside each edge, the denoise geometry.
    expect(rectTag).toContain('left:3.125%');
    expect(rectTag).toContain('top:96.875%');
    // The zoom itself still samples the exact clicked point.
    expect(html).toContain('background-position:0% 100%');
  });

  it('shows for WebP too, the other lossy format', () => {
    const html = renderPreview({ format: 'webp', quality: 80 });
    expect(html).toContain('data-testid="export-quality-views"');
    expect(html).toContain('Actual WEBP output at 80%');
  });

  it('magnifies the zoom box 16x without tiling and keeps pixels exact', () => {
    const rule = cssRule('.export-quality-zoom');
    expect(rule).toMatch(/background-size\s*:\s*1600%/);
    expect(rule).toMatch(/background-repeat\s*:\s*no-repeat/);
    expect(rule).toMatch(/aspect-ratio\s*:\s*1\s*\/\s*1/);
    // Pixelated, not smoothed: compression blocks must read as blocks.
    expect(rule).toMatch(/image-rendering\s*:\s*pixelated/);
  });

  it('overlays a 1/16 focus square on the full view without stealing clicks', () => {
    const wrap = cssRule('.export-quality-full-wrap');
    expect(wrap).toMatch(/position\s*:\s*relative/);
    const rect = cssRule('.export-quality-focus');
    expect(rect).toMatch(/position\s*:\s*absolute/);
    expect(rect).toMatch(/width\s*:\s*6\.25%/);
    expect(rect).toMatch(/aspect-ratio\s*:\s*1\s*\/\s*1/);
    expect(rect).toMatch(/transform\s*:\s*translate\(-50%,\s*-50%\)/);
    expect(rect).toMatch(/border\s*:/);
    expect(rect).toMatch(/box-shadow\s*:/);
    expect(rect).toMatch(/pointer-events\s*:\s*none/);
  });

  it('lays the full view and the zoom side by side with a crosshair on the full view', () => {
    const views = cssRule('.export-quality-views');
    expect(views).toMatch(/display\s*:\s*flex/);
    expect(views).toMatch(/flex-direction\s*:\s*row/);
    expect(cssRule('.export-quality-views > figure')).toMatch(/flex\s*:\s*1/);
    expect(cssRule('.export-quality-full')).toMatch(/cursor\s*:\s*crosshair/);
    const title = cssRule('.export-quality-title');
    expect(title).toMatch(/text-transform\s*:\s*uppercase/);
  });
});
