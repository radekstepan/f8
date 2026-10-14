import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { ActionStack, ActionStackEntry, EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import { useEditor } from '../hooks/useEditor.js';
import type { EditorSeed } from '../hooks/useEditor.js';

// Auto scene-enhance row, rendered on the server (no jsdom): effects never
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
      onResetWhiteBalance={noop}
      onResetLightness={noop}
      onResetColor={noop}
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

  it('runs scene enhance from a header toggle, never a repeated bar', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, noop);
    expect(html).toContain('data-testid="scene-enhance"');
    expect(html).toContain('data-testid="scene-enhance-toggle"');
    expect(html).not.toContain('data-testid="scene-enhance-ml"');
    expect(html).not.toContain('data-testid="scene-enhance-auto"');
    expect(html).toContain('class="toggle" data-testid="scene-enhance-toggle"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('data-tooltip="Apply scene enhance automatically"');
    expect(html).toContain('Classify the scene automatically');
    // No apply bar repeating the section title; no ML badge (a heuristic
    // auto runs here, not a model) and no reset (the toggle reverts).
    expect(html).not.toContain('data-testid="scene-enhance-apply"');
    expect(html).not.toContain('ml-badge');
    expect(html).not.toContain('aria-label="Reset scene enhance"');
  });

  it('lights the header toggle while applied, with no reset beside it', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      noop,
      { mode: 'scene', pure: true },
    );
    expect(html).toContain('class="toggle is-on" data-testid="scene-enhance-toggle"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-tooltip="Scene enhance on — click to revert"');
    expect(html).not.toContain('aria-label="Reset scene enhance"');
  });

  it('keeps the section title visible before and after applying', () => {
    const idle = renderAdjust({ ...DEFAULT_EDIT }, noop);
    expect(idle).toContain('<h3>Scene Enhance</h3>');
    expect(idle).toContain('data-testid="scene-enhance-toggle"');
    const applied = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      noop,
      { mode: 'scene', pure: true },
    );
    expect(applied).toContain('<h3>Scene Enhance</h3>');
    expect(applied).toContain('data-testid="scene-enhance-toggle"');
    expect(applied).not.toContain('data-testid="scene-enhance-apply"');
  });

  it('labels the detected scene with confidence once auto enhance is applied', () => {
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

  it('keeps the header Auto alongside the scene section', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, noop);
    expect(html).toContain('data-testid="auto-enhance-auto"');
    expect(html).toContain('Scene Enhance');
    expect(html).not.toContain('<h3>Auto Enhance</h3>');
  });
});

/** Reload wiring probe: the seeded editor drives the Inspector, like App does after a hard reload. */
function ReloadProbe({ seed }: { seed: EditorSeed }) {
  const editor = useEditor('p1', { initial: seed });
  return (
    <Inspector
      photo={makePhoto()}
      edit={editor.edit}
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
      onAutoScene={noop}
      enhanceMode={editor.enhanceMode}
      enhancePure={editor.enhancePure}
      enhanceCanRevert={editor.enhanceCanRevert}
      onRevertEnhance={noop}
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onResetWhiteBalance={noop}
      onResetLightness={noop}
      onResetColor={noop}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />
  );
}

describe('scene enhance reload', () => {
  // Server-rendered probe: SSR runs the hook's state initializers but never
  // effects, so this pins the synchronous seed path — the async seed effect
  // maps the same seed through the same sanitizer.
  const seedFor = (present: EditState, actions: ActionStack = []): EditorSeed => ({
    histories: { p1: { past: [], present, future: [] } },
    actions: { p1: actions },
  });

  function EnhanceSeedProbe({ seed, photoId }: { seed: EditorSeed; photoId: string }) {
    const editor = useEditor(photoId, { initial: seed });
    return <span data-testid="enhance-seed" data-mode={editor.enhanceMode ?? 'none'} data-pure={String(editor.enhancePure)} data-revert={String(editor.enhanceCanRevert)} />;
  }

  const seedHtml = (seed: EditorSeed, photoId = 'p1'): string =>
    renderToStaticMarkup(<EnhanceSeedProbe seed={seed} photoId={photoId} />);

  const sceneStack: ActionStack = [{
    kind: 'enhance',
    mode: 'scene',
    pure: true,
    snapshot: { exposure: 0, contrast: 0, preset: 'Original' },
    appliedAt: '2026-10-13T00:00:00.000Z',
  }];

  it('restores the scene highlight and revert from the persisted stack', () => {
    // The reload state: recipe plus its action stack — the scene toggle
    // reopens on AND revertible instead of reopening idle.
    const html = seedHtml(seedFor(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      sceneStack,
    ));
    expect(html).toContain('data-mode="scene"');
    expect(html).toContain('data-pure="true"');
    expect(html).toContain('data-revert="true"');
  });

  it('restores a manually-touched stack as revert-without-highlight', () => {
    // Pure cleared in-session (manual edit after the apply) persists that
    // way: the revert survives the reload, the highlight stays off.
    const html = seedHtml(seedFor(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 }, exposure: 0.5 },
      [{ ...sceneStack[0], pure: false } as ActionStackEntry],
    ));
    expect(html).toContain('data-mode="scene"');
    expect(html).toContain('data-pure="false"');
    expect(html).toContain('data-revert="true"');
  });

  it('drops legacy per-category entries: section toggles light from the dirty values instead', () => {
    // A pre-toggle persisted stack still carries category entries: the
    // seed sanitizer drops them (nothing reads them anymore) while the
    // enhance entry restores — and the dirty sections light their
    // toggles straight from the recipe values.
    const html = seedHtml(seedFor({ ...DEFAULT_EDIT, temperature: 5800, tint: 6, exposure: 0.2 }, [
      ...sceneStack,
      { kind: 'whiteBalance', pure: true, snapshot: { temperature: 5500, tint: 0 }, appliedAt: '2026-10-13T00:00:00.000Z' },
      { kind: 'lightness', pure: false, snapshot: { exposure: 0 }, appliedAt: '2026-10-13T00:01:00.000Z' },
    ]));
    expect(html).toContain('data-mode="scene"');
    expect(html).toContain('data-pure="true"');
    expect(html).toContain('data-revert="true"');
    const reloaded = renderToStaticMarkup(<ReloadProbe seed={seedFor(
      { ...DEFAULT_EDIT, temperature: 5800, tint: 6, exposure: 0.2, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      sceneStack,
    )} />);
    expect(reloaded).toContain('class="toggle is-on" data-testid="scene-enhance-toggle"');
    expect(reloaded).toContain('class="toggle is-on" data-testid="white-balance-toggle"');
    expect(reloaded).toContain('class="toggle is-on" data-testid="lightness-toggle"');
    expect(reloaded).toContain('class="toggle" data-testid="color-toggle"');
    expect(reloaded).not.toContain('section-reset');
  });

  it('seeds no highlight from persisted flags alone (legacy stack-less recipe)', () => {
    // Pre-stack recipes carry the auto flags but no revert snapshot — the
    // controls reopen idle (never enabled-without-a-reset) until a fresh
    // apply pushes a stack entry.
    const html = seedHtml(seedFor({ ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } }));
    expect(html).toContain('data-mode="none"');
    expect(html).toContain('data-pure="false"');
    expect(html).toContain('data-revert="false"');
  });

  it('seeds no highlight for unenhanced recipes or unknown photos', () => {
    expect(seedHtml(seedFor({ ...DEFAULT_EDIT }))).toContain('data-mode="none"');
    expect(seedHtml(seedFor(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      sceneStack,
    ), 'p2')).toContain('data-mode="none"');
  });

  it('renders the reloaded scene enhance on, with its scene badge and no reset', () => {
    // The full reload wiring in one render: the seeded editor drives the
    // Inspector, so the scene toggle reopens on (toggling off restores
    // the persisted snapshot) and the scene badge still shows what ran.
    const html = renderToStaticMarkup(<ReloadProbe seed={seedFor(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      sceneStack,
    )} />);
    expect(html).toContain('class="toggle is-on" data-testid="scene-enhance-toggle"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-tooltip="Scene enhance on — click to revert"');
    expect(html).not.toContain('aria-label="Reset scene enhance"');
    expect(html).toContain('data-testid="scene-enhance-scene"');
  });

  it('renders a legacy stack-less reload idle with no reset, keeping the scene badge', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, sceneEnhance: { scene: 'night', confidence: 0.9 } },
      noop,
    );
    expect(html).toContain('class="toggle" data-testid="scene-enhance-toggle"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('data-tooltip="Apply scene enhance automatically"');
    expect(html).toContain('data-testid="scene-enhance-scene"');
    expect(html).not.toContain('aria-label="Reset scene enhance"');
  });

  it('keeps per-section toggles on for reloaded enhance values', () => {
    // The stored values light their section toggles after a reload
    // (Details lights its switch like every other manual section),
    // alongside the persisted whole-photo revert.
    const html = renderAdjust(
      { ...DEFAULT_EDIT, autoEnhanced: true, exposure: 0.22, clarity: 12 },
      noop,
    );
    expect(html).toContain('class="toggle is-on" data-testid="lightness-toggle"');
    expect(html).toContain('class="toggle is-on" data-testid="details-toggle"');
  });
});
