import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { EditorDialogs } from './EditorDialogs.js';
import { RangeControl } from './EditorUI.js';

// Export Quality slider without the double-click reset hint, rendered on
// the server (no jsdom): the generic RangeControl advertises
// "Double-click to reset …" on every slider, but the export Quality slider
// has no meaningful default to restore (its reset target was 0 on a
// 10–100 scale), so the hint is gone there — while ordinary sliders keep
// theirs. Handler absence can't be observed in static markup, so the
// conditional wiring is pinned at source level.

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

/** The export dialog's only range input is the Quality slider. */
function qualitySliderTag(html: string): string {
  return html.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? '';
}

describe('export quality reset hint', () => {
  it('shows no double-click reset hint for Quality', () => {
    expect(renderExport()).not.toContain('Double-click to reset quality');
  });

  it('renders the Quality slider with no reset tooltip at all', () => {
    const tag = qualitySliderTag(renderExport());
    expect(tag).not.toBe('');
    expect(tag).not.toContain('data-tooltip');
  });

  it('keeps the reset hint on ordinary sliders', () => {
    // Scope guard: the removal is Quality-only, not global.
    const html = renderToStaticMarkup(<RangeControl label="Exposure" value={0} onChange={noop} />);
    expect(html).toContain('data-tooltip="Double-click to reset exposure"');
  });

  it('drops the tooltip and the double-click handler when reset is disabled', () => {
    const html = renderToStaticMarkup(
      <RangeControl label="Quality" value={90} min={10} max={100} suffix="%" disableReset onChange={noop} />,
    );
    expect(html.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? '').not.toContain('data-tooltip');
    const here = dirname(fileURLToPath(import.meta.url));
    expect(readFileSync(resolve(here, 'EditorUI.tsx'), 'utf8')).toContain(
      'onDoubleClick={disableReset ? undefined : () => onChange(defaultValue)}',
    );
  });
});
