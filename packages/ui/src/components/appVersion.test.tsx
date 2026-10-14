import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';
import { MenuBar } from './Topbar.js';

// App version display, rendered on the server (no jsdom): the menu bar's
// right-hand indicator and the About dialog show `v<APP_VERSION>` where
// the retired "Local-first edition" label used to be. The version value
// itself is pinned to the workspace package.json files by
// packages/core/src/branding.test.ts; here we pin the render wiring.

const here = dirname(fileURLToPath(import.meta.url));
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');

const noop = () => {};

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

function renderMenuBar(): string {
  return renderToStaticMarkup(
    <MenuBar
      onAction={noop}
      canUndo
      canRedo={false}
      canPaste
      sidebar
      inspector
      presets={false}
      filmstrip
    />,
  );
}

function renderAbout(): string {
  return renderToStaticMarkup(
    <EditorDialogs dialog="about" photo={makePhoto()} edit={{ ...DEFAULT_EDIT }} onClose={noop} onToast={noop} onCreateAlbum={noop} onSavePreset={noop} onRemovePhoto={noop} />,
  );
}

describe('app version display', () => {
  it('shows the app version in the menu-bar indicator', () => {
    const html = renderMenuBar();
    expect(html).toContain(`v${APP_VERSION}`);
    expect(html).toMatch(/<div class="version-indicator"><span><\/span>v/);
  });

  it('shows the app version in the About dialog', () => {
    const html = renderAbout();
    expect(html).toContain('About f/8');
    expect(html).toContain(`<span>v${APP_VERSION}</span>`);
  });

  it('keeps the retired edition label out of both spots', () => {
    expect(renderMenuBar()).not.toMatch(/edition/i);
    expect(renderAbout()).not.toMatch(/edition/i);
  });

  it('styles the indicator like before under its new class', () => {
    const stylesheet = css();
    expect(stylesheet).toMatch(/\.version-indicator\s*\{[^}]*margin-left:\s*auto/);
    expect(stylesheet).toMatch(/\.version-indicator > span:first-child\s*\{[^}]*border-radius:\s*50%/);
    expect(stylesheet).not.toContain('demo-indicator');
    expect(stylesheet).not.toContain('demo-version');
  });
});
