import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Stretched-then-snap photo loading, pinned from the PhotoCanvas source + CSS
// (the arrowNavigationPerf.test.tsx precedent): the wiring lives in effects,
// so there is no renderable output to assert on. The fast-arrowing change
// started showing the cached last render for every photo and clearing
// `loading` the moment it appeared — but clearing loading also unhides the
// stale canvas (the previous photo's pixels, CSS-stretched into the new
// frame, visible until the <img> blob decodes) and flips the frame from the
// predicted aspect to the previous photo's measured aspect. The result: some
// photos flashed stretched across the canvas and "snapped" correct when the
// real paint landed ~a second later.

const here = dirname(fileURLToPath(import.meta.url));
const canvasSource = () => readFileSync(resolve(here, './PhotoCanvas.tsx'), 'utf8');

const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const fullCss = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fullCss().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

/** The instant-preview branch, from cache read to its fallback catch. */
const previewBranch = (): string => {
  const source = canvasSource();
  const start = source.indexOf('const cached = await loadPreviewRender(photo.id, runKey);');
  const end = source.indexOf('} catch { /* The pipeline paint below is the fallback. */ }', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('no stretched flash while the photo loads', () => {
  it('keeps loading true on a preview-cache hit until the real paint lands', () => {
    const branch = previewBranch();
    // The preview still shows instantly and still logs its paint source.
    expect(branch).toContain('setPreviewUrlTracked(URL.createObjectURL(cached));');
    expect(branch).toContain("paintLog.current.push({ source: 'preview-cache'");
    // But it must not clear loading: that would unhide the stale canvas and
    // flip the frame to the previous photo's aspect before the new paint.
    expect(branch).not.toContain('setLoading(false)');
  });

  it('clears loading only on paint or decode failure, never on preview', () => {
    const clears = canvasSource().match(/setLoading\(false\)/g) ?? [];
    // Exactly two: the decode-error path and finishPaint.
    expect(clears).toHaveLength(2);
  });

  it('hides the spinner pill behind the instant preview instead of clearing loading', () => {
    // Loading stays true (frame predicted, stale canvas hidden), so the pill
    // itself gates on the preview — instant pixels stay clean, and the pill
    // still shows whenever there is no preview to show.
    expect(canvasSource()).toContain('{loading && !previewUrl && <div className="photo-loading">');
  });

  it('covers (never stretches) the cached preview into the frame', () => {
    const preview = cssRule('.cached-preview');
    expect(preview).toMatch(/width\s*:\s*100%/);
    expect(preview).toMatch(/height\s*:\s*100%/);
    // Same as .thumb-hold: any residual frame/bitmap aspect mismatch (e.g.
    // straighten, which the frame predictor ignores) crops a sliver instead
    // of distorting the photo.
    expect(preview).toMatch(/object-fit\s*:\s*cover/);
  });
});
