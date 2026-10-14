import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, MlCategory, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// Global Auto lights the per-section Autos it drove: after the Color
// Adjustments header Auto applies, White Balance, Lightness, and Hue &
// Saturation show their reset icons (their values changed) — and their
// Auto pills highlight to match, since the enhance turned those autos on.
// Rendered on the server (no jsdom): the markup pins the flag-to-pill
// wiring, and the hook transition itself is pinned from the useEditor
// source (the resetDehighlights.test.ts precedent) plus the
// pushEnhanceAction unit tests in @f8/core.

const here = dirname(fileURLToPath(import.meta.url));
const useEditorSource = () => readFileSync(resolve(here, '../hooks/useEditor.ts'), 'utf8');

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

const ALL_ON: Partial<Record<MlCategory, boolean>> = { whiteBalance: true, lightness: true, color: true };

function renderEnhanced(edit: EditState): string {
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={edit}
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
      enhanceMode="classic"
      enhancePure
      enhanceCanRevert
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onRevertWhiteBalance={noop}
      onRevertLightness={noop}
      onRevertColor={noop}
      mlApplied={ALL_ON}
      mlRevert={ALL_ON}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

describe('global auto highlight', () => {
  it('highlights every per-section Auto the enhance turned on, matching the reset icons', () => {
    // Enhance-produced values: every auto-capable section is dirty, so each
    // header carries a reset — and now a highlighted Auto pill beside it.
    const html = renderEnhanced({
      ...DEFAULT_EDIT,
      temperature: 6000,
      tint: -4,
      exposure: 0.3,
      contrast: 10,
      saturation: 8,
    });
    expect(html).toContain('class="auto-small inspector-auto is-active" data-testid="auto-enhance-auto" aria-pressed="true"');
    for (const [id, tooltip] of [
      ['white-balance', 'White Balance applied — click to revert'],
      ['lightness', 'Lightness applied — click to revert'],
      ['color', 'Hue &amp; Saturation applied — click to revert'],
    ] as const) {
      expect(html).toContain(`class="auto-small is-active" data-testid="${id}-auto" aria-pressed="true"`);
      expect(html).toContain(`data-tooltip="${tooltip}"`);
      expect(html).not.toContain(`data-testid="${id}-ml"`);
    }
    // One reset per touched section, matching the highlight state.
    expect(html).toContain('aria-label="Reset white balance"');
    expect(html).toContain('aria-label="Reset lightness"');
    expect(html).toContain('aria-label="Reset hue &amp; saturation"');
  });

  it('routes the enhance apply through the shared stack transition, keeping run invalidation', () => {
    // runEnhance pushes the enhance entry plus the per-category entries in
    // one core transition (snapshotting the same pre-enhance recipe), while
    // still invalidating in-flight per-category applies the enhance
    // overwrites.
    const source = useEditorSource();
    expect(source).toContain('pushEnhanceAction(stacksRef.current[photoId] ?? [], mode, history.present, new Date().toISOString())');
    expect(source).toContain('invalidateMlRuns(photoId)');
  });
});
