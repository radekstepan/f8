import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo, SuperresExportBinding } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';

// Export-time super-resolution option, rendered on the server (no jsdom):
// effects never run, so this pins the markup + prop wiring, not the async
// upscale run (health notes, progress, and toasts are covered by the
// interaction contract: binding.run/health are the only async seams).

function makePhoto(width = 3000, height = 2000): Photo {
  return {
    id: 'p1',
    name: 'DSC06308.ARW',
    title: 'Alpine morning',
    src: 'http://localhost/photo.jpg',
    thumbnail: 'http://localhost/thumb.jpg',
    albumId: 'a1',
    location: 'Dolomites',
    date: '2024-01-01',
    width,
    height,
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

function renderExport(photo: Photo, superres?: SuperresExportBinding | null, initialSuperres?: boolean): string {
  return renderToStaticMarkup(
    <EditorDialogs
      dialog="export"
      photo={photo}
      edit={{ ...DEFAULT_EDIT }}
      superres={superres}
      initialSuperres={initialSuperres}
      onClose={noop}
      onToast={noop}
      onCreateAlbum={noop}
      onSavePreset={noop}
      onRemovePhoto={noop}
    />,
  );
}

describe('export super-resolution option', () => {
  it('is absent without a superres binding', () => {
    expect(renderExport(makePhoto())).not.toContain('data-testid="export-superres"');
    expect(renderExport(makePhoto(), null)).not.toContain('data-testid="export-superres"');
  });

  it('offers an unchecked 2x checkbox with an ML badge when bound', () => {
    const html = renderExport(makePhoto(), binding);
    expect(html).toContain('data-testid="export-superres"');
    expect(html).toContain('Super-resolution 2x');
    expect(html).toContain('Doubled by a machine-learning model on the photo server');
    expect(html).toContain('>ML<');
    expect(html).not.toContain('checked');
    expect(html).not.toContain('data-testid="export-superres-hint"');
  });

  it('pre-checks from the context menu and previews doubled dimensions', () => {
    // Default Medium size: min(3000px source, 1200px) → about 2400px out.
    const html = renderExport(makePhoto(), binding, true);
    expect(html).toContain('checked');
    expect(html).toContain('data-testid="export-superres-hint"');
    expect(html).toContain('about 2400px on the long edge');
  });

  it('scales the preview to small sources', () => {
    const html = renderExport(makePhoto(800, 600), binding, true);
    expect(html).toContain('about 1600px on the long edge');
  });

  it('shows the health check while the engine note loads', () => {
    // Effects never run in static markup, so health stays null.
    const html = renderExport(makePhoto(), binding, true);
    expect(html).toContain('Checking the ML upscale…');
  });

  it('keeps the plain export path untouched', () => {
    const html = renderExport(makePhoto(), binding);
    expect(html).toContain('Export Photo');
    expect(html).toContain('Image Size');
    expect(html).not.toContain('Cancel upscale');
  });
});
