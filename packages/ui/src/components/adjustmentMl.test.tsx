import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, MlCategory, Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';

// Per-category Auto buttons, rendered on the server (no jsdom): effects never
// run, so this pins the markup + prop wiring — Auto button per auto-capable
// category (the slider autos are histogram heuristics, not models, so the ML
// label would lie), one reset per header (persistent iff non-default,
// restoring the pre-auto snapshot while one lives), the chevron alone
// collapsing every header — not click behavior.

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

function renderAdjust(edit: EditState, mlApplied?: Partial<Record<MlCategory, boolean>>, mlRevert?: Partial<Record<MlCategory, boolean>>): string {
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
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onRevertWhiteBalance={noop}
      onRevertLightness={noop}
      onRevertColor={noop}
      {...(mlApplied ? { mlApplied } : {})}
      {...(mlRevert ? { mlRevert } : {})}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

describe('adjustment auto buttons', () => {
  it('renders an Auto button on each auto-capable category, never an ML button', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    // The slider autos are histogram heuristics (no model runs), so they
    // carry the Auto pill like classic enhance — ML buttons are reserved
    // for sections where a model actually runs.
    for (const [id, title] of [
      ['white-balance', 'white balance'],
      ['lightness', 'lightness'],
      ['color', 'hue &amp; saturation'],
    ] as const) {
      expect(html).toContain(`data-testid="${id}-auto"`);
      expect(html).toContain(`title="Apply ${title} automatically"`);
      expect(html).not.toContain(`data-testid="${id}-ml"`);
    }
    expect(html).toContain('aria-pressed="false"');
    // Four Auto pills in the assist-free adjust tool: the header Auto plus
    // the three slider categories. Straighten's pill lives in crop, and no
    // ML button renders at all.
    expect(html).not.toContain('>ML</button>');
    expect(html).not.toContain('ml-button');
    expect(html.match(/auto-small/g)).toHaveLength(4);
    expect(html).toContain('class="auto-small inspector-auto" data-testid="auto-enhance-auto"');
    expect(html.match(/>Auto<\/button>/g)).toHaveLength(4);
    // No snapshot and default values: no reset renders at all.
    expect(html).not.toContain('-ml-revert');
    expect(html).not.toContain('section-reset');
    expect(html).not.toContain('aria-label="Reset white balance"');
  });

  it('shows a persistent reset next to the applied Auto button only', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { whiteBalance: true }, { whiteBalance: true });
    expect(html).toContain('class="auto-small is-active" data-testid="white-balance-auto"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="White Balance applied — click to revert"');
    // One reset control, persistent while the snapshot lives, left of the
    // Auto button. The separate revert icon is gone: reset restores the
    // pre-auto values while a snapshot exists.
    expect(html).toContain('section-reset is-dirty" title="Reset white balance"');
    expect(html).not.toContain('-ml-revert');
    const auto = html.indexOf('data-testid="white-balance-auto"');
    const reset = html.indexOf('aria-label="Reset white balance"');
    expect(auto).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(auto);
    // The other categories stay idle, with no reset at all.
    expect(html).toContain('class="auto-small" data-testid="lightness-auto"');
    expect(html).toContain('class="auto-small" data-testid="color-auto"');
    expect(html).not.toContain('aria-label="Reset lightness"');
    expect(html).not.toContain('aria-label="Reset hue &amp; saturation"');
  });

  it('keeps the reset persistent after manual edits cleared the highlight', () => {
    // A slider drag after the auto apply drops the pure-auto highlight but
    // leaves the pre-auto snapshot: idle button, re-apply title, persistent
    // reset still beside it.
    const html = renderAdjust({ ...DEFAULT_EDIT }, {}, { whiteBalance: true });
    expect(html).toContain('class="auto-small" data-testid="white-balance-auto"');
    expect(html).toContain('title="Re-apply white balance"');
    expect(html).toContain('section-reset is-dirty" title="Reset white balance"');
    expect(html).not.toContain('aria-label="Reset lightness"');
  });

  it('tracks applied state per category', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { lightness: true, color: true }, { lightness: true, color: true });
    expect(html).toContain('class="auto-small is-active" data-testid="lightness-auto"');
    expect(html).toContain('class="auto-small is-active" data-testid="color-auto"');
    expect(html).toContain('section-reset is-dirty" title="Reset lightness"');
    expect(html).toContain('section-reset is-dirty" title="Reset hue &amp; saturation"');
    expect(html).toContain('class="auto-small" data-testid="white-balance-auto"');
    expect(html).not.toContain('aria-label="Reset white balance"');
  });

  it('offers one reset control per header: persistent while non-default, absent at defaults', () => {
    // A pre-auto snapshot keeps the reset persistent even at default slider values.
    const applied = renderAdjust({ ...DEFAULT_EDIT }, { lightness: true }, { lightness: true });
    expect(applied).toContain('section-reset is-dirty" title="Reset lightness"');
    expect(applied).not.toContain('-ml-revert');
    // No snapshot, default values: no reset control at all.
    const idle = renderAdjust({ ...DEFAULT_EDIT });
    expect(idle).not.toContain('aria-label="Reset lightness"');
    // The touched-but-unhighlighted state stays persistent (snapshot kept).
    const touched = renderAdjust({ ...DEFAULT_EDIT }, {}, { lightness: true });
    expect(touched).toContain('section-reset is-dirty" title="Reset lightness"');
    // Dirty sliders persist the reset with no snapshot at all.
    const dirty = renderAdjust({ ...DEFAULT_EDIT, exposure: 0.5 });
    expect(dirty).toContain('section-reset is-dirty" title="Reset lightness"');
    expect(dirty).not.toContain('aria-label="Reset white balance"');
  });

  it('keeps the Auto button rightmost with the reset control left of it', () => {
    // Every category dirty, so every header carries its reset.
    const html = renderAdjust({ ...DEFAULT_EDIT, temperature: 5800, exposure: 0.5, saturation: 8 });
    for (const id of ['white-balance', 'lightness', 'color'] as const) {
      const auto = html.indexOf(`data-testid="${id}-auto"`);
      expect(auto).toBeGreaterThan(-1);
      const section = html.slice(Math.max(0, auto - 800), auto);
      // The single reset icon precedes the Auto button in its row.
      const actions = section.slice(section.lastIndexOf('section-actions'));
      expect(actions).toContain('section-reset');
      expect(actions).not.toContain('ml-revert');
      // The Auto button closes the row: button end tag, then the row end tag.
      const after = html.slice(auto, auto + 400);
      expect(after).toMatch(new RegExp(`data-testid="${id}-auto"[^>]*>Auto</button></div>`));
    }
    // At defaults no header carries a reset, so the Auto button stands alone.
    const idle = renderAdjust({ ...DEFAULT_EDIT });
    expect(idle).not.toContain('section-reset');
    for (const id of ['white-balance', 'lightness', 'color'] as const) {
      const auto = idle.indexOf(`data-testid="${id}-auto"`);
      expect(auto).toBeGreaterThan(-1);
      const after = idle.slice(auto, auto + 400);
      expect(after).toMatch(new RegExp(`data-testid="${id}-auto"[^>]*>Auto</button></div>`));
    }
  });

  it('distinguishes Auto on from off via highlight plus pressed state', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { whiteBalance: true }, { whiteBalance: true });
    expect(html).toContain('class="auto-small is-active" data-testid="white-balance-auto" aria-pressed="true"');
    expect(html).toContain('class="auto-small" data-testid="lightness-auto" aria-pressed="false"');
    expect(html).toContain('class="auto-small" data-testid="color-auto" aria-pressed="false"');
  });

  it('gives no header action to sections without an automatic action', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { whiteBalance: true, lightness: true, color: true }, { whiteBalance: true, lightness: true, color: true });
    expect(html).not.toContain('data-testid="curves-ml"');
    expect(html).not.toContain('data-testid="details-ml"');
    expect(html).not.toContain('data-testid="effects-ml"');
    expect(html).not.toContain('data-testid="curves-auto"');
    expect(html).not.toContain('data-testid="details-auto"');
    expect(html).not.toContain('data-testid="effects-auto"');
  });
});

describe('adjustment header controls', () => {
  it('carries no toggle beside the Auto button — the Auto button is the one control', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    // The chevron alone collapses auto sections; no toggle sits next to the
    // Auto button, neither as visibility nor as effect bypass.
    expect(html).not.toContain('aria-label="Show white balance"');
    expect(html).not.toContain('aria-label="Show lightness"');
    expect(html).not.toContain('aria-label="Show hue &amp; saturation"');
    expect(html).not.toContain('Enable white balance');
    expect(html).not.toContain('Enable lightness');
    expect(html).not.toContain('Enable hue');
    // Details has no automatic action and no toggle either — the chevron
    // alone collapses it, like every other control (Task 11).
    expect(html).not.toContain('aria-label="Show details"');
  });

  it('starts Details collapsed behind its disclosure, with no toggle', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    // Details starts collapsed, as before the toggle removal.
    expect(html).not.toContain('aria-label="Show details"');
    expect(html).not.toContain('>Clarity</label>');
    const heading = html.indexOf('<h3>Details</h3>');
    const details = html.slice(html.lastIndexOf('<section', heading), html.indexOf('<h3>Effects</h3>'));
    expect(details).not.toContain('role="switch"');
    expect(details).toContain('aria-expanded="false"');
  });

  it('keeps sliders enabled so a legacy-disabled category recovers on first drag', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, whiteBalanceEnabled: false });
    const numberInput = html.match(/<input[^>]*aria-label="Temperature value"[^>]*>/);
    expect(numberInput).not.toBeNull();
    expect(numberInput?.[0]).not.toMatch(/disabled/);
    const slider = html.match(/<input[^>]*title="Double-click to reset temperature"[^>]*>/);
    expect(slider).not.toBeNull();
    expect(slider?.[0]).not.toMatch(/disabled/);
  });
});

describe('AdjustmentSection', () => {
  const section = (props: Partial<React.ComponentProps<typeof AdjustmentSection>>) =>
    renderToStaticMarkup(
      <AdjustmentSection title="White Balance" icon={<i />} {...props}>
        <span>slider-stub</span>
      </AdjustmentSection>,
    );

  it('hides content but keeps the header action behind controlled visibility', () => {
    const html = section({ open: false, ml: { id: 'white-balance', applied: true, canRevert: true, onToggle: noop, onRevert: noop } });
    expect(html).toContain('is-collapsed');
    expect(html).not.toContain('slider-stub');
    // Collapsing hides the sliders, never the header controls: the action
    // stays rendered (and one click away), like the reset.
    expect(html).toContain('data-testid="white-balance-ml"');
  });

  it('renders content and ML when controlled open', () => {
    const html = section({ open: true, ml: { id: 'white-balance', applied: false, canRevert: false, onToggle: noop, onRevert: noop } });
    expect(html).not.toContain('is-collapsed');
    expect(html).toContain('slider-stub');
    expect(html).toContain('data-testid="white-balance-ml"');
    expect(html).not.toContain('section-reset');
  });

  it('keeps the reset persistent while a snapshot exists, highlight or not', () => {
    const html = section({ open: true, onReset: noop, ml: { id: 'white-balance', applied: false, canRevert: true, onToggle: noop, onRevert: noop } });
    expect(html).toContain('class="ml-button" data-testid="white-balance-ml"');
    expect(html).toContain('title="Re-apply automatic white balance with ML"');
    expect(html).toContain('section-reset is-dirty" title="Reset white balance"');
    expect(html).not.toContain('-ml-revert');
  });

  it('stays self-managed without controlled visibility', () => {
    const html = section({});
    expect(html).not.toContain('is-collapsed');
    expect(html).toContain('slider-stub');
  });

  it('disables the header action and honors a custom tooltip when given', () => {
    // The shared header action carries the disabled state and a
    // section-specific tooltip instead of the computed one (the contract
    // One-Click Removal and Denoise both use).
    const html = section({ ml: { id: 'denoise', applied: false, canRevert: false, onToggle: noop, onRevert: noop, disabled: true, title: 'ISO 100 needs no denoise' } });
    expect(html).toContain('data-testid="denoise-ml"');
    const tag = html.match(/<button[^>]*data-testid="denoise-ml"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('disabled');
    expect(html).toContain('title="ISO 100 needs no denoise"');
    expect(html).not.toContain('Automatically adjust');
  });

  it('omits the disabled attribute and computes the tooltip by default', () => {
    const html = section({ ml: { id: 'white-balance', applied: false, canRevert: false, onToggle: noop, onRevert: noop } });
    const tag = html.match(/<button[^>]*data-testid="white-balance-ml"[^>]*>/)?.[0] ?? '';
    expect(tag).not.toContain('disabled');
    expect(html).toContain('title="Automatically adjust white balance with ML"');
  });

  it('offers no header toggle — on/off lives in the content, not the header', () => {
    // The header toggle retired with Black & White's: every section drives
    // its effect from content controls, the header carries at most the
    // reset + the action. Pinned at source level — the props no longer
    // exist to render.
    const shared = source('AdjustmentSection.tsx');
    expect(shared).toContain("import { IconButton } from './EditorUI.js'");
    expect(shared).not.toContain('<Toggle');
    expect(shared).not.toContain('toggleLabel');
    expect(shared).not.toContain('onToggle?:');
    // ...while the header action's own toggle contract is untouched: the
    // required onToggle still drives the ML/Auto button.
    expect(shared).toContain('onToggle: () => void;');
    const html = section({ open: true });
    expect(html).not.toContain('role="switch"');
  });
});
