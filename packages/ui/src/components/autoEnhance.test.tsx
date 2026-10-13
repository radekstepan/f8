import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo, Tool } from '@f8/core';
import { Inspector } from './Inspector.js';
import { Toolbar } from './Topbar.js';

// Task 8: one Auto Enhance entry point — the Adjust sidebar section with a
// small header Auto button. No Enhance tab in the header toolbar, no
// full-width bar anywhere. Rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');

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

function renderToolbar(tool: Tool): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool={tool}
      compare={false}
      canUndo
      canRedo={false}
      libraryView={false}
      onTool={noop}
      onAction={noop}
      onDialog={noop}
    />,
  );
}

function renderAdjust(enhance?: { mode: 'classic' | 'scene' | null; pure?: boolean }): string {
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool="adjust"
      histogram={null}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      onChange={noop}
      onRotate={noop}
      onStraighten={noop}
      onReset={noop}
      onAuto={noop}
      onRevertEnhance={noop}
      {...(enhance ? { enhanceMode: enhance.mode, enhancePure: enhance.pure ?? false } : {})}
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onRevertWhiteBalance={noop}
      onRevertLightness={noop}
      onRevertColor={noop}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

describe('auto enhance single entry point', () => {
  it('keeps the header toolbar to real tools: no Enhance tab', () => {
    for (const tool of ['adjust', 'repair', 'crop'] as const) {
      const html = renderToolbar(tool);
      expect(html).not.toContain('Enhance');
      expect(html).not.toContain('enhance-tool');
      expect(html).not.toContain('auto-enhance');
      expect(html.match(/class="tool-button/g)?.length).toBe(3);
    }
  });

  it('runs the sidebar enhance from a small header Auto button', () => {
    const html = renderAdjust();
    expect(html).toContain('<h3>Auto Enhance</h3>');
    expect(html).toContain('class="auto-small" data-testid="auto-enhance-auto" aria-pressed="false"');
    expect(html).toContain('Automatically enhance exposure, contrast, and color.');
    // No full-width bar anywhere near it.
    expect(html).not.toContain('auto-enhance-apply');
    expect(html).not.toContain('classic-enhance');
  });

  it('highlights the Auto button when applied, with the revert left of it', () => {
    const html = renderAdjust({ mode: 'classic', pure: true });
    expect(html).toContain('class="auto-small is-active" data-testid="auto-enhance-auto" aria-pressed="true"');
    expect(html).toContain('data-testid="auto-enhance-auto-revert"');
    // Closing quotes: the revert testid shares the Auto testid prefix.
    const revert = html.indexOf('data-testid="auto-enhance-auto-revert"');
    const auto = html.indexOf('data-testid="auto-enhance-auto"');
    expect(revert).toBeGreaterThan(-1);
    expect(auto).toBeGreaterThan(-1);
    expect(revert).toBeLessThan(auto);
  });

  it('leaves no dead enhance-bar CSS behind', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(css).not.toMatch(/\.classic-enhance/);
    expect(css).not.toMatch(/\.enhance-tool/);
  });
});
