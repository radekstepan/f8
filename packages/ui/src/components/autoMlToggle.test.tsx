import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { DenoiseAssist, FaceEnhanceAssist, SelectiveMaskAssist } from './Inspector.js';

// The Auto/ML toggle contract, rendered on the server (no jsdom): one
// switch per Color Adjustments section — toggling on applies the
// suggested change, toggling off resets to defaults (no reset button
// survives in any section header), hand tweaks light the toggle on their
// own, and the model tools carry a little ML badge by the name. The
// suggestion-less Curves, Details, and Effects disable their switches
// while off. SSR pins the markup; the toggle branches pin at source
// level (effects never run, so clicks are not observable here).

const here = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(resolve(here, file), 'utf8');

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

function faceAssist(): FaceEnhanceAssist {
  return {
    state: 'idle', faces: 0, source: null, whiteBalance: null, skinAnchored: false,
    liftAmount: 0, redEyeCount: 0, progress: null, note: null, message: null, applied: null,
    onDetect: noop, onApply: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function selectiveAssist(): SelectiveMaskAssist {
  return {
    state: 'idle', found: false, coverage: 0, source: null, progress: null,
    note: null, message: null, applied: null,
    onDetect: noop, onAdjust: noop, onToggle: noop, onClear: noop, onDismiss: noop,
  };
}

function denoiseAssist(): DenoiseAssist {
  return {
    state: 'idle', preview: null, applied: null, hasBase: false, progress: null,
    note: null, message: null, onPreview: noop, onApply: noop, onClear: noop, onDismiss: noop,
  };
}

function renderAdjust(edit: EditState): string {
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
      onAutoScene={noop}
      faceAssist={faceAssist()}
      selectiveAssist={selectiveAssist()}
      denoiseAssist={denoiseAssist()}
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

/** Every header actions row in the markup (sections never nest). */
function actionsRows(html: string): string[] {
  return html.match(/<div class="section-actions">[\s\S]*?<\/div>/g) ?? [];
}

describe('auto/ml toggle contract', () => {
  it('gives every section exactly one switch and no reset', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    const rows = actionsRows(html);
    // Scene, faces, subject, denoise, white balance, lightness, color,
    // curves, details, effects.
    expect(rows).toHaveLength(10);
    const withSwitch = rows.filter((row) => row.includes('role="switch"'));
    expect(withSwitch).toHaveLength(10);
    for (const row of withSwitch) {
      expect(row.match(/role="switch"/g)).toHaveLength(1);
      expect(row).not.toContain('section-reset');
      expect(row).not.toContain('ml-button');
      expect(row).not.toContain('auto-small');
    }
    // The manual sections light their own switches on dirt — no resets.
    const dirty = renderAdjust({ ...DEFAULT_EDIT, curve: 25, clarity: 20, vignette: 40 });
    expect(dirty.match(/role="switch"/g)).toHaveLength(10);
    expect(dirty).toContain('class="toggle is-on" data-testid="curves-toggle"');
    expect(dirty).toContain('class="toggle is-on" data-testid="details-toggle"');
    expect(dirty).toContain('class="toggle is-on" data-testid="effects-toggle"');
    expect(dirty).not.toContain('section-reset');
    expect(dirty).not.toContain('aria-label="Reset curves"');
    expect(dirty).not.toContain('aria-label="Reset details"');
    expect(dirty).not.toContain('aria-label="Reset effects"');
  });

  it('badges exactly the model tools by name', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).toContain('<h3>Enhance Faces</h3><span class="ml-badge" data-tooltip="Face detection runs a machine-learning model">ML</span>');
    expect(html).toContain('<h3>Subject &amp; Background</h3><span class="ml-badge" data-tooltip="Subject segmentation runs a machine-learning model">ML</span>');
    expect(html.match(/class="ml-badge"/g)).toHaveLength(2);
  });

  it('lights the toggle for hand tweaks no auto could produce', () => {
    // Vibrance, hue, brightness, and blacks are never auto-computed, so a
    // lit toggle on those values proves manual tweaks turn the toggle on.
    const html = renderAdjust({ ...DEFAULT_EDIT, vibrance: 16, hue: -30, brightness: 10, blacks: 5 });
    expect(html).toContain('class="toggle is-on" data-testid="lightness-toggle"');
    expect(html).toContain('class="toggle is-on" data-testid="color-toggle"');
    expect(html).toContain('class="toggle" data-testid="white-balance-toggle"');
  });

  it('branches every section toggle to suggest-on versus reset-off', () => {
    // Static markup cannot observe the onToggle closures, so the contract
    // pins at the source (the collapsePanels.test.tsx precedent).
    const inspector = source('Inspector.tsx');
    expect(inspector).toContain("onToggle: whiteBalanceDirty ? onResetWhiteBalance : onAutoWhiteBalance");
    expect(inspector).toContain("onToggle: lightnessDirty ? onResetLightness : onAutoLightness");
    expect(inspector).toContain("onToggle: colorDirty ? onResetColor : onAutoColor");
    expect(inspector).toContain("onToggle: sceneRevert ? onRevertEnhance : onAutoScene");
    expect(inspector).toContain("onToggle: faceChanged ? faceAssist.onClear : faceAssist.onDetect");
    // Subject & Background is the one header switch that bypasses instead
    // of clearing: off keeps the mask and slider values (Clear removes).
    expect(inspector).toContain("onToggle: selectiveApplied ? selectiveAssist.onToggle : selectiveAssist.onDetect");
    expect(inspector).toContain("const selectiveOn = selectiveApplied != null && selectiveApplied.enabled !== false");
    expect(inspector).toContain("onToggle: () => { if (applied) assist.onClear(); else { setSlider(suggestion); setAuto(true); } }");
    // The manual sections reset straight to defaults (no auto to cancel,
    // so no editor-owned reset needed) and disable while clean.
    expect(inspector).toContain("checked: curvesDirty, onToggle: () => onChange({ curve: 0, curvePoints: [] }), disabled: !curvesDirty");
    expect(inspector).toContain("checked: detailsDirty, onToggle: () => onChange({ clarity: 0, sharpness: 0, grain: 0 }), disabled: !detailsDirty");
    expect(inspector).toContain("checked: effectsDirty, onToggle: () => onChange({ vignette: 0, fade: 0 }), disabled: !effectsDirty");
  });

  it('resets toggle-off sections to defaults while cancelling in-flight autos', () => {
    // The editor owns the toggle-off resets (rather than the Inspector
    // calling onChange directly) so a reset also bumps the category's run
    // token — an auto apply landing after the reset is dropped instead of
    // re-dirtying the section. The patches mirror the dirty checks above.
    const editor = readFileSync(resolve(here, '../hooks/useEditor.ts'), 'utf8');
    expect(editor).toContain('const resetCategory = useCallback((category: MlCategory) => {');
    expect(editor).toContain('mlRuns.current[key] = (mlRuns.current[key] ?? 0) + 1;\n    const patch = category');
    expect(editor).toContain('{ temperature: 5500, tint: 0 }');
    expect(editor).toContain('{ exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, blacks: 0 }');
    expect(editor).toContain('{ hue: 0, saturation: 0, vibrance: 0 }');
    // No per-category stack entries survive: applies push nothing and
    // toggle-off restores nothing — the recipe dirtiness is the state.
    expect(editor).not.toContain('revertCategoryMl');
    expect(editor).not.toContain('toggleCategoryMl');
    expect(editor).not.toContain('mlApplied');
    expect(editor).not.toContain('mlRevert');
    expect(editor).not.toContain('snapshotMlCategory');
  });
});
