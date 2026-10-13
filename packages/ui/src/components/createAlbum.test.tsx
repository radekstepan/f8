import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';

// New-album dialog, rendered on the server (no jsdom): effects never run,
// so this pins the markup + prop wiring, not click behavior.

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

function renderAlbum(onCreateAlbum: (name: string) => void = noop) {
  return renderToStaticMarkup(
    <EditorDialogs dialog="album" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={onCreateAlbum} onSavePreset={noop} onRemovePhoto={noop} />,
  );
}

describe('new album dialog', () => {
  it('renders the name field with create and cancel actions', () => {
    const html = renderAlbum();
    expect(html).toContain('New Album');
    expect(html).toContain('Album Name');
    expect(html).toContain('placeholder="e.g. A summer in Italy"');
    expect(html).toContain('>Create Album</button>');
    expect(html).toContain('>Cancel</button>');
  });

  it('offers no move-the-current-photo checkbox', () => {
    const html = renderAlbum();
    expect(html).not.toContain('Move the current photo into this album');
    expect(html).not.toContain('type="checkbox"');
  });

  it('wires onCreateAlbum as a single (name) callback', () => {
    const onCreateAlbum = vi.fn();
    // Type-level: the prop takes only the album name — no includePhoto flag.
    const acceptsNameOnly: (name: string) => void = onCreateAlbum;
    renderAlbum(acceptsNameOnly);
    expect(onCreateAlbum).not.toHaveBeenCalled();
  });
});
