import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo, Preset } from '@f8/core';
import { PresetStrip } from './PhotoStrips.js';
import { Toolbar } from './Topbar.js';

// Color Presets icon: the preset strip heading uses a swatch-book motif —
// a color collection, not generic sliders — and the toolbar's Show/Hide
// presets toggle matches it with the same glyph (it previously reused the
// SlidersHorizontal glyph shared with the Adjust tool, so the toggle read
// as a duplicate of Adjust instead of presets). Rendered on the server
// (no jsdom): pins the markup, not live behavior.

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

function makePresets(): Preset[] {
  return [
    { id: 'original', name: 'Original', category: 'Essentials', values: {} },
    { id: 'vivid', name: 'Vivid', category: 'Essentials', values: { saturation: 30 } },
  ];
}

function renderStrip(): string {
  return renderToStaticMarkup(
    <PresetStrip photo={makePhoto()} presets={makePresets()} selected="Original" onSelect={noop} onAdd={noop} onToggle={noop} />,
  );
}

function renderToolbar(): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={2}
      tool="adjust"
      compare={false}
      canUndo={false}
      canRedo={false}
      showBacklink
      presetsOpen
      onTool={noop}
      onAction={noop}
      onDialog={noop}
      onTogglePresets={noop}
    />,
  );
}

describe('color presets icon', () => {
  it('renders a swatch-book icon in the preset strip heading', () => {
    expect(renderStrip()).toContain('lucide-swatch-book');
  });

  it('renders the swatch icon next to the Presets title', () => {
    const html = renderStrip();
    expect(html.indexOf('lucide-swatch-book')).toBeLessThan(html.indexOf('<h2>Presets</h2>'));
    expect(html).toContain('presets-title');
  });

  it('renders no generic sliders icon anywhere in the preset strip', () => {
    expect(renderStrip()).not.toContain('lucide-sliders-horizontal');
  });

  it('renders the swatch-book icon on the toolbar presets toggle', () => {
    const html = renderToolbar();
    const toggle = html.match(/<button[^>]*aria-label="(?:Show|Hide) presets"[^>]*>.*?<\/button>/s)?.[0] ?? '';
    expect(toggle).toContain('lucide-swatch-book');
    expect(toggle).not.toContain('lucide-sliders-horizontal');
  });

  it('matches the toolbar toggle glyph to the strip heading glyph', () => {
    // The top toggle and the bottom strip title must render the same icon
    // so the toggle reads as the strip's control, not as the Adjust tool.
    const stripTitle = renderStrip().match(/<div class="presets-title">.*?<\/div>/s)?.[0] ?? '';
    const toggle = renderToolbar().match(/<button[^>]*aria-label="(?:Show|Hide) presets"[^>]*>.*?<\/button>/s)?.[0] ?? '';
    const iconOf = (markup: string) => markup.match(/lucide-[a-z-]+/)?.[0];
    expect(iconOf(stripTitle)).toBe('lucide-swatch-book');
    expect(iconOf(toggle)).toBe(iconOf(stripTitle));
  });

  it('keeps the sliders icon on the Adjust tool itself', () => {
    const html = renderToolbar();
    const adjust = html.match(/<button[^>]*aria-label="Adjust"[^>]*>.*?<\/button>/s)?.[0] ?? '';
    expect(adjust).toContain('lucide-sliders-horizontal');
  });
});
