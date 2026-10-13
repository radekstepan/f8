import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// ML scene-enhance row, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior.

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

function renderAdjust(edit: EditState, onAutoScene?: () => void, enhance?: { mode: 'classic' | 'scene' | null; pure?: boolean }): string {
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
      {...(enhance ? { enhanceMode: enhance.mode, enhancePure: enhance.pure ?? false } : {})}
      {...(onAutoScene === undefined ? {} : { onAutoScene })}
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

describe('scene enhance row', () => {
  it('is absent without an onAutoScene handler', () => {
    expect(renderAdjust({ ...DEFAULT_EDIT })).not.toContain('data-testid="scene-enhance"');
  });

  it('runs scene enhance from a header ML button, never a repeated bar', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, noop);
    expect(html).toContain('data-testid="scene-enhance"');
    expect(html).toContain('data-testid="scene-enhance-ml"');
    expect(html).toContain('class="ml-button" data-testid="scene-enhance-ml"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('title="Automatically adjust scene enhance with ML"');
    expect(html).toContain('>ML<');
    expect(html).toContain('Classify the scene with ML');
    // No apply bar repeating the section title, and no badge doubling the
    // header button.
    expect(html).not.toContain('data-testid="scene-enhance-apply"');
    expect(html).not.toContain('ml-badge');
    expect(html).not.toContain('data-testid="scene-enhance-ml-revert"');
  });

  it('highlights the header ML button and offers revert while applied', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      noop,
      { mode: 'scene', pure: true },
    );
    expect(html).toContain('class="ml-button is-active" data-testid="scene-enhance-ml"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="ML scene enhance applied — click to revert"');
    expect(html).toContain('data-testid="scene-enhance-ml-revert"');
    expect(html).toContain('aria-label="Revert ML scene enhance"');
  });

  it('keeps the section title visible before and after applying', () => {
    const idle = renderAdjust({ ...DEFAULT_EDIT }, noop);
    expect(idle).toContain('<h3>Scene Enhance</h3>');
    expect(idle).toContain('data-testid="scene-enhance-ml"');
    const applied = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      noop,
      { mode: 'scene', pure: true },
    );
    expect(applied).toContain('<h3>Scene Enhance</h3>');
    expect(applied).toContain('data-testid="scene-enhance-ml"');
    expect(applied).not.toContain('data-testid="scene-enhance-apply"');
  });

  it('labels the detected scene with confidence once ML enhance is applied', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'portrait', confidence: 0.86 } },
      noop,
    );
    expect(html).toContain('data-testid="scene-enhance-scene"');
    expect(html).toContain('Portrait · 86% · ML');
  });

  it('shows no scene label for classic enhance, which stores no scene', () => {
    expect(renderAdjust({ ...DEFAULT_EDIT, autoEnhanced: true }, noop)).not.toContain(
      'data-testid="scene-enhance-scene"',
    );
  });

  it('keeps the persisted scene label even once the highlight is gone', () => {
    // The badge is persisted recipe context (detected scene + confidence),
    // not session highlight state: it survives manual edits and reloads
    // that drop the button highlight. A real revert nulls sceneEnhance and
    // takes the badge with it.
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: false, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      noop,
    );
    expect(html).toContain('data-testid="scene-enhance-scene"');
    expect(html).toContain('Night · 90% · ML');
  });

  it('keeps the classic Auto Enhance section alongside the ML section', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, noop);
    expect(html).toContain('Auto Enhance');
    expect(html).toContain('Scene Enhance');
  });
});
