import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT, PRESETS } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import { MenuBar } from './Topbar.js';

// Presets submenu: the "Add Adjustment" footer button is gone (its Save
// as Preset entry lives on in the header ... menu and in the new
// submenu), Black & White always renders as a plain section, and the
// Image menu lists every preset in a zoom-style flyout grouped by
// category. Presets carry basic adjustments only: saving, copying, and
// applying all leave geometry, heal strokes, and denoise behind.
// Rendered on the server (no jsdom): markup pins plus source pins for
// the dropdown-only wiring (the topbarMenus.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');
const source = (name: string) => readFileSync(resolve(here, name), 'utf8');
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');
const hookSource = () => readFileSync(resolve(here, '../hooks/useEditor.ts'), 'utf8');

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

function renderInspector(): string {
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
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

function renderMenuBar(): string {
  return renderToStaticMarkup(
    <MenuBar
      onAction={noop}
      canUndo
      canRedo={false}
      canPaste
      sidebar
      inspector
      presets={false}
      filmstrip
      presetList={PRESETS}
      selectedPreset="Vivid"
      onSelectPreset={noop}
    />,
  );
}

describe('add adjustment removal', () => {
  it('renders no Add Adjustment button or footer in the inspector', () => {
    const html = renderInspector();
    expect(html).not.toContain('Add Adjustment');
    expect(html).not.toContain('inspector-footer');
    expect(html).not.toContain('add-adjustment');
    const inspector = source('Inspector.tsx');
    expect(inspector).not.toContain('Add Adjustment');
    expect(inspector).not.toContain('add-adjustment');
    expect(inspector).not.toContain('extraSections');
    expect(inspector).not.toContain('addMenu');
    expect(css()).not.toContain('.add-adjustment');
    expect(css()).not.toContain('.inspector-footer');
  });

  it('always renders Black & White as a plain section', () => {
    // No gate: the section is unconditional markup after Effects.
    expect(renderInspector()).toContain('Black &amp; White');
    const inspector = source('Inspector.tsx');
    const start = inspector.indexOf('title="Black & White"');
    expect(start).toBeGreaterThan(-1);
    expect(inspector.slice(Math.max(0, start - 60), start)).not.toContain('extraSections');
    expect(inspector.slice(Math.max(0, start - 60), start)).not.toContain('&&');
  });

  it('keeps Save as Preset in the header options menu', () => {
    expect(source('Inspector.tsx')).toContain('<MenuItem onClick={() => closeAction(onSavePreset)}>Save as Preset...</MenuItem>');
  });
});

describe('presets flyout in the Image menu', () => {
  it('sits with the other looks, after Enhance Faces and before Rotate', () => {
    const line = source('Topbar.tsx').split('\n').find((entry) => entry.trimStart().startsWith('Image:')) ?? '';
    expect(line).toContain('{presetsSubmenu}');
    const submenuAt = line.indexOf('{presetsSubmenu}');
    expect(submenuAt).toBeGreaterThan(line.indexOf("'enhance-faces'"));
    expect(submenuAt).toBeLessThan(line.indexOf("'rotate'"));
  });

  it('opens from a checked-while-non-Original parent like the zoom submenu', () => {
    const topbar = source('Topbar.tsx');
    const parent = topbar.split('\n').find((line) => line.includes('has-submenu') && line.includes('>Presets<')) ?? '';
    expect(parent).toContain('aria-haspopup="menu"');
    expect(parent).toContain('data-submenu="presets"');
    expect(parent).toContain('<span className="menu-check">{selectedPreset !== \'Original\' && <Check size={13} />}</span><span>Presets</span>');
    expect(parent).toContain('<ChevronRight size={13} className="menu-chevron" />');
    expect(parent).toContain('onClick={() => setSubmenu(submenu === \'presets\' ? null : \'presets\')}');
    expect(topbar).toContain('onMouseEnter={() => setSubmenu(\'presets\')}');
  });

  it('groups the flyout by the strip categories with the active preset checked', () => {
    const topbar = source('Topbar.tsx');
    expect(topbar).toContain('const PRESET_SUBMENU_CATEGORIES = [\'Essentials\', \'Cinematic\', \'Black & White\', \'My Presets\']');
    expect(topbar).toContain('{submenu === \'presets\' && <div className="dropdown-menu dropdown-submenu presets-submenu" role="menu">');
    expect(topbar).toContain('checked={selectedPreset === preset.name}');
    expect(topbar).toContain('onClick={() => selectPreset(preset)}');
    expect(topbar).toContain('const selectPreset = (preset: Preset) => { onSelectPreset?.(preset); openMenu(null); };');
  });

  it('ends the flyout with Save as Preset in its own section', () => {
    const topbar = source('Topbar.tsx');
    expect(topbar).toContain('<MenuSeparator /><MenuItem onClick={() => action(\'save-preset\')}>Save as Preset...</MenuItem>');
    expect(topbar).toContain("'save-preset'");
  });

  it('adds no top-level menu', () => {
    const labels = Array.from(renderMenuBar().matchAll(/class="menu-trigger[^"]*"[^>]*>([^<]+)</g)).map((match) => match[1] ?? '');
    expect(labels).toEqual(['File', 'Edit', 'Image', 'View', 'Help']);
  });

  it('shares the ArrowRight/ArrowLeft flyout handling with the zoom submenu', () => {
    const topbar = source('Topbar.tsx');
    expect(topbar).toContain('const target = (focused as HTMLElement).dataset.submenu;');
    expect(topbar).toContain('`[data-submenu="${submenu}"]`');
  });

  it('caps the flyout height and scrolls instead of running off the viewport', () => {
    const rule = cssRule('.dropdown-menu.presets-submenu');
    expect(rule).toMatch(/max-height:\s*min\(60vh, 420px\)/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });
});

describe('presets submenu app wiring', () => {
  it('opens the preset dialog from the save-preset action', () => {
    expect(appSource()).toContain('case \'save-preset\': setDialog(\'preset\'); break;');
  });

  it('feeds the menu bar the preset list, selection, and picker', () => {
    const block = appSource().slice(appSource().indexOf('<MenuBar'));
    expect(block).toContain('presetList={availablePresets}');
    expect(block).toContain('selectedPreset={editor.edit.preset}');
    expect(block).toContain('onSelectPreset={selectPreset}');
  });

  it('shares one picker between the strip and the submenu, with toggle-off and editor landing', () => {
    const app = appSource();
    // Re-picking the active preset reverts to Original (the strip's
    // toggle-off); a menu pick from the library lands in the editor.
    expect(app).toContain('const selectPreset = (preset: Preset) => {');
    expect(app).toContain('if (editor.edit.preset === preset.name && preset.id !== \'original\' && preset.name !== \'Original\') {');
    expect(app).toContain('setView(\'editor\');');
    expect(app).toContain('onSelect={selectPreset}');
  });

  it('saves and copies basic adjustments only', () => {
    const app = appSource();
    expect(app).toContain('void library.createPreset(name, presetValuesForEdit(editor.edit))');
    expect(app).toContain('setClipboard(presetValuesForEdit(editor.edit))');
    expect(app).toContain('presetValuesForEdit');
  });
});

describe('presets never carry denoise or heal', () => {
  it('applies keep the target photo denoise, ignoring any stored in the preset', () => {
    const hook = hookSource();
    expect(hook).toContain('const { rotation, flipH, flipV, straighten, cropRatio, retouches, denoise } = history.present;');
    expect(hook).toContain('change({ ...DEFAULT_EDIT, ...preset.values, rotation, flipH, flipV, straighten, cropRatio, retouches, denoise, preset: preset.name });');
  });

  it('tells savers that denoise stays out of the preset', () => {
    expect(source('EditorDialogs.tsx')).toContain('Crops, retouching, and denoise are not included.');
  });
});
