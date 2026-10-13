import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, MlCategory, Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';

// Per-category ML buttons + visibility toggles, rendered on the server (no
// jsdom): effects never run, so this pins the markup + prop wiring — ML
// button per auto-capable category, one reset per header (persistent iff
// non-default, restoring the pre-ML snapshot while one lives), toggles
// showing/hiding their category — not click behavior.

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

describe('adjustment ML buttons', () => {
  it('renders an ML button on each auto-capable category instead of Auto pills', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    for (const [id, title] of [
      ['white-balance', 'white balance'],
      ['lightness', 'lightness'],
      ['color', 'hue &amp; saturation'],
    ] as const) {
      expect(html).toContain(`data-testid="${id}-ml"`);
      expect(html).toContain(`title="Automatically adjust ${title} with ML"`);
    }
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('>ML</button>');
    // The one Auto pill in the adjust tool is classic enhance (a non-ML
    // heuristic with a header Auto button); the slider categories use ML,
    // and straighten's pill lives in crop.
    expect(html.match(/auto-small/g)).toHaveLength(1);
    expect(html).toContain('class="auto-small" data-testid="auto-enhance-auto"');
    expect(html.match(/>Auto<\/button>/g)).toHaveLength(1);
    // No snapshot and default values: no reset renders at all.
    expect(html).not.toContain('-ml-revert');
    expect(html).not.toContain('section-reset');
    expect(html).not.toContain('aria-label="Reset white balance"');
  });

  it('shows a persistent reset next to the applied ML button only', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { whiteBalance: true }, { whiteBalance: true });
    expect(html).toContain('class="ml-button is-active" data-testid="white-balance-ml"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="ML white balance applied — click to revert"');
    // One reset control, persistent while the snapshot lives, left of the
    // ML button. The separate revert icon is gone: reset restores the
    // pre-ML values while a snapshot exists.
    expect(html).toContain('section-reset is-dirty" title="Reset white balance"');
    expect(html).not.toContain('-ml-revert');
    const ml = html.indexOf('data-testid="white-balance-ml"');
    const reset = html.indexOf('aria-label="Reset white balance"');
    expect(ml).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(ml);
    // The other categories stay idle, with no reset at all.
    expect(html).toContain('class="ml-button" data-testid="lightness-ml"');
    expect(html).toContain('class="ml-button" data-testid="color-ml"');
    expect(html).not.toContain('aria-label="Reset lightness"');
    expect(html).not.toContain('aria-label="Reset hue &amp; saturation"');
  });

  it('keeps the reset persistent after manual edits cleared the highlight', () => {
    // A slider drag after the ML apply drops the pure-auto highlight but
    // leaves the pre-ML snapshot: idle button, re-apply title, persistent
    // reset still beside it.
    const html = renderAdjust({ ...DEFAULT_EDIT }, {}, { whiteBalance: true });
    expect(html).toContain('class="ml-button" data-testid="white-balance-ml"');
    expect(html).toContain('title="Re-apply automatic white balance with ML"');
    expect(html).toContain('section-reset is-dirty" title="Reset white balance"');
    expect(html).not.toContain('aria-label="Reset lightness"');
  });

  it('tracks applied state per category', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { lightness: true, color: true }, { lightness: true, color: true });
    expect(html).toContain('class="ml-button is-active" data-testid="lightness-ml"');
    expect(html).toContain('class="ml-button is-active" data-testid="color-ml"');
    expect(html).toContain('section-reset is-dirty" title="Reset lightness"');
    expect(html).toContain('section-reset is-dirty" title="Reset hue &amp; saturation"');
    expect(html).toContain('class="ml-button" data-testid="white-balance-ml"');
    expect(html).not.toContain('aria-label="Reset white balance"');
  });

  it('offers one reset control per header: persistent while non-default, absent at defaults', () => {
    // A pre-ML snapshot keeps the reset persistent even at default slider values.
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

  it('keeps the ML button rightmost with the reset control left of it', () => {
    // Every category dirty, so every header carries its reset.
    const html = renderAdjust({ ...DEFAULT_EDIT, temperature: 5800, exposure: 0.5, saturation: 8 });
    for (const id of ['white-balance', 'lightness', 'color'] as const) {
      const ml = html.indexOf(`data-testid="${id}-ml"`);
      expect(ml).toBeGreaterThan(-1);
      const section = html.slice(Math.max(0, ml - 800), ml);
      // The single reset icon precedes the ML button in its row.
      const actions = section.slice(section.lastIndexOf('section-actions'));
      expect(actions).toContain('section-reset');
      expect(actions).not.toContain('ml-revert');
      // The ML button closes the row: button end tag, then the row end tag.
      const after = html.slice(ml, ml + 400);
      expect(after).toMatch(new RegExp(`data-testid="${id}-ml"[^>]*>ML</button></div>`));
    }
    // At defaults no header carries a reset, so the ML button stands alone.
    const idle = renderAdjust({ ...DEFAULT_EDIT });
    expect(idle).not.toContain('section-reset');
    for (const id of ['white-balance', 'lightness', 'color'] as const) {
      const ml = idle.indexOf(`data-testid="${id}-ml"`);
      expect(ml).toBeGreaterThan(-1);
      const after = idle.slice(ml, ml + 400);
      expect(after).toMatch(new RegExp(`data-testid="${id}-ml"[^>]*>ML</button></div>`));
    }
  });

  it('distinguishes ML on from off via highlight plus pressed state', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { whiteBalance: true }, { whiteBalance: true });
    expect(html).toContain('class="ml-button is-active" data-testid="white-balance-ml" aria-pressed="true"');
    expect(html).toContain('class="ml-button" data-testid="lightness-ml" aria-pressed="false"');
    expect(html).toContain('class="ml-button" data-testid="color-ml" aria-pressed="false"');
  });

  it('gives no ML button to sections without an automatic action', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { whiteBalance: true, lightness: true, color: true }, { whiteBalance: true, lightness: true, color: true });
    expect(html).not.toContain('data-testid="curves-ml"');
    expect(html).not.toContain('data-testid="details-ml"');
    expect(html).not.toContain('data-testid="effects-ml"');
  });
});

describe('adjustment visibility toggles', () => {
  it('carries no toggle beside the ML button — the ML button is the one control', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    // The chevron alone collapses ML sections; no toggle sits next to the
    // ML button, neither as visibility nor as effect bypass.
    expect(html).not.toContain('aria-label="Show white balance"');
    expect(html).not.toContain('aria-label="Show lightness"');
    expect(html).not.toContain('aria-label="Show hue &amp; saturation"');
    expect(html).not.toContain('Enable white balance');
    expect(html).not.toContain('Enable lightness');
    expect(html).not.toContain('Enable hue');
    // Details has no automatic action, so it keeps its visibility toggle.
    expect(html).toContain('aria-label="Show details"');
  });

  it('reflects Details visibility in its toggle state', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    // Details starts collapsed, as before the toggle change.
    expect(html).toContain('aria-checked="false" aria-label="Show details"');
    expect(html).not.toContain('>Clarity</label>');
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
      <AdjustmentSection title="White Balance" icon={<i />} enabled onToggle={noop} {...props}>
        <span>slider-stub</span>
      </AdjustmentSection>,
    );

  it('hides content and ML behind controlled visibility', () => {
    const html = section({ enabled: false, open: false, ml: { id: 'white-balance', applied: true, canRevert: true, onToggle: noop, onRevert: noop } });
    expect(html).toContain('is-collapsed');
    expect(html).not.toContain('slider-stub');
    // The ML action follows the Auto precedent: heading-only when collapsed.
    expect(html).not.toContain('white-balance-ml');
    expect(html).toContain('aria-checked="false" aria-label="Show white balance"');
  });

  it('renders content and ML when controlled open', () => {
    const html = section({ enabled: true, open: true, ml: { id: 'white-balance', applied: false, canRevert: false, onToggle: noop, onRevert: noop } });
    expect(html).not.toContain('is-collapsed');
    expect(html).toContain('slider-stub');
    expect(html).toContain('data-testid="white-balance-ml"');
    expect(html).not.toContain('section-reset');
  });

  it('keeps the reset persistent while a snapshot exists, highlight or not', () => {
    const html = section({ enabled: true, open: true, onReset: noop, ml: { id: 'white-balance', applied: false, canRevert: true, onToggle: noop, onRevert: noop } });
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
    // Denoise (no ISO suggestion): the shared ML button carries the
    // disabled state and the section-specific tooltip.
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

  it('honors a custom toggle label for effect toggles', () => {
    const html = section({ toggleLabel: 'Enable black & white' });
    expect(html).toContain('aria-label="Enable black &amp; white"');
  });
});
