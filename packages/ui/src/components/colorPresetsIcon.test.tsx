import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Photo, Preset } from '@f8/core';
import { PresetStrip } from './PhotoStrips.js';
import { Toolbar } from './Topbar.js';

// Color Presets icon: the preset strip heading used the same SlidersHorizontal
// glyph as the toolbar's generic Show/Hide presets toggle (and the Adjust
// tool), so the strip read as a duplicate of the toggle. The strip heading
// now uses a swatch-book motif — a color collection, not generic sliders —
// while the toolbar toggle keeps the generic icon. Rendered on the server
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

  it('keeps the generic sliders icon on the toolbar presets toggle', () => {
    const html = renderToolbar();
    expect(html).toContain('lucide-sliders-horizontal');
    expect(html).not.toContain('lucide-swatch-book');
  });
});
