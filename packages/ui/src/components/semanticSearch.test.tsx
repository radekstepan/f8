import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Album, Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';
import { PhotoBrowser } from './PhotoStrips.js';
import { Sidebar } from './Sidebar.js';

// Semantic-search surfaces, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior. The album
// menus start closed in SSR output — the open dropdown is client-only.

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

function makeAlbum(overrides: Partial<Album> = {}): Album {
  return { id: 'a1', name: 'Road Trip', cover: '', ...overrides };
}

const noop = () => {};

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('semantic search', () => {
  it('renders the sidebar menu trigger for labeling alone', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum()]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} onLabelAlbum={noop} />,
    );
    expect(html).toContain('Album actions for Road Trip');
    expect(html).toContain('album-menu-trigger');
  });

  it('renders no sidebar trigger without any album action', () => {
    const html = renderToStaticMarkup(
      <Sidebar photos={[makePhoto()]} albums={[makeAlbum()]} collection="a1" search="" onSearch={noop} onSelect={noop} onImport={noop} onNewAlbum={noop} />,
    );
    expect(html).not.toContain('album-menu-trigger');
  });

  it('renders the grid album menu for labeling alone, never for built-ins', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" album={makeAlbum()} onSelect={noop} onFavorite={noop} onLabelAlbum={noop} onImport={noop} />,
    );
    expect(html).toContain('Album actions for Road Trip');
    expect(html).toContain('browser-album-menu');
    const builtIn = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="All Photos" search="" album={{ id: 'all', name: 'All Photos', cover: '' }} onSelect={noop} onFavorite={noop} onLabelAlbum={noop} onImport={noop} />,
    );
    expect(builtIn).not.toContain('browser-album-menu');
  });

  it('shows the search result note under a search heading only', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="beach" searchNote="Semantic matches for “beach” · ML" album={makeAlbum()} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(html).toContain('Results for &quot;beach&quot;');
    expect(html).toContain('browser-search-note');
    expect(html).toContain('Semantic matches for “beach” · ML');
    const noSearch = renderToStaticMarkup(
      <PhotoBrowser photos={[makePhoto()]} title="Road Trip" search="" searchNote="Semantic matches · ML" album={makeAlbum()} onSelect={noop} onFavorite={noop} onImport={noop} />,
    );
    expect(noSearch).not.toContain('browser-search-note');
  });

  it('lists labels with ML badges, remove buttons, and an add field', () => {
    const html = renderToStaticMarkup(
      <EditorDialogs dialog="info" photo={makePhoto({ labels: [{ label: 'beach', score: 0.9, source: 'ml' }, { label: 'road trip', score: 1, source: 'user' }] })} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} onAddLabel={noop} onRemoveLabel={noop} onSearchLabel={noop} />,
    );
    expect(html).toContain('data-testid="photo-labels"');
    expect(html).toContain('>beach</button>');
    expect(html).toContain('>road trip</button>');
    expect(html).toContain('ml-badge');
    expect(html).toContain('Remove label &quot;beach&quot;');
    expect(html).toContain('Remove label &quot;road trip&quot;');
    expect(html).toContain('Add a label');
    expect(html).toContain('f8-label-vocab');
  });

  it('explains empty labels and hides management without handlers', () => {
    const html = renderToStaticMarkup(
      <EditorDialogs dialog="info" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} onAddLabel={noop} onRemoveLabel={noop} onSearchLabel={noop} />,
    );
    expect(html).toContain('No labels yet');
    const bare = renderToStaticMarkup(
      <EditorDialogs dialog="info" photo={makePhoto({ labels: [{ label: 'beach', score: 0.9, source: 'ml' }] })} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} />,
    );
    expect(bare).toContain('>beach</button>');
    expect(bare).not.toContain('photo-label-remove');
    expect(bare).not.toContain('photo-label-add');
  });

  it('styles the label chips, add field, and search note', () => {
    expect(cssRule('.photo-label-list')).toMatch(/display\s*:\s*flex/);
    expect(cssRule('.photo-label')).toMatch(/border-radius\s*:\s*999px/);
    expect(cssRule('.photo-label-add')).toMatch(/display\s*:\s*flex/);
    expect(cssRule('.browser-search-note')).toMatch(/font-size\s*:\s*9px/);
  });
});
