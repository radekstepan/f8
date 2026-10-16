import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { PhotoBrowser } from './PhotoStrips.js';
import { AlbumExportDialog, EditorDialogs } from './EditorDialogs.js';

// Album-view export, rendered on the server (no jsdom): effects never run,
// so this pins the markup + prop wiring, not click behavior or the async
// render/zip run (the zip writer is covered by its core round-trip tests).
// The App.tsx half is pinned at the source level per the
// presetPreviewRefresh.test.tsx precedent.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

const appSource = () => readFileSync(resolve(root, 'apps/web/src/App.tsx'), 'utf8');

function makePhoto(overrides: Partial<Photo> = {}): Photo {
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
    ...overrides,
  };
}

const noop = () => {};

describe('album-view export button', () => {
  it('renders an export button in the heading actions', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} onExportAlbum={noop} />,
    );
    expect(html).toMatch(/browser-heading-actions">[\s\S]*?aria-label="Export album view"/);
  });

  it('hides the button when the handler is omitted', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).not.toContain('Export album view');
  });

  it('disables the button when the view is empty', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[]} title="Road Trip" search="" onSelect={noop} onFavorite={noop} onImport={noop} onExportAlbum={noop} />,
    );
    expect(html).toMatch(/aria-label="Export album view"[^>]*disabled|disabled[^>]*aria-label="Export album view"/);
  });
});

describe('album export dialog', () => {
  it('confirms format and quality for the whole view', () => {
    const html = renderToStaticMarkup(
      <AlbumExportDialog collectionTitle="Road Trip" count={12} onClose={noop} onConfirm={noop} />,
    );
    expect(html).toContain('Export Album View');
    expect(html).toContain('12 photos');
    expect(html).toContain('Road Trip');
    expect(html).toContain('JPEG - Best for sharing');
    expect(html).toContain('PNG - Lossless quality');
    expect(html).toContain('WebP - Smaller file size');
    // JPEG is lossy, so the quality slider applies.
    expect(html).toContain('>Quality</label>');
    expect(html).toContain('type="range"');
    expect(html).toContain('Export 12 photos');
  });

  it('hides the quality slider for lossless PNG', () => {
    const html = renderToStaticMarkup(
      <AlbumExportDialog collectionTitle="Road Trip" count={12} initialFormat="png" onClose={noop} onConfirm={noop} />,
    );
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('>Quality</label>');
  });

  it('offers no super-resolution and no preview', () => {
    for (const initialFormat of [undefined, 'png']) {
      const html = renderToStaticMarkup(
        <AlbumExportDialog collectionTitle="Road Trip" count={12} initialFormat={initialFormat} onClose={noop} onConfirm={noop} />,
      );
      expect(html).not.toContain('Super-resolution');
      expect(html).not.toContain('2x');
      expect(html).not.toContain('Quality preview');
      expect(html).not.toContain('export-quality-preview');
      expect(html).not.toContain('Image Size');
    }
  });

  it('disables the confirm button when the view is empty', () => {
    const html = renderToStaticMarkup(
      <AlbumExportDialog collectionTitle="Road Trip" count={0} onClose={noop} onConfirm={noop} />,
    );
    expect(html).toContain('Export 0 photos');
    expect(html).toMatch(/<button[^>]*class="primary-button"[^>]*disabled/);
  });
});

describe('export-album dialog dispatch', () => {
  const renderDialogs = (exportAlbum?: { title: string; count: number; onConfirm: (format: string, quality: number) => void }) =>
    renderToStaticMarkup(
      <EditorDialogs
        dialog="export-album"
        photo={makePhoto()}
        edit={{ ...DEFAULT_EDIT }}
        onClose={noop}
        onToast={noop}
        onCreateAlbum={noop}
        onSavePreset={noop}
        onRemovePhoto={noop}
        exportAlbum={exportAlbum}
      />,
    );

  it('renders the batch dialog when the export target is set', () => {
    const html = renderDialogs({ title: 'Road Trip', count: 3, onConfirm: noop });
    expect(html).toContain('Export Album View');
    expect(html).toContain('Export 3 photos');
  });

  it('renders nothing without an export target', () => {
    expect(renderDialogs()).toBe('');
  });
});

describe('album export: App wiring', () => {
  it('opens the dialog from the album-page heading button', () => {
    const source = appSource();
    expect(source).toContain("onExportAlbum={() => setDialog('export-album')}");
  });

  it('feeds the dialog the current view, not a re-derived set', () => {
    // The grid's own pipeline (album + filters + search + sort, smart
    // albums included) is the export set — the dialog counts it directly.
    const source = appSource();
    expect(source).toContain('exportAlbum={{ title: collectionName, count: filteredPhotos.length');
    expect(source).toContain('void exportAlbumView(format, quality)');
  });

  it('exports the snapshotted view photo by photo through the shared pipeline, then zips', () => {
    const source = appSource();
    const fn = source.slice(source.indexOf('const exportAlbumView'), source.indexOf('const handleAction'));
    expect(fn).toContain('const batch = filteredPhotos;');
    expect(fn).toContain('liveEdits[item.id] ?? item.edit');
    expect(fn).toContain('exportPhoto(item.src, edit, format, quality, ALBUM_EXPORT_MAX_SIZE');
    expect(fn).toContain('albumExportFilename(item.name, format, used)');
    expect(fn).toContain('zipStoreFiles(members)');
    expect(fn).toContain("downloadBlob(new Blob([zipStoreFiles(members)], { type: 'application/zip' }), albumExportZipName(title))");
    expect(fn).toContain('formatAlbumExportSummary(members.length, failed)');
    expect(fn).not.toContain('superres');
    expect(fn).not.toContain('2x');
  });

  it('reports progress through the shared progress toast', () => {
    const source = appSource();
    expect(source).toContain('{exportProgress && <ProgressToast status={exportProgress} format={formatAlbumExportProgress} />}');
    const fn = source.slice(source.indexOf('const exportAlbumView'), source.indexOf('const handleAction'));
    expect(fn).toContain('setExportProgress({ done: 0, total: batch.length })');
    expect(fn).toContain('setExportProgress({ done: index + 1, total: batch.length })');
  });
});
