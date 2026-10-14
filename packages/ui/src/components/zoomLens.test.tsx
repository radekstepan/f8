import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { MenuBar } from './Topbar.js';
import { PhotoCanvas } from './PhotoCanvas.js';

// Zoom in View: a View-menu toggle (shortcut Z) that shows a fixed 8x
// square preview in the photo's bottom-right corner in photo (editor)
// view only. The pane paints from the edited canvas in an effect
// (unreachable from server rendering, like the minimap mirror), so the
// paint math is unit-tested in packages/core/src/zoomLens.test.ts and
// this file pins the wiring: the menu item with its checked state and
// shortcut, the App state/action/shortcut/props plumbing, the pane
// markup gate, and the stylesheet.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const appPath = resolve(here, '../../../../apps/web/src/App.tsx');
const fullCss = () => readFileSync(cssPath, 'utf8');
const appSource = () => readFileSync(appPath, 'utf8');
const topbarSource = () => readFileSync(resolve(here, 'Topbar.tsx'), 'utf8');
const canvasSource = () => readFileSync(resolve(here, 'PhotoCanvas.tsx'), 'utf8');
const dialogsSource = () => readFileSync(resolve(here, 'EditorDialogs.tsx'), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fullCss().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

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

function renderCanvas(zoomLens?: boolean): string {
  return renderToStaticMarkup(
    <PhotoCanvas
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool="adjust"
      zoom={1}
      compare={false}
      showOriginal={false}
      brushSize={45}
      brushStrength={100}
      zoomLens={zoomLens}
      onZoom={noop}
      onCompare={noop}
      onFavorite={noop}
      onRating={noop}
      onInfo={noop}
      onChange={noop}
      onHistogram={noop}
    />,
  );
}

function viewMenuLine(): string {
  return topbarSource().split('\n').find((line) => line.trimStart().startsWith('View:')) ?? '';
}

function photoCanvasBlock(): string {
  const source = appSource();
  const start = source.indexOf('<PhotoCanvas');
  const end = source.indexOf('/>', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function menuBarBlock(): string {
  const source = appSource();
  const start = source.indexOf('<MenuBar');
  const end = source.indexOf('/>', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('zoom-in-view menu toggle', () => {
  it('lives under the View menu next to Zoom to Fit, with a checked state and the Z shortcut', () => {
    const line = viewMenuLine();
    expect(line).toContain("'Zoom in View', 'zoom-lens', 'Z'");
    expect(line).toContain('zoomLens');
    expect(line.indexOf("'fit'")).toBeLessThan(line.indexOf("'zoom-lens'"));
  });

  it('adds no top-level menu', () => {
    const html = renderToStaticMarkup(
      <MenuBar onAction={noop} canUndo canRedo={false} canPaste sidebar inspector presets={false} filmstrip zoomLens />,
    );
    const labels = Array.from(html.matchAll(/class="menu-trigger[^"]*"[^>]*>([^<]+)</g)).map((match) => match[1] ?? '');
    expect(labels).toEqual(['File', 'Edit', 'Image', 'View', 'Window', 'Help']);
  });

  it('is listed in the keyboard shortcuts dialog', () => {
    expect(dialogsSource()).toContain("['Zoom in view', 'Z']");
  });
});

describe('zoom-in-view app wiring', () => {
  it('toggles the mode from the menu action', () => {
    expect(appSource()).toContain("case 'zoom-lens': setZoomLens((current) => !current); break;");
  });

  it('toggles the mode from the Z shortcut', () => {
    expect(appSource()).toContain("z: 'zoom-lens'");
  });

  it('shows the checked state in the menu bar', () => {
    expect(menuBarBlock()).toContain('zoomLens={zoomLens}');
  });

  it('gates the preview on photo view', () => {
    expect(photoCanvasBlock()).toContain('zoomLens={shouldShowZoomLens(view, zoomLens)}');
  });
});

describe('zoom-in-view preview pane', () => {
  it('renders no preview by default', () => {
    expect(renderCanvas()).not.toContain('data-testid="zoom-lens"');
    expect(renderCanvas(false)).not.toContain('data-testid="zoom-lens"');
  });

  it('gates the preview markup on the toggle alone (fixed pane, no cursor needed)', () => {
    const source = canvasSource();
    expect(source).toContain('{showLens && <div className="zoom-lens" data-testid="zoom-lens"');
    expect(source).not.toContain('lensCenter');
  });

  it('previews the frame center before the cursor enters the photo', () => {
    expect(canvasSource()).toContain('cursor ?? { x: frameWidth / 2, y: frameHeight / 2 }');
  });

  it('paints the preview from the edited canvas at the 8x source rect', () => {
    const source = canvasSource();
    expect(source).toContain('zoomLensSourceRect(');
    expect(source).toContain('drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, lens.width, lens.height)');
    expect(source).toContain('{ZOOM_LENS_MAGNIFICATION}×');
  });

  it('tracks the cursor over the photo while the preview is on', () => {
    expect(canvasSource()).toContain('if (isBrush || showLens) { const point = position(event); setCursor(');
  });

  it('styles the preview as a fixed square in the bottom-right corner with a factor badge', () => {
    const rule = cssRule('.zoom-lens');
    expect(rule).toMatch(/right\s*:\s*12px/);
    expect(rule).toMatch(/bottom\s*:\s*12px/);
    expect(rule).not.toMatch(/border-radius\s*:\s*50%/);
    expect(rule).not.toMatch(/translate\(-50%,\s*-50%\)/);
    expect(rule).toMatch(/pointer-events\s*:\s*none/);
    expect(rule).toMatch(/overflow\s*:\s*hidden/);
    expect(cssRule('.zoom-lens canvas')).toMatch(/width\s*:\s*100%/);
    expect(cssRule('.zoom-lens-label')).toMatch(/position\s*:\s*absolute/);
  });
});
