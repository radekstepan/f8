import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, EnhanceMode, Photo, Tool } from '@f8/core';
import { Inspector } from './Inspector.js';

// ML Auto Enhance lives in the Color Adjustments ... menu: it applies the
// user's learned taste medians through the shared enhance slot (mode
// 'taste'), with the header revert icon as its applied state. Rendered on
// the server (no jsdom): effects never run, so this pins the markup + prop
// wiring, not click behavior. The closed ... menu is pinned from the
// Inspector source (the autoEnhance.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');
const source = () => readFileSync(resolve(here, 'Inspector.tsx'), 'utf8');
const useEditorSource = () => readFileSync(resolve(here, '../hooks/useEditor.ts'), 'utf8');
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*{([^}]*)}`))?.[1] ?? '';
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

function renderInspector(
  tool: Tool,
  enhance?: { mode: EnhanceMode | null; pure?: boolean; canRevert?: boolean },
  taste?: { ready?: boolean; photos?: number; offered?: boolean },
  edit: EditState = { ...DEFAULT_EDIT },
): string {
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={edit}
      tool={tool}
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
      {...(taste?.offered === false ? {} : { onAutoTaste: noop })}
      {...(taste?.ready === undefined ? {} : { tasteReady: taste.ready })}
      {...(taste?.photos === undefined ? {} : { tastePhotos: taste.photos })}
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

describe('ml auto enhance menu item', () => {
  it('lists ML Auto Enhance in the adjust ... menu, after Auto Enhance', () => {
    // The ... menu renders only while open (never in SSR), so the item is
    // pinned from the source: adjust-only, offered-only, second in the
    // menu, firing onAutoTaste through the menu-closing handler.
    const inspector = source();
    expect(inspector).toContain("{tool === 'adjust' && onAutoTaste && (tasteReady");
    expect(inspector).toContain('<MenuItem onClick={() => closeAction(onAutoTaste)}>ML Auto Enhance</MenuItem>');
    expect(inspector.indexOf('ML Auto Enhance</MenuItem>')).toBeGreaterThan(inspector.indexOf('>Auto Enhance</MenuItem>'));
    expect(inspector.indexOf('ML Auto Enhance</MenuItem>')).toBeLessThan(inspector.indexOf('>Copy Adjustments</MenuItem>'));
  });

  it('disables the item until the profile is ready, with the reason on a tooltip wrapper', () => {
    // Disabled buttons swallow mouse events, so the hint cannot live on
    // the MenuItem itself — the wrapper span carries the data-tooltip.
    const inspector = source();
    expect(inspector).toContain('<span className="menu-disabled-tip" data-tooltip={tasteHint}><MenuItem disabled onClick={() => closeAction(onAutoTaste)}>ML Auto Enhance</MenuItem></span>');
    expect(inspector).toContain('ML Auto Enhance learns your taste as you edit — ${tastePhotos} of ${MIN_TASTE_PHOTOS} edited photos');
    expect(inspector).toContain('No consistent habit across your edits yet — ML Auto Enhance unlocks when one emerges');
    // The wrapper is a layout-neutral block: same box as the bare item.
    expect(cssRule('.menu-disabled-tip')).toMatch(/display\s*:\s*block/);
  });

  it('shows the shared revert icon for an applied taste enhance, without lighting the classic pill', () => {
    const html = renderInspector('adjust', { mode: 'taste', pure: true });
    expect(html).toContain('aria-label="Reset auto enhance"');
    expect(html).toContain('class="auto-small inspector-auto" data-testid="auto-enhance-auto" aria-pressed="false"');
    const reset = html.indexOf('aria-label="Reset auto enhance"');
    const auto = html.indexOf('data-testid="auto-enhance-auto"');
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(auto);
  });

  it('hides the taste revert when no snapshot exists', () => {
    const html = renderInspector('adjust', { mode: 'taste', pure: true, canRevert: false });
    expect(html).not.toContain('aria-label="Reset auto enhance"');
  });

  it('keeps taste enhance adjust-only: repair and crop headers carry no trace', () => {
    for (const tool of ['repair', 'crop'] as const) {
      const html = renderInspector(tool, { mode: 'taste', pure: true });
      expect(html).not.toContain('Reset auto enhance');
      expect(html).not.toContain('auto-enhance-auto');
    }
  });
});

describe('ml auto enhance editor wiring', () => {
  it('autoEnhanceTaste shares the enhance slot in taste mode', () => {
    // useEditor holds hooks (no renderer in this suite), so the method is
    // pinned from the hook source (the resetDehighlights.test.ts
    // precedent): taste slot entry, pure-taste toggle-back, in-flight
    // invalidation, and the guarded default-base apply.
    const editor = useEditorSource();
    expect(editor).toContain('const autoEnhanceTaste = useCallback((patch: Partial<EditState>) => {');
    expect(editor).toContain("pushEnhanceAction(stacksRef.current[photoId] ?? [], 'taste', history.present,");
    expect(editor).toContain("if (entry?.mode === 'taste' && entry.pure) {");
    expect(editor).toContain('enhanceRuns.current[photoId] = (enhanceRuns.current[photoId] ?? 0) + 1;');
    expect(editor).toContain("change({ ...DEFAULT_EDIT, ...geometry, ...patch, autoEnhanced: true, preset: 'ML Auto Enhance', sceneEnhance: null });");
    expect(editor).toContain('autoEnhanceTaste,');
  });

  it('the app feeds the learned patch and profile state to the inspector', () => {
    const app = appSource();
    expect(app).toContain('const applyTasteEnhance = () => { const patch = taste.patch; if (patch) editor.autoEnhanceTaste(patch); };');
    expect(app).toContain('onAutoTaste={applyTasteEnhance} tasteReady={taste.ready} tastePhotos={taste.summary.photos}');
  });
});
