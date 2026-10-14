import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';

// Download settings button removal, rendered on the server (no jsdom):
// effects never run, so this pins the static footer markup + the CSS that
// served the button, not click behavior.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

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

function renderExport(): string {
  return renderToStaticMarkup(
    <EditorDialogs
      dialog="export"
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      onClose={noop}
      onToast={noop}
      onCreateAlbum={noop}
      onSavePreset={noop}
      onRemovePhoto={noop}
    />,
  );
}

describe('download settings button removal', () => {
  it('renders no Settings button in the export dialog', () => {
    const html = renderExport();
    expect(html).not.toContain('export-settings');
    expect(html).not.toContain('>Settings</button>');
  });

  it('keeps the remaining footer actions intact', () => {
    const html = renderExport();
    expect(html).toContain('>Cancel</button>');
    expect(html).toContain('Export Photo');
  });

  it('leaves no export-settings rule in the stylesheet', () => {
    expect(css()).not.toMatch(/\.export-settings\b/);
  });
});
