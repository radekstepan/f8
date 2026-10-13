import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo, SuperresExportBinding } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';

// Export size estimate, rendered on the server (no jsdom): effects never
// run, so this pins the initial markup + setting wiring, not the async
// estimate run (estimateExportBytes is covered by its core contract: same
// render + encode as the export, so the number is byte-exact by
// construction, modulo repair pixels).

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

describe('export size estimate', () => {
  it('shows an estimating placeholder before the async estimate lands', () => {
    // Effects never run in static markup, so the estimate stays pending.
    const html = renderExport();
    expect(html).toContain('data-testid="export-size-estimate"');
    expect(html).toContain('Estimating file size…');
  });

  it('sits with the export settings, before the super-resolution option', () => {
    const html = renderExport();
    expect(html.indexOf('data-testid="export-size-estimate"')).toBeGreaterThan(html.indexOf('Image Size'));
    expect(html.indexOf('data-testid="export-size-estimate"')).toBeLessThan(html.indexOf('data-testid="export-superres"'));
  });

  it('yields to an unavailable note when 2x is armed, never a misleading number', () => {
    const html = renderExport(true);
    expect(html).toContain('data-testid="export-size-estimate"');
    expect(html).toContain('File size estimate unavailable for 2x upscales.');
    expect(html).not.toContain('Estimating file size…');
    expect(html).not.toContain('Estimated file size ≈');
  });
});
