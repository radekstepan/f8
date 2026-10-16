import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo, Preset } from '@f8/core';
import { Inspector } from './Inspector.js';

// Saved Presets submenu: user-saved adjustment presets are discoverable
// from the inspector header ... menu — a Saved Presets parent with a
// flyout listing them (active one checked), applying on pick. Rendered
// on the server (no jsdom): open-menu markup via the initialMenuOpen /
// initialSubmenu seams, plus source pins for the hover/click-only wiring
// (the presetsSubmenu.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');
const source = (name: string) => readFileSync(resolve(here, name), 'utf8');
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');

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

function makePreset(id: string, name: string): Preset {
  return { id, name, category: 'My Presets', values: {} };
}

function renderInspector(options: { savedPresets?: Preset[]; selectedPreset?: string; menuOpen?: boolean; submenu?: 'saved-presets' | null } = {}): string {
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
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onResetWhiteBalance={noop}
      onResetLightness={noop}
      onResetColor={noop}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      savedPresets={options.savedPresets}
      selectedPreset={options.selectedPreset}
      onSelectPreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
      initialMenuOpen={options.menuOpen}
      initialSubmenu={options.submenu ?? null}
    />,
  );
}

/** The opening button tag (with all its attributes) for a menu item label. */
function buttonFor(html: string, name: string): string {
  const at = html.indexOf(`>${name}</span>`);
  return html.slice(html.lastIndexOf('<button', at), at);
}

describe('saved presets parent in the ... menu', () => {
  it('shows a Saved Presets parent with a left arrow once the menu opens', () => {
    const html = renderInspector({ menuOpen: true, savedPresets: [makePreset('c1', 'My Look')] });
    expect(html).toContain('data-submenu="saved-presets"');
    expect(html).toContain('<span>Saved Presets</span>');
    expect(html).toContain('class="menu-item has-submenu"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('menu-chevron');
    // The flyout opens left of the menu, so the arrow points left and
    // leads the row — never a right chevron, trailing or otherwise.
    // (Scoped to the parent button: collapsed sections below disclose
    // with their own right chevrons.)
    const rowStart = html.indexOf('data-submenu="saved-presets"');
    const row = html.slice(rowStart, html.indexOf('</button>', rowStart));
    expect(row).toContain('lucide-chevron-left');
    expect(row).not.toContain('lucide-chevron-right');
    expect(row.indexOf('menu-chevron')).toBeLessThan(row.indexOf('<span>Saved Presets</span>'));
    const parent = source('Inspector.tsx').split('\n').find((line) => line.includes('data-submenu="saved-presets"')) ?? '';
    expect(parent).toContain('<ChevronLeft size={13} className="menu-chevron" />');
    // Nothing trails the label: the row stays left-aligned like its siblings.
    expect(parent).toContain('<span>Saved Presets</span></button>');
    // Closed by default: the parent renders, the flyout does not.
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('saved-presets-submenu');
  });

  it('sits next to Save as Preset without replacing it', () => {
    const html = renderInspector({ menuOpen: true });
    expect(html).toContain('>Save as Preset...</span>');
    expect(html.indexOf('<span>Saved Presets</span>')).toBeLessThan(html.indexOf('>Save as Preset...</span>'));
    expect(source('Inspector.tsx')).toContain('<MenuItem onClick={() => closeAction(onSavePreset)}>Save as Preset...</MenuItem>');
  });

  it('swaps the left arrow for a check only while a saved preset is the active look', () => {
    const saved = [makePreset('c1', 'My Look'), makePreset('c2', 'Grapes Mood')];
    // The leading slot carries exactly one icon: the submenu arrow by
    // default, a check while a saved preset is the active look.
    const slot = (html: string) => {
      const start = html.indexOf('data-submenu="saved-presets"');
      return html.slice(start, html.indexOf('<span>Saved Presets</span>', start));
    };
    const active = slot(renderInspector({ menuOpen: true, savedPresets: saved, selectedPreset: 'My Look' }));
    expect(active).toContain('lucide-check');
    expect(active).not.toContain('menu-chevron');
    for (const selectedPreset of ['Original', 'Vivid']) {
      const idle = slot(renderInspector({ menuOpen: true, savedPresets: saved, selectedPreset }));
      expect(idle).toContain('lucide-chevron-left');
      expect(idle).not.toContain('lucide-check');
    }
  });

  it('opens on hover and toggles on click like the Image > Presets parent', () => {
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain('onMouseEnter={() => setSubmenu(\'saved-presets\')}');
    expect(inspector).toContain('onMouseLeave={() => setSubmenu(null)}');
    expect(inspector).toContain('onClick={() => setSubmenu(submenu === \'saved-presets\' ? null : \'saved-presets\')}');
    expect(inspector).toContain('aria-expanded={submenu === \'saved-presets\'}');
  });
});

describe('saved presets flyout', () => {
  it('lists every saved preset with the active one checked', () => {
    const html = renderInspector({ menuOpen: true, submenu: 'saved-presets', savedPresets: [makePreset('c1', 'My Look'), makePreset('c2', 'Grapes Mood')], selectedPreset: 'Grapes Mood' });
    expect(html).toContain('class="dropdown-menu dropdown-submenu saved-presets-submenu"');
    expect(html).toContain('aria-label="Saved presets"');
    expect(html).toContain('>My Look</span>');
    expect(html).toContain('>Grapes Mood</span>');
    expect(html).toContain('role="menuitemcheckbox"');
    expect(buttonFor(html, 'Grapes Mood')).toContain('aria-checked="true"');
    expect(buttonFor(html, 'My Look')).toContain('aria-checked="false"');
  });

  it('explains the empty state instead of rendering an empty flyout', () => {
    const html = renderInspector({ menuOpen: true, submenu: 'saved-presets', savedPresets: [] });
    expect(html).toContain('>No saved presets yet</span>');
    expect(buttonFor(html, 'No saved presets yet')).toContain('disabled');
    const empty = renderInspector({ menuOpen: true, submenu: 'saved-presets' });
    expect(empty).toContain('>No saved presets yet</span>');
  });

  it('applies the pick and dismisses the whole menu', () => {
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain('onClick={() => selectSavedPreset(preset)}');
    expect(inspector).toContain('checked={selectedPreset === preset.name}');
    expect(inspector).toContain('const selectSavedPreset = (preset: Preset) => { onSelectPreset?.(preset); closeMenu(); };');
    expect(inspector).toContain('const closeMenu = () => { setMenu(false); setSubmenu(null); };');
  });

  it('never reopens stale: toggling and outside-dismiss both reset the flyout', () => {
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain('onClick={() => { setMenu(!menu); setSubmenu(null); }}');
    expect(inspector).toContain('useMenuDismiss(menuRef, closeMenu);');
  });

  it('opens left of the parent and scrolls long lists', () => {
    // The inspector docks at the right edge: the generic submenu rule
    // opens right (off the viewport), so the override anchors left.
    const anchor = cssRule('.inspector-options .dropdown-submenu');
    expect(anchor).toMatch(/left:\s*auto/);
    expect(anchor).toMatch(/right:\s*calc\(100% - 2px\)/);
    const flyout = cssRule('.dropdown-menu.saved-presets-submenu');
    expect(flyout).toMatch(/max-height:\s*min\(60vh, 320px\)/);
    expect(flyout).toMatch(/overflow-y:\s*auto/);
    expect(flyout).toMatch(/min-width:\s*190px/);
  });
});

describe('saved presets app wiring', () => {
  it('feeds the inspector the user-saved presets, the selection, and the shared picker', () => {
    const block = appSource().slice(appSource().indexOf('<Inspector'));
    expect(block).toContain('savedPresets={customPresets}');
    expect(block).toContain('selectedPreset={editor.edit.preset}');
    expect(block).toContain('onSelectPreset={selectPreset}');
  });

  it('reuses the strip toggle-off picker, so a flyout pick behaves like a strip pick', () => {
    // selectPreset (shared by the strip and the Image > Presets flyout,
    // pinned in presetsSubmenu.test.tsx) also serves the ... menu: no
    // second picker, no divergent apply path.
    expect(appSource()).toContain('onSelectPreset={selectPreset}');
  });
});
