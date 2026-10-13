import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo, Tool } from '@f8/core';
import { Inspector } from './Inspector.js';
import { Toolbar } from './Topbar.js';

// Auto Enhance lives in the Color Adjustments header: an Auto pill with an
// icon, right-aligned before the options menu — not a standalone section.
// The header ... menu lists the same action. Rendered on the server (no
// jsdom): effects never run, so this pins the markup + prop wiring, not
// click behavior. The closed ... menu is pinned from the Inspector source
// (the addAdjustmentLayout.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');
const source = () => readFileSync(resolve(here, 'Inspector.tsx'), 'utf8');

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

function renderToolbar(tool: Tool): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool={tool}
      compare={false}
      canUndo
      canRedo={false}
      showBacklink
      onTool={noop}
      onAction={noop}
      onDialog={noop}
    />,
  );
}

function renderInspector(tool: Tool, enhance?: { mode: 'classic' | 'scene' | null; pure?: boolean; canRevert?: boolean }, edit: EditState = { ...DEFAULT_EDIT }): string {
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

/** The header Auto button's markup, from its button open tag to its close tag. */
function autoButton(html: string): string {
  return html.match(/<button[^>]*data-testid="auto-enhance-auto"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
}

describe('auto enhance header button', () => {
  it('keeps the header toolbar to real tools: no Enhance tab', () => {
    for (const tool of ['adjust', 'repair', 'crop'] as const) {
      const html = renderToolbar(tool);
      expect(html).not.toContain('Enhance');
      expect(html).not.toContain('enhance-tool');
      expect(html).not.toContain('auto-enhance');
      expect(html.match(/class="tool-button/g)?.length).toBe(3);
    }
  });

  it('is an Auto pill with an icon in the Color Adjustments header, not a standalone section', () => {
    const html = renderInspector('adjust');
    // The standalone category is gone: no section heading, no description
    // note, no full-width bar anywhere.
    expect(html).not.toContain('<h3>Auto Enhance</h3>');
    expect(html).not.toContain('Automatically enhance exposure, contrast, and color.');
    expect(html).not.toContain('auto-enhance-apply');
    expect(html).not.toContain('classic-enhance');
    // One Auto pill, still the auto-small with the same testid and toggle
    // contract — now with an icon, in the panel header before the menu.
    expect(html).toContain('class="auto-small inspector-auto" data-testid="auto-enhance-auto" aria-pressed="false"');
    expect(html).toContain('title="Apply auto enhance automatically"');
    const button = autoButton(html);
    expect(button.length).toBeGreaterThan(0);
    expect(button).toContain('<svg');
    expect(button).toContain('>Auto</button>');
    expect(button.indexOf('<svg')).toBeLessThan(button.indexOf('>Auto</button>'));
    expect(source()).toContain('<Sparkles size={10} />Auto</button>');
    const title = html.indexOf('class="inspector-title"');
    const wrap = html.indexOf('class="inspector-auto-wrap"');
    const auto = html.indexOf('data-testid="auto-enhance-auto"');
    const menu = html.indexOf('class="inspector-menu-anchor"');
    expect(title).toBeGreaterThan(-1);
    expect(wrap).toBeGreaterThan(title);
    expect(auto).toBeGreaterThan(wrap);
    expect(menu).toBeGreaterThan(auto);
  });

  it('highlights the Auto button when applied, with the revert left of it', () => {
    const html = renderInspector('adjust', { mode: 'classic', pure: true });
    expect(html).toContain('class="auto-small inspector-auto is-active" data-testid="auto-enhance-auto" aria-pressed="true"');
    expect(html).toContain('title="Auto Enhance applied — click to revert"');
    expect(html).toContain('section-reset is-dirty" title="Reset auto enhance"');
    const reset = html.indexOf('aria-label="Reset auto enhance"');
    const auto = html.indexOf('data-testid="auto-enhance-auto"');
    expect(reset).toBeGreaterThan(-1);
    expect(auto).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(auto);
    // The revert rides in the same header group as the button.
    const wrap = html.slice(html.indexOf('class="inspector-auto-wrap"'), auto);
    expect(wrap).toContain('aria-label="Reset auto enhance"');
  });

  it('renders the reloaded Auto idle with no reset and an apply tooltip', () => {
    // Same reload state as the scene ML (see sceneEnhance.test.tsx): the
    // persisted auto flag stays in the recipe, but no session mode exists
    // — so the header Auto reopens idle (never enabled-without-a-reset)
    // with the plain apply tooltip, while the stored values keep their
    // per-section resets.
    const html = renderInspector(
      'adjust',
      undefined,
      { ...DEFAULT_EDIT, autoEnhanced: true, exposure: 0.22, clarity: 12 },
    );
    expect(html).toContain('class="auto-small inspector-auto" data-testid="auto-enhance-auto" aria-pressed="false"');
    expect(html).toContain('title="Apply auto enhance automatically"');
    expect(html).not.toContain('aria-label="Reset auto enhance"');
    expect(html).toContain('aria-label="Reset lightness"');
  });

  it('keeps the header Auto adjust-only: repair and crop headers carry no enhance action', () => {
    for (const tool of ['repair', 'crop'] as const) {
      const html = renderInspector(tool, { mode: 'classic', pure: true });
      expect(html).not.toContain('auto-enhance-auto');
      expect(html).not.toContain('inspector-auto-wrap');
      expect(html).not.toContain('aria-label="Reset auto enhance"');
    }
  });

  it('lists Auto Enhance under the header options menu', () => {
    // The ... menu renders only while open (never in SSR), so the item is
    // pinned from the source: adjust-only, first in the menu, firing the
    // same onAuto handler with the global A shortcut, closing on click.
    const inspector = source();
    const item = '{tool === \'adjust\' && <MenuItem onClick={() => closeAction(onAuto)} shortcut="A">Auto Enhance</MenuItem>}';
    expect(inspector).toContain(item);
    expect(inspector.indexOf(item)).toBeLessThan(inspector.indexOf('>Copy Adjustments</MenuItem>'));
    expect(inspector).toContain('const closeAction = (callback: () => void) => { callback(); setMenu(false); };');
  });

  it('right-aligns the header action group before the menu without splitting the free space', () => {
    // The wrap takes the auto margin that used to belong to the menu
    // anchor; the sibling override keeps the anchor's own auto margin from
    // centering the group (flex gap still separates group from menu).
    expect(cssRule('.inspector-auto-wrap')).toMatch(/margin-left\s*:\s*auto/);
    expect(cssRule('.inspector-auto-wrap')).toMatch(/display\s*:\s*flex/);
    expect(cssRule('.inspector-auto-wrap')).toMatch(/align-items\s*:\s*center/);
    expect(cssRule('.inspector-auto-wrap + .inspector-menu-anchor')).toMatch(/margin-left\s*:\s*0/);
    // The pill keeps the shared auto-small look; the icon rides inside via
    // inline-flex, centered with the label.
    expect(cssRule('.inspector-auto')).toMatch(/display\s*:\s*inline-flex/);
    expect(cssRule('.inspector-auto')).toMatch(/align-items\s*:\s*center/);
  });

  it('leaves no dead enhance-bar CSS behind', () => {
    expect(css()).not.toMatch(/\.classic-enhance/);
    expect(css()).not.toMatch(/\.enhance-tool/);
  });
});
