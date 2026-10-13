import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, HistoryState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import { useEditor } from '../hooks/useEditor.js';

// ML scene-enhance row, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring, not click behavior.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
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

function renderAdjust(edit: EditState, onAutoScene?: () => void, enhance?: { mode: 'classic' | 'scene' | null; pure?: boolean; canRevert?: boolean }): string {
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
      {...(enhance?.canRevert === undefined ? {} : { enhanceCanRevert: enhance.canRevert })}
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
    expect(html).not.toContain('aria-label="Reset scene enhance"');
  });

  it('highlights the header ML button and offers reset while applied', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      noop,
      { mode: 'scene', pure: true },
    );
    expect(html).toContain('class="ml-button is-active" data-testid="scene-enhance-ml"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="ML scene enhance applied — click to revert"');
    expect(html).toContain('section-reset is-dirty" title="Reset scene enhance"');
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
    expect(html).toContain('>Portrait · 86%<');
    expect(html).not.toContain('· ML');
  });

  it('renders the scene status in plain text, never action gold', () => {
    // Gold (#f0d397) is reserved for links/actions; the persisted scene
    // label is status text, so it uses the plain 10px label grey. This
    // rule is shared with the enhance-faces applied summary, which gets
    // the same treatment (see faceEnhance.test.tsx).
    const rule = cssRule('.scene-enhance-scene');
    expect(rule).toMatch(/color\s*:\s*#bdbdc7/);
    expect(rule).not.toContain('#f0d397');
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
    expect(html).toContain('>Night · 90%<');
  });

  it('keeps the classic Auto Enhance section alongside the ML section', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, noop);
    expect(html).toContain('Auto Enhance');
    expect(html).toContain('Scene Enhance');
  });
});

describe('scene enhance reload', () => {
  // Server-rendered probe: SSR runs the hook's state initializers but never
  // effects, so this pins the synchronous seed path — the async seed effect
  // maps the same flags through the same helper.
  const seedFor = (present: EditState): Record<string, HistoryState> => ({ p1: { past: [], present, future: [] } });

  function EnhanceSeedProbe({ seed, photoId }: { seed: Record<string, HistoryState>; photoId: string }) {
    const editor = useEditor(photoId, { initial: seed });
    return <span data-testid="enhance-seed" data-mode={editor.enhanceMode ?? 'none'} data-pure={String(editor.enhancePure)} data-revert={String(editor.enhanceCanRevert)} />;
  }

  const seedHtml = (seed: Record<string, HistoryState>, photoId = 'p1'): string =>
    renderToStaticMarkup(<EnhanceSeedProbe seed={seed} photoId={photoId} />);

  it('seeds the scene highlight from the persisted scene, with no revert snapshot', () => {
    const html = seedHtml(seedFor({ ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } }));
    expect(html).toContain('data-mode="scene"');
    expect(html).toContain('data-pure="true"');
    expect(html).toContain('data-revert="false"');
  });

  it('seeds the classic highlight from the auto flag alone', () => {
    const html = seedHtml(seedFor({ ...DEFAULT_EDIT, autoEnhanced: true }));
    expect(html).toContain('data-mode="classic"');
    expect(html).toContain('data-pure="true"');
    expect(html).toContain('data-revert="false"');
  });

  it('seeds no highlight for unenhanced recipes or unknown photos', () => {
    expect(seedHtml(seedFor({ ...DEFAULT_EDIT }))).toContain('data-mode="none"');
    expect(seedHtml(seedFor({ ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } }), 'p2')).toContain('data-mode="none"');
  });

  it('renders the seeded ML enabled with no reset and a re-apply tooltip', () => {
    // The reload state: persisted scene + seeded highlight, but no session
    // snapshot — so the button shows enabled while the reset icon (which
    // promises a value restore) stays hidden, and the tooltip offers a
    // re-apply instead of a revert.
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      noop,
      { mode: 'scene', pure: true, canRevert: false },
    );
    expect(html).toContain('class="ml-button is-active" data-testid="scene-enhance-ml"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="ML scene enhance applied — click to re-apply"');
    expect(html).toContain('data-testid="scene-enhance-scene"');
    expect(html).not.toContain('aria-label="Reset scene enhance"');
  });
});
