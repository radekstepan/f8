import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Photo-only toolbar controls: the Adjust/Repair/Crop tool switcher, the
// hide-presets, compare-with-original, and photo-info buttons, and the
// undo/redo/reset editing-history buttons only make sense with a photo
// open, so the library grid omits them entirely (not disabled — absent).
// The library keeps its own controls: sidebar toggle, export, and focus
// mode. Rendered on the server (no jsdom): pins the markup + prop wiring,
// with the App-side view derivation pinned from source (the
// topbarMenus.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../../../apps/web/src');
const appSource = () => readFileSync(resolve(webRoot, 'App.tsx'), 'utf8');

const noop = () => {};

function renderToolbar(showPhotoTools?: boolean): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool="adjust"
      compare={false}
      canUndo
      canRedo={false}
      showBacklink
      {...(showPhotoTools === undefined ? {} : { showPhotoTools })}
      presetsOpen
      onTool={noop}
      onAction={noop}
      onDialog={noop}
      onTogglePresets={noop}
    />,
  );
}

const PHOTO_ONLY_LABELS = [
  'aria-label="Adjust"',
  'aria-label="Repair"',
  'aria-label="Crop"',
  'aria-label="Hide presets"',
  'aria-label="Compare with original (B)"',
  'aria-label="Photo information (I)"',
  'aria-label="Undo (Ctrl Z)"',
  'aria-label="Redo (Ctrl Shift Z, Ctrl Y)"',
  'aria-label="Reset to original"',
];

const LIBRARY_KEPT_LABELS = [
  'aria-label="Toggle library sidebar"',
  'aria-label="Focus mode (Shift F)"',
];

describe('photo-only toolbar controls', () => {
  it('shows the tool switcher, presets/compare/info, and undo/redo/reset buttons on a photo', () => {
    const html = renderToolbar(true);
    for (const label of PHOTO_ONLY_LABELS) expect(html).toContain(label);
    expect(html).toContain('class="editing-tools"');
    expect(html).toContain('class="history-buttons"');
    expect(html).toContain('export-button');
  });

  it('defaults to the full photo toolbar (existing callers stay photo-shaped)', () => {
    const html = renderToolbar();
    for (const label of PHOTO_ONLY_LABELS) expect(html).toContain(label);
  });

  it('omits every photo-only control in the library grid', () => {
    const html = renderToolbar(false);
    for (const label of PHOTO_ONLY_LABELS) expect(html).not.toContain(label);
    expect(html).not.toContain('editing-tools');
    expect(html).not.toContain('history-buttons');
    expect(html).not.toContain('tool-button');
  });

  it('keeps the library controls (sidebar, export, focus)', () => {
    const html = renderToolbar(false);
    for (const label of LIBRARY_KEPT_LABELS) expect(html).toContain(label);
    expect(html).toContain('export-button');
  });

  it('derives the gate from the view in App (editor-only, like the backlink)', () => {
    const source = appSource();
    expect(source).toContain('shouldShowPhotoTools');
    expect(source).toContain('const showPhotoTools = shouldShowPhotoTools(view);');
    expect(source).toContain('showPhotoTools={showPhotoTools}');
  });
});
