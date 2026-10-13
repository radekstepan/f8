import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';

// Photo Information modal cleanup, rendered on the server (no jsdom): pins
// the markup + prop wiring, not click behavior. The modal opens from the
// photo already on screen, so its own preview was redundant; the label "Add"
// button used the full-size 33px secondary treatment next to a 28px input;
// and the location/path rule sat flush against the section above it.

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

function renderInfo(photo: Photo): string {
  return renderToStaticMarkup(
    <EditorDialogs dialog="info" photo={photo} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} onAddLabel={noop} onRemoveLabel={noop} onSearchLabel={noop} />,
  );
}

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('photo information modal', () => {
  it('renders no photo preview', () => {
    const html = renderInfo(makePhoto());
    expect(html).not.toContain('<img');
    expect(html).not.toContain('info-photo');
    expect(html).not.toContain('http://localhost/photo.jpg');
  });

  it('keeps every information section intact', () => {
    const html = renderInfo(makePhoto({
      labels: [{ label: 'beach', score: 0.9, source: 'ml' }],
      path: '/Photos/2024/DSC06308.ARW',
      missing: true,
      photographer: 'Jane Doe',
    }));
    expect(html).toContain('Photo Information');
    expect(html).toContain('info-filename');
    expect(html).toContain('DSC06308.ARW');
    expect(html).toContain('Camera');
    expect(html).toContain('Test camera');
    expect(html).toContain('Test lens');
    expect(html).toContain('f/8');
    expect(html).toContain('3,000 x 2,000');
    expect(html).toContain('data-testid="photo-labels"');
    expect(html).toContain('>beach</button>');
    expect(html).toContain('Dolomites');
    expect(html).toContain('/Photos/2024/DSC06308.ARW');
    expect(html).toContain('original file is missing');
    expect(html).toContain('Photo by Jane Doe');
  });

  it('keeps the label add form wired to a secondary submit', () => {
    const html = renderInfo(makePhoto());
    expect(html).toContain('photo-label-add');
    expect(html).toContain('placeholder="Add a label"');
    expect(html).toContain('f8-label-vocab');
    expect(html).toContain('type="submit"');
    expect(html).toContain('>Add</button>');
    expect(html).toContain('secondary-button');
  });

  it('sizes the Add button to its input', () => {
    expect(cssRule('.photo-label-add > input')).toMatch(/height\s*:\s*28px/);
    expect(cssRule('.photo-label-add > .secondary-button')).toMatch(/height\s*:\s*28px/);
    expect(cssRule('.photo-label-add > .secondary-button')).toMatch(/font-size\s*:\s*9px/);
  });

  it('gives the bottom rule whitespace on both sides', () => {
    expect(cssRule('.photo-info-location')).toMatch(/border-top\s*:/);
    expect(cssRule('.photo-info-location')).toMatch(/margin-top\s*:\s*17px/);
    expect(cssRule('.photo-info-location')).toMatch(/padding-top\s*:\s*17px/);
  });
});
