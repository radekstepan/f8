import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { PhotoCanvas } from './PhotoCanvas.js';
import { MenuBar, Toolbar } from './Topbar.js';

// Press-and-hold Compare, rendered on the server (no jsdom): pins the
// disabled-without-edits markup + prop wiring, not live pointer behavior
// (the hold state machine itself is unit-tested in
// packages/core/src/compareHold.test.ts). A quick click still toggles the
// side-by-side split; holding either Compare button previews the full
// original until release; both buttons (plus the menu item and the B
// shortcut) stay disabled while the photo has no edits.

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../../../apps/web/src');
const appSource = () => readFileSync(resolve(webRoot, 'App.tsx'), 'utf8');
const topbarSource = () => readFileSync(resolve(here, 'Topbar.tsx'), 'utf8');
const canvasSource = () => readFileSync(resolve(here, 'PhotoCanvas.tsx'), 'utf8');

const noop = () => {};

function renderToolbar(props: { tool?: 'adjust' | 'repair' | 'crop'; canCompare?: boolean }): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool={props.tool ?? 'adjust'}
      compare={false}
      canUndo
      canRedo={false}
      showBacklink
      {...(props.canCompare === undefined ? {} : { canCompare: props.canCompare })}
      presetsOpen
      onTool={noop}
      onAction={noop}
      onDialog={noop}
      onTogglePresets={noop}
      onHoldOriginal={noop}
    />,
  );
}

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

function renderCanvas(canCompare?: boolean): string {
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
      {...(canCompare === undefined ? {} : { canCompare })}
      onZoom={noop}
      onCompare={noop}
      onFavorite={noop}
      onRating={noop}
      onInfo={noop}
      onChange={noop}
      onHistogram={noop}
      onHoldOriginal={noop}
    />,
  );
}

/** Opening tag of the button whose markup contains the marker. */
function buttonTag(html: string, marker: string): string {
  const markerIndex = html.indexOf(marker);
  expect(markerIndex).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<button', markerIndex);
  const close = html.indexOf('>', markerIndex);
  expect(open).toBeGreaterThan(-1);
  return html.slice(open, close);
}

function appBlock(startMarker: string, endMarker: string): string {
  const source = appSource();
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('compare hold', () => {
  it('keeps the toolbar compare button enabled with its existing name when edits exist', () => {
    const html = renderToolbar({ canCompare: true });
    const tag = buttonTag(html, 'aria-label="Compare with original (B)"');
    expect(tag).not.toContain('disabled');
  });

  it('defaults the toolbar compare button to enabled (existing callers stay compare-shaped)', () => {
    const html = renderToolbar({});
    const tag = buttonTag(html, 'aria-label="Compare with original (B)"');
    expect(tag).not.toContain('disabled');
  });

  it('disables the toolbar compare button with no edits and says why', () => {
    const html = renderToolbar({ canCompare: false });
    const tag = buttonTag(html, 'aria-label="Compare with original (no edits yet)"');
    expect(tag).toContain('disabled');
  });

  it('keeps the crop disabled reason ahead of the edits check', () => {
    const html = renderToolbar({ tool: 'crop', canCompare: false });
    const tag = buttonTag(html, 'aria-label="Compare with original (unavailable while cropping)"');
    expect(tag).toContain('disabled');
  });

  it('advertises hold-to-peek in the toolbar tooltip without renaming the button', () => {
    const html = renderToolbar({ canCompare: true });
    expect(html).toContain('data-tooltip="Compare with original (B) — hold to peek at the original"');
    expect(html).toContain('aria-label="Compare with original (B)"');
  });

  it('routes the toolbar compare click through the hold filter with hold handlers attached', () => {
    const source = topbarSource();
    expect(source).toContain('useCompareHold(onHoldOriginal)');
    expect(source).toContain("compareHold.filterClick(() => onAction('compare'))");
    expect(source).toContain('{...compareHold.holdProps}');
  });

  it('disables the canvas compare button with no edits and says why', () => {
    const html = renderCanvas(false);
    const tag = buttonTag(html, 'compare-button');
    expect(tag).toContain('disabled');
    expect(tag).toContain('Compare is unavailable until you edit the photo');
  });

  it('keeps the canvas compare button enabled by default (existing callers stay compare-shaped)', () => {
    const html = renderCanvas();
    const tag = buttonTag(html, 'compare-button');
    expect(tag).not.toContain('disabled');
    expect(tag).toContain('hold to peek at the original');
  });

  it('routes the canvas compare click through the hold filter with hold handlers attached', () => {
    const source = canvasSource();
    expect(source).toContain('useCompareHold(onHoldOriginal)');
    expect(source).toContain('compareHold.filterClick(onCompare)');
    expect(source).toContain('{...compareHold.holdProps}');
  });

  it('holds the full original while held, not the side-by-side split', () => {
    const source = canvasSource();
    // Full-cover layer while holding (inset 0), split only otherwise.
    expect(source).toContain('showOriginal ? 0 : compare ? 100 - split : 100');
    // Split labels and divider hide while the hold covers the frame.
    expect(source).toContain('{compare && !showOriginal && !loading && <span className="comparison-label original-label">Original</span>}');
    expect(source).toContain('{compare && !showOriginal && !loading && <><div className="comparison-divider"');
    // The hold shows its own Original label instead.
    expect(source).toContain('{showOriginal && <span className="comparison-label original-label">Original</span>}');
  });

  it('derives one hasEdits check from the factory-default recipe in App', () => {
    expect(appSource()).toContain('const hasEdits = !isDefaultEdit(editor.edit);');
  });

  it('wires hold + edits into the toolbar in App', () => {
    const block = appBlock('<Toolbar', '/>}');
    expect(block).toContain('canCompare={hasEdits}');
    expect(block).toContain('onHoldOriginal={setShowOriginal}');
  });

  it('wires hold + edits into the canvas in App', () => {
    const block = appBlock('<PhotoCanvas', '/>');
    expect(block).toContain('canCompare={hasEdits}');
    expect(block).toContain('onHoldOriginal={setShowOriginal}');
  });

  it('disables the Image-menu compare item with no edits in App', () => {
    expect(appSource()).toContain("compareDisabled={tool === 'crop' || !hasEdits}");
  });

  it('renders the menu compare item from compareDisabled', () => {
    // The dropdown only mounts once opened (no jsdom), so the disabled
    // prop itself is pinned from source.
    expect(topbarSource()).toContain("item('Compare with Original', 'compare', 'B', compareDisabled)");
    const html = renderToStaticMarkup(
      <MenuBar onAction={noop} canUndo canRedo canPaste compareDisabled sidebar inspector presets filmstrip />,
    );
    expect(html).toContain('Image');
  });

  it('ignores the B shortcut with no edits in App', () => {
    expect(appSource()).toContain("case 'compare': if (tool === 'crop' || isDefaultEdit(editor.edit)) break;");
  });

  it('exits the split on reset, when there is nothing left to compare', () => {
    const resetCase = appBlock("case 'reset':", "case 'copy':");
    expect(resetCase).toContain('setCompare(false);');
  });
});
