import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';

// ML-vs-Auto badge audit outside the inspector: Scene Enhance is a
// heuristic auto (hand-set classifier weights, no trained model runs),
// so its menu entry and shortcut label carry no ML badge — while the
// genuinely model-driven entries keep theirs. Rendered on the server
// (no jsdom); the topbar dropdown only renders while open, so its
// content is pinned from the Topbar.tsx source (same seam as
// topbarMenus.test.tsx).

const here = dirname(fileURLToPath(import.meta.url));
const topbarSource = () => readFileSync(resolve(here, 'Topbar.tsx'), 'utf8');

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

function renderShortcuts(): string {
  return renderToStaticMarkup(
    <EditorDialogs
      dialog="shortcuts"
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

describe('ml/auto badge audit', () => {
  it('marks only the model-driven entry with an ML badge in the Image menu', () => {
    const imageLine = topbarSource().split('\n').find((line) => line.trimStart().startsWith('Image:')) ?? '';
    expect(imageLine).toContain('Scene Enhance');
    const sceneEntry = imageLine.slice(imageLine.indexOf('enhance-scene'), imageLine.indexOf('enhance-faces'));
    const facesEntry = imageLine.slice(imageLine.indexOf('enhance-faces'));
    // Scene enhance is a heuristic auto: no badge. Face detection runs a
    // YuNet model on the photo server: badge kept.
    expect(sceneEntry).not.toContain('MlBadge');
    expect(facesEntry).toContain('MlBadge');
  });

  it('labels the scene shortcut Auto and keeps the faces shortcut ML', () => {
    const html = renderShortcuts();
    expect(html).toContain('Scene Enhance (Auto)');
    expect(html).not.toContain('Scene Enhance (ML)');
    expect(html).toContain('Enhance Faces (ML)');
  });
});
