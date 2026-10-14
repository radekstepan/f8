import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo, SuperresExportBinding } from '@f8/core';
import { EditorDialogs, ExportQualityPreview, exportFocusFromClientPoint } from './EditorDialogs.js';

// Lossy-format quality preview, rendered on the server (no jsdom): effects
// never run, so the dialog pins the loading placeholder + gating, while
// the preview component pins the full-view/zoom markup with an injected
// URL (the same prop-injection the denoise tests use). Pointer behavior
// (moving the focus, keeping it across preset switches) is structural:
// one dialog-owned focus state, reset only on photo change; the drag
// wiring is pinned at source level (handlers are invisible to static
// markup) and the coordinate mapping is a unit-tested pure helper.

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

  it('keeps the previous preview on screen while the next settings render', () => {
    // Preset switches (format, size, quality) transition, never close:
    // a stale URL plus estimating keeps the views with an updating
    // status instead of collapsing to the loading placeholder.
    const html = renderPreview({ previewUrl: 'blob:stale', estimating: true });
    expect(html).toContain('data-testid="export-quality-views"');
    expect(html).toContain('src="blob:stale"');
    expect(html).toContain('data-testid="export-quality-zoom"');
    expect(html).not.toContain('data-testid="export-quality-loading"');
    expect(html).toContain('data-testid="export-quality-updating"');
    expect(html).toContain('Updating preview…');
    const sectionTag = html.match(/<section[^>]*data-testid="export-quality-preview"[^>]*>/)?.[0] ?? '';
    expect(sectionTag).toContain('is-updating');
  });

  it('marks the preview settled once its own pixels land', () => {
    const html = renderPreview({ previewUrl: 'blob:fresh', estimating: false });
    const sectionTag = html.match(/<section[^>]*data-testid="export-quality-preview"[^>]*>/)?.[0] ?? '';
    expect(sectionTag).not.toContain('is-updating');
    expect(html).not.toContain('data-testid="export-quality-updating"');
  });

  it('never clears the preview URL while the next run is pending (source pin)', () => {
    // Effects never run in static markup, so the keep-stale behavior is
    // pinned at source level like the drag wiring below.
    const source = readFileSync(resolve(here, 'EditorDialogs.tsx'), 'utf8');
    const effect = source.slice(
      source.indexOf('// Pre-export size estimate'),
      source.indexOf('}, [photo.src, edit, format, quality, size, upscale2x, setPreviewUrl]);'),
    );
    expect(effect).not.toBe('');
    // The pending block re-estimates but issues no setPreviewUrl call, so
    // the stale URL stays until the new pixels swap it.
    const pending = effect.slice(effect.indexOf('setEstimating(true);'), effect.indexOf('const timer'));
    expect(pending).toContain('setEstimate(null)');
    expect(pending).not.toMatch(/^\s*setPreviewUrl\(/m);
    // A failed run still clears, so stale pixels never pose as new output.
    expect(effect).toContain('() => { if (live) { setEstimate(null); setPreviewUrl(null); setEstimating(false); } }');
    // Arming 2x still hides the preview, whose pixels cannot exist yet.
    expect(effect).toContain('if (upscale2x) { setEstimate(null); setEstimating(false); setPreviewUrl(null); return; }');
  });

  it('fades the stale preview while it updates instead of flashing', () => {
    expect(cssRule('.export-quality-views')).toMatch(/transition\s*:\s*opacity 160ms ease/);
    expect(cssRule('.export-quality-preview.is-updating .export-quality-views')).toMatch(/opacity\s*:\s*0\.45/);
    expect(css()).toMatch(/prefers-reduced-motion[\s\S]*?\.export-quality-views[^{]*\{[^}]*transition\s*:\s*none/);
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
    expect(html).toContain('Click or drag to move the 16× closeup');
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

  it('anchors the drag target on the image box, not the figure with its caption', () => {
    const html = renderPreview({});
    // The interactive box wraps the image (the focus rect's positioning
    // context): it carries the tooltip and a test id, while the figure —
    // whose rect folds the caption into the height — carries neither.
    const figureTag = html.match(/<figure[^>]*data-testid="export-quality-full"[^>]*>/)?.[0] ?? '';
    expect(figureTag).not.toBe('');
    expect(figureTag).not.toContain('data-tooltip');
    const wrapTag = html.match(/<div[^>]*data-testid="export-quality-full-wrap"[^>]*>/)?.[0] ?? '';
    expect(wrapTag).not.toBe('');
    expect(wrapTag).toContain('data-tooltip="Click or drag to move the 16× closeup"');
    // The image opts out of native drag so a loupe drag never tears it away.
    const imgTag = html.match(/<img[^>]*data-testid="export-quality-full-img"[^>]*>/)?.[0] ?? '';
    expect(imgTag).toContain('draggable="false"');
    expect(html).toContain('click or drag the full view to move the closeup');
  });

  it('drags with pointer capture and measures the image box (source pin)', () => {
    // Handlers never render into static markup, so the wiring is pinned at
    // source level like the quality-reset-hint test does.
    const source = readFileSync(resolve(here, 'EditorDialogs.tsx'), 'utf8');
    const preview = source.slice(source.indexOf('export function ExportQualityPreview'), source.indexOf('function ExportDialog'));
    expect(preview).toContain('onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); moveFocus(event); }}');
    expect(preview).toContain('onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; moveFocus(event); }}');
    expect(preview).toContain('onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}');
    expect(preview).toContain('onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}');
    // One shared mapping against the handler's own box; no figure onClick left.
    expect(preview).toContain('exportFocusFromClientPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())');
    expect(preview).not.toContain('onClick');
  });

  it('lets touch drags reach the loupe instead of scrolling', () => {
    expect(cssRule('.export-quality-full-wrap')).toMatch(/touch-action\s*:\s*none/);
  });
});

describe('export focus mapping', () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };

  it('maps pointer positions to focus % with rounding', () => {
    expect(exportFocusFromClientPoint(100, 50, box)).toEqual({ x: 0, y: 0 });
    expect(exportFocusFromClientPoint(200, 100, box)).toEqual({ x: 50, y: 50 });
    expect(exportFocusFromClientPoint(300, 150, box)).toEqual({ x: 100, y: 100 });
    // Quarter-pixel positions round to whole percents.
    expect(exportFocusFromClientPoint(125, 62, box)).toEqual({ x: 13, y: 12 });
  });

  it('clamps drags outside the box to the edges', () => {
    expect(exportFocusFromClientPoint(0, 0, box)).toEqual({ x: 0, y: 0 });
    expect(exportFocusFromClientPoint(999, 999, box)).toEqual({ x: 100, y: 100 });
  });

  it('lands the square where the user clicked, caption or not', () => {
    // Regression: the click used to be measured against the figure, whose
    // 20px caption inflated a 200px-tall image box to 220px — a click on
    // the image's bottom edge (clientY 250) then read 91% and the square
    // appeared above the click. Measured against the image box it reads 100%.
    const figureRect = { left: 100, top: 50, width: 200, height: 220 };
    expect(exportFocusFromClientPoint(200, 250, figureRect)).toEqual({ x: 50, y: 91 });
    const imageBox = { left: 100, top: 50, width: 200, height: 200 };
    expect(exportFocusFromClientPoint(200, 250, imageBox)).toEqual({ x: 50, y: 100 });
  });

  it('ignores pointers while the box has no size', () => {
    expect(exportFocusFromClientPoint(200, 100, { ...box, width: 0 })).toBeNull();
    expect(exportFocusFromClientPoint(200, 100, { ...box, height: 0 })).toBeNull();
  });
});
