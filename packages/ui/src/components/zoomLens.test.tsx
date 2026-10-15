import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { MenuBar } from './Topbar.js';
import { PhotoCanvas } from './PhotoCanvas.js';

// Zoom in View: a View-menu submenu in its own section under the Show items with 4x/8x/16x
// options (8x is the default and the only one with a shortcut, Z) that
// shows a fixed square preview in photo (editor) view only — docked
// right of the photo when the stage has room, else overlaying the
// photo's bottom-right corner. The pane paints from the edited canvas in an
// effect (unreachable from server rendering, like the minimap mirror),
// compositing the original side while Compare is on and the repair brush
// circle while Repair is on — so the paint math is unit-tested in
// packages/core/src/zoomLens.test.ts and this file pins the wiring: the
// submenu with its checked states and shortcut, the App
// state/action/shortcut/props plumbing, the pane markup gate, and the
// stylesheet.

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

describe('zoom-in-view menu submenu', () => {
  it('sits in its own section under the Show items, not at the bottom of the dropdown', () => {
    const line = viewMenuLine();
    expect(line).toContain('{zoomLensSubmenu}');
    const at = line.indexOf('{zoomLensSubmenu}');
    expect(at).toBeGreaterThan(line.indexOf("'filmstrip'"));
    // Own section: a separator on each side of the submenu parent.
    const before = line.slice(0, at);
    expect(before.lastIndexOf('<MenuSeparator />')).toBeGreaterThan(before.indexOf("'filmstrip'"));
    const after = line.slice(at);
    expect(after.indexOf('<MenuSeparator />')).toBeGreaterThan(-1);
    expect(after.indexOf('<MenuSeparator />')).toBeLessThan(after.indexOf("'fit'"));
    expect(line).not.toContain("'zoom-lens'");
  });

  it('left-aligns every dropdown label with shortcuts pinned right (8x lines up with 4x/16x)', () => {
    // Root cause: .menu-item used space-between, so two-child items
    // ([check, label]: Show toggles, 4x, 16x) pushed the label flush
    // right while three-child items ([check, label, kbd/chevron]: 8x
    // with Z, the Zoom in View parent) centered it. Labels now start
    // left; kbd and the submenu chevron keep margin-left auto so
    // shortcuts stay right-aligned.
    expect(cssRule('.menu-item')).toMatch(/justify-content\s*:\s*flex-start/);
    expect(cssRule('.menu-item')).not.toMatch(/space-between/);
    expect(cssRule('.menu-item kbd')).toMatch(/margin-left\s*:\s*auto/);
    // The submenu parent keeps the same [check, label] lead as its
    // MenuItem siblings, so its label starts at the same x.
    expect(topbarSource()).toContain('<span className="menu-check">{zoomLens && <Check size={13} />}</span><span>Zoom in View</span>');
  });

  it('opens a 4x/8x/16x flyout from the submenu map with per-option checked state', () => {
    const source = topbarSource();
    expect(source).toContain('const zoomLensActions: Record<ZoomLensMagnification, MenuAction> = { 4: \'zoom-lens-4\', 8: \'zoom-lens-8\', 16: \'zoom-lens-16\' };');
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain('{ZOOM_LENS_MAGNIFICATIONS.map((mag)');
    expect(source).toContain('checked={zoomLens && zoomLensMagnification === mag}');
  });

  it('gives only the 8x default the Z shortcut', () => {
    const source = topbarSource();
    expect(source).toContain("shortcut={mag === 8 ? 'Z' : undefined}");
    expect(source).not.toMatch(/zoom-lens-(4|16)', 'Z'/);
  });

  it('adds no top-level menu', () => {
    const html = renderToStaticMarkup(
      <MenuBar onAction={noop} canUndo canRedo={false} canPaste sidebar inspector presets={false} filmstrip zoomLens zoomLensMagnification={8} />,
    );
    const labels = Array.from(html.matchAll(/class="menu-trigger[^"]*"[^>]*>([^<]+)</g)).map((match) => match[1] ?? '');
    expect(labels).toEqual(['File', 'Edit', 'Image', 'View', 'Help']);
  });

  it('is listed in the keyboard shortcuts dialog', () => {
    expect(dialogsSource()).toContain("['Zoom in view', 'Z']");
  });
});

describe('zoom-in-view parent clears the preview', () => {
  it('fires the active factor when the parent row is clicked while on (re-pick turns it off)', () => {
    // No new action: re-picking the active factor hits the App toggle-off
    // rule, and action() dismisses the menu like any other Show item.
    const source = topbarSource();
    const parent = source.split('\n').find((line) => line.includes('has-submenu') && line.includes('Zoom in View')) ?? '';
    expect(parent).toContain('onClick={() => zoomLens ? action(zoomLensActions[zoomLensMagnification])');
  });

  it('keeps the click-to-open flyout for touch while the preview is off', () => {
    const source = topbarSource();
    const parent = source.split('\n').find((line) => line.includes('has-submenu') && line.includes('Zoom in View')) ?? '';
    expect(parent).toContain(": setSubmenu(submenu === 'zoom-lens' ? null : 'zoom-lens')");
  });

  it('opens the flyout from ArrowRight without firing the parent clear', () => {
    const source = topbarSource();
    expect(source).toContain('const target = (focused as HTMLElement).dataset.submenu;');
    expect(source).toContain("if (focused.classList.contains('has-submenu') && target) setSubmenu(target);");
    expect(source).toContain('else (focused as HTMLButtonElement).click();');
    expect(source).toContain('data-submenu="zoom-lens"');
  });
});

describe('zoom-in-view app wiring', () => {
  it('enables the preview at the picked factor, re-picking the active factor turns it off', () => {
    const source = appSource();
    expect(source).toContain("case 'zoom-lens-4':");
    expect(source).toContain("case 'zoom-lens-8':");
    expect(source).toContain("case 'zoom-lens-16':");
    expect(source).toContain('if (zoomLens && zoomLensMag === mag) setZoomLens(false);');
    expect(source).toContain('else { setZoomLensMag(mag); setZoomLens(true); }');
  });

  it('toggles the 8x default from the Z shortcut', () => {
    expect(appSource()).toContain("z: 'zoom-lens-8'");
  });

  it('shows the checked state and magnification in the menu bar', () => {
    const block = menuBarBlock();
    expect(block).toContain('zoomLens={zoomLens}');
    expect(block).toContain('zoomLensMagnification={zoomLensMag}');
  });

  it('gates the preview on photo view and passes the magnification to the canvas', () => {
    const block = photoCanvasBlock();
    expect(block).toContain('zoomLens={shouldShowZoomLens(view, zoomLens)}');
    expect(block).toContain('zoomLensMagnification={zoomLensMag}');
  });
});

describe('zoom-in-view preview pane', () => {
  it('renders no preview by default', () => {
    expect(renderCanvas()).not.toContain('data-testid="zoom-lens"');
    expect(renderCanvas(false)).not.toContain('data-testid="zoom-lens"');
  });

  it('gates the preview markup on the toggle alone (fixed pane, no cursor needed)', () => {
    const source = canvasSource();
    expect(source).toContain('{showLens && <div className={`zoom-lens${lensDockedOutside ? \' is-outside\' : \'\'}`} data-testid="zoom-lens"');
    expect(source).not.toContain('lensCenter');
  });

  it('docks the preview right of the frame when the stage has room, from render-derived sizes', () => {
    // Synchronous from stageSize + frame dims (no viewport/effect lag),
    // so zooming in/out never flashes the wrong placement for a frame.
    const source = canvasSource();
    expect(source).toContain('shouldDockZoomLensOutside(stageSize, { width: frameWidth, height: frameHeight })');
  });

  it('previews the frame center before the cursor enters the photo', () => {
    expect(canvasSource()).toContain('cursor ?? { x: frameWidth / 2, y: frameHeight / 2 }');
  });

  it('paints the preview from the edited canvas at the submenu magnification with a matching badge', () => {
    const source = canvasSource();
    expect(source).toContain('zoomLensSourceRect(');
    expect(source).toContain('ZOOM_LENS_SIZE_PX,\n      zoomLensMagnification,');
    expect(source).toContain('drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, lens.width, lens.height)');
    expect(source).toContain('{zoomLensMagnification}×');
    expect(source).toContain('Zoomed preview at ${zoomLensMagnification}x magnification');
  });

  it('composites the original side while Compare is on and previews it alone while held', () => {
    const source = canvasSource();
    expect(source).toContain('zoomLensOriginalOverlay(split, canvas, rect,');
    expect(source).toContain('drawImage(original, overlay.sx, overlay.sy, overlay.sw, overlay.sh, overlay.dx, overlay.dy, overlay.dw, overlay.dh)');
    expect(source).toContain('if (showOriginal) {');
    expect(source).toContain('} else if (compare) {');
  });

  it('draws the repair brush circle over the pane when the magnified brush fits', () => {
    const source = canvasSource();
    expect(source).toContain('if (isBrush && !compare && !showOriginal && !mlRepairBlocked) {');
    expect(source).toContain('zoomLensBrushRadius(brushSize, frameWidth, zoomLensMagnification, lens.width)');
    expect(source).toContain('zoomLensDestPoint(');
    expect(source).toContain('ctx.arc(center.dx, center.dy, radius, 0, Math.PI * 2)');
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

  it('docks the preview outside the frame, bottom-aligned with a frame gap, when there is room', () => {
    // Still absolutely positioned inside the frame element (scrolls with
    // the photo), just offset past its right edge instead of inset.
    const rule = cssRule('.zoom-lens.is-outside');
    expect(rule).toMatch(/left\s*:\s*calc\(100%\s*\+\s*12px\)/);
    expect(rule).toMatch(/right\s*:\s*auto/);
    expect(rule).toMatch(/bottom\s*:\s*0/);
  });

  it('styles the flyout right of the parent item with full rounding', () => {
    expect(cssRule('.menu-submenu-anchor')).toMatch(/position\s*:\s*relative/);
    const flyout = cssRule('.dropdown-menu.dropdown-submenu');
    expect(flyout).toMatch(/left\s*:\s*calc\(100%/);
    expect(cssRule('.menu-bar .dropdown-menu.dropdown-submenu')).toMatch(/border-top-left-radius\s*:\s*7px/);
    expect(cssRule('.menu-item .menu-chevron')).toMatch(/margin-left\s*:\s*auto/);
  });
});
