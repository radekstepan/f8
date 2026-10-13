import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, MlCategory, Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';

// Per-category ML buttons + visibility toggles, rendered on the server (no
// jsdom): effects never run, so this pins the markup + prop wiring — ML
// button per auto-capable category, revert icon iff applied, toggles
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
    // No Auto pills remain in the adjust tool (straighten's lives in crop).
    expect(html).not.toContain('auto-small');
    expect(html).not.toContain('>Auto</button>');
    // No revert icon before anything is applied.
    expect(html).not.toContain('-ml-revert');
  });

  it('shows a revert icon next to the applied ML button only', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { whiteBalance: true }, { whiteBalance: true });
    expect(html).toContain('class="ml-button is-active" data-testid="white-balance-ml"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="ML white balance applied — click to revert"');
    expect(html).toContain('data-testid="white-balance-ml-revert"');
    expect(html).toContain('aria-label="Revert ML white balance"');
    // The revert icon sits right beside its ML button, ahead of reset.
    const ml = html.indexOf('data-testid="white-balance-ml"');
    const revert = html.indexOf('data-testid="white-balance-ml-revert"');
    const reset = html.indexOf('aria-label="Reset white balance"');
    expect(ml).toBeGreaterThan(-1);
    expect(revert).toBeGreaterThan(ml);
    expect(reset).toBeGreaterThan(revert);
    // The other categories stay idle, without revert icons.
    expect(html).toContain('class="ml-button" data-testid="lightness-ml"');
    expect(html).toContain('class="ml-button" data-testid="color-ml"');
    expect(html).not.toContain('data-testid="lightness-ml-revert"');
    expect(html).not.toContain('data-testid="color-ml-revert"');
  });

  it('keeps the revert icon after manual edits cleared the highlight', () => {
    // A slider drag after the ML apply drops the pure-auto highlight but
    // leaves the pre-ML snapshot: idle button, re-apply title, revert
    // icon still beside it.
    const html = renderAdjust({ ...DEFAULT_EDIT }, {}, { whiteBalance: true });
    expect(html).toContain('class="ml-button" data-testid="white-balance-ml"');
    expect(html).toContain('title="Re-apply automatic white balance with ML"');
    expect(html).toContain('data-testid="white-balance-ml-revert"');
    expect(html).toContain('aria-label="Revert ML white balance"');
    expect(html).not.toContain('data-testid="lightness-ml-revert"');
    expect(html).not.toContain('data-testid="color-ml-revert"');
  });

  it('tracks applied state per category', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, { lightness: true, color: true }, { lightness: true, color: true });
    expect(html).toContain('class="ml-button is-active" data-testid="lightness-ml"');
    expect(html).toContain('class="ml-button is-active" data-testid="color-ml"');
    expect(html).toContain('data-testid="lightness-ml-revert"');
    expect(html).toContain('data-testid="color-ml-revert"');
    expect(html).toContain('class="ml-button" data-testid="white-balance-ml"');
    expect(html).not.toContain('data-testid="white-balance-ml-revert"');
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

  it('hides content, ML, and revert behind controlled visibility', () => {
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
    expect(html).not.toContain('data-testid="white-balance-ml-revert"');
  });

  it('shows the revert icon without the highlight after manual edits', () => {
    const html = section({ enabled: true, open: true, ml: { id: 'white-balance', applied: false, canRevert: true, onToggle: noop, onRevert: noop } });
    expect(html).toContain('class="ml-button" data-testid="white-balance-ml"');
    expect(html).toContain('title="Re-apply automatic white balance with ML"');
    expect(html).toContain('data-testid="white-balance-ml-revert"');
  });

  it('stays self-managed without controlled visibility', () => {
    const html = section({});
    expect(html).not.toContain('is-collapsed');
    expect(html).toContain('slider-stub');
  });

  it('honors a custom toggle label for effect toggles', () => {
    const html = section({ toggleLabel: 'Enable black & white' });
    expect(html).toContain('aria-label="Enable black &amp; white"');
  });
});
