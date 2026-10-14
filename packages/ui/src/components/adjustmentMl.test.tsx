import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';

// Per-category header toggles, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring — one switch per
// category (on = non-default values, whether auto-applied or
// hand-tweaked), no Auto/ML button and no reset beside it — not click
// behavior. Sections without an automatic action (Curves, Details,
// Effects) carry the same switch, disabled while off: it lights on the
// first tweak and resets on click.

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

describe('adjustment header toggles', () => {
  it('renders a toggle on each auto-capable category, never an Auto or ML button', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    for (const [id, title] of [
      ['white-balance', 'white balance'],
      ['lightness', 'lightness'],
      ['color', 'hue &amp; saturation'],
    ] as const) {
      expect(html).toContain(`data-testid="${id}-toggle"`);
      expect(html).toContain(`data-tooltip="Apply ${title} automatically"`);
      expect(html).not.toContain(`data-testid="${id}-auto"`);
      expect(html).not.toContain(`data-testid="${id}-ml"`);
    }
    expect(html).toContain('aria-checked="false"');
    // The only Auto pill left in the assist-free adjust tool is the
    // whole-photo header Auto; the slider categories carry switches now.
    expect(html).not.toContain('>ML</button>');
    expect(html).not.toContain('ml-button');
    expect(html.match(/>Auto<\/button>/g)).toHaveLength(1);
    expect(html).toContain('class="auto-small inspector-auto" data-testid="auto-enhance-auto"');
    // No reset renders on the converted sections at all.
    expect(html).not.toContain('-ml-revert');
    expect(html).not.toContain('section-reset');
    expect(html).not.toContain('aria-label="Reset white balance"');
  });

  it('lights the toggle of exactly the dirty section, with no reset beside it', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, exposure: 0.5 });
    expect(html).toContain('class="toggle is-on" data-testid="lightness-toggle"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-tooltip="Lightness on — click to reset to defaults"');
    // The toggle replaces the reset: no reset icon renders on the
    // converted sections, dirty or not.
    expect(html).not.toContain('section-reset');
    expect(html).not.toContain('-ml-revert');
    // The other categories stay off.
    expect(html).toContain('class="toggle" data-testid="white-balance-toggle"');
    expect(html).toContain('class="toggle" data-testid="color-toggle"');
  });

  it('keeps the toggle on past the auto values: any tweak is on, defaults are off', () => {
    // Auto-produced values and hand-tweaked values both light the toggle
    // — on means "holds an effect", not "holds exactly the auto values".
    // There is no separate touched state anymore.
    const auto = renderAdjust({ ...DEFAULT_EDIT, temperature: 5800, tint: 6 });
    expect(auto).toContain('class="toggle is-on" data-testid="white-balance-toggle"');
    expect(auto).toContain('data-tooltip="White Balance on — click to reset to defaults"');
    const tweaked = renderAdjust({ ...DEFAULT_EDIT, temperature: 6200, tint: -8 });
    expect(tweaked).toContain('class="toggle is-on" data-testid="white-balance-toggle"');
    expect(tweaked).toContain('data-tooltip="White Balance on — click to reset to defaults"');
    expect(tweaked).not.toContain('section-reset');
  });

  it('tracks dirtiness per category', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, exposure: 0.5, saturation: 8 });
    expect(html).toContain('class="toggle is-on" data-testid="lightness-toggle"');
    expect(html).toContain('class="toggle is-on" data-testid="color-toggle"');
    expect(html).toContain('class="toggle" data-testid="white-balance-toggle"');
    expect(html).not.toContain('section-reset');
  });

  it('keeps the toggle rightmost as the one header control', () => {
    // Every category dirty, so every toggle is on — each still closes its
    // row alone, with no reset beside it.
    const html = renderAdjust({ ...DEFAULT_EDIT, temperature: 5800, exposure: 0.5, saturation: 8 });
    expect(html).not.toContain('section-reset');
    for (const id of ['white-balance', 'lightness', 'color'] as const) {
      const toggle = html.indexOf(`data-testid="${id}-toggle"`);
      expect(toggle).toBeGreaterThan(-1);
      const section = html.slice(Math.max(0, toggle - 800), toggle);
      const actions = section.slice(section.lastIndexOf('section-actions'));
      expect(actions).not.toContain('section-reset');
      expect(actions).not.toContain('ml-revert');
      // The toggle closes the row: switch end tag, then the row end tag.
      const after = html.slice(toggle, toggle + 400);
      expect(after).toMatch(new RegExp(`data-testid="${id}-toggle"[^>]*><span></span></button></div>`));
    }
  });

  it('distinguishes toggle on from off via is-on plus aria-checked', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, temperature: 5800 });
    expect(html).toContain('class="toggle is-on" data-testid="white-balance-toggle"');
    expect(html).toContain('class="toggle" data-testid="lightness-toggle"');
    expect(html).toContain('class="toggle" data-testid="color-toggle"');
    // Each switch carries its own checked state next to the section title.
    const on = html.match(/<button[^>]*data-testid="white-balance-toggle"[^>]*>/)?.[0] ?? '';
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('aria-label="White Balance"');
    const off = html.match(/<button[^>]*data-testid="lightness-toggle"[^>]*>/)?.[0] ?? '';
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('aria-label="Lightness"');
  });

  it('gives the sections without an automatic action the same dirtiness switch', () => {
    // Curves, Details, and Effects have no suggestion to apply, so the
    // switch disables while off — and lights on the first tweak, exactly
    // like the auto sections. No Auto/ML button and no reset anywhere.
    const html = renderAdjust({ ...DEFAULT_EDIT, curve: 25, clarity: 20, vignette: 40 });
    for (const id of ['curves', 'details', 'effects'] as const) {
      expect(html).toContain(`class="toggle is-on" data-testid="${id}-toggle"`);
      expect(html).not.toContain(`data-testid="${id}-ml"`);
      expect(html).not.toContain(`data-testid="${id}-auto"`);
    }
    expect(html).not.toContain('aria-label="Reset curves"');
    expect(html).not.toContain('aria-label="Reset details"');
    expect(html).not.toContain('aria-label="Reset effects"');
    expect(html).not.toContain('section-reset');
    const clean = renderAdjust({ ...DEFAULT_EDIT });
    for (const id of ['curves', 'details', 'effects'] as const) {
      expect(clean).toContain(`class="toggle" data-testid="${id}-toggle"`);
      const tag = clean.match(new RegExp(`<button[^>]*data-testid="${id}-toggle"[^>]*>`))?.[0] ?? '';
      expect(tag, `${id} disables its switch at defaults — nothing to turn on`).toContain('disabled');
    }
    // The auto sections stay enabled while off: off-to-on applies.
    for (const id of ['white-balance', 'lightness', 'color'] as const) {
      const tag = clean.match(new RegExp(`<button[^>]*data-testid="${id}-toggle"[^>]*>`))?.[0] ?? '';
      expect(tag, `${id} stays enabled while off`).not.toContain('disabled');
    }
  });
});

describe('adjustment header controls', () => {
  it('drives auto sections from the header toggle alone: no button, no reset, no bypass', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    // The switch is the one header control: toggling on applies the
    // suggested change, toggling off resets to defaults.
    expect(html).toContain('aria-label="White Balance"');
    expect(html).toContain('aria-label="Lightness"');
    expect(html).toContain('aria-label="Hue &amp; Saturation"');
    expect(html).not.toContain('Enable white balance');
    expect(html).not.toContain('Enable lightness');
    expect(html).not.toContain('Enable hue');
    // Details carries the same dirtiness switch as every other section —
    // labeled with the section title, like the rest.
    expect(html).toContain('aria-label="Details"');
  });

  it('starts Details collapsed behind its disclosure, switch in the header', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT });
    expect(html).not.toContain('>Clarity</label>');
    const heading = html.indexOf('<h3>Details</h3>');
    const details = html.slice(html.lastIndexOf('<section', heading), html.indexOf('<h3>Effects</h3>'));
    expect(details).toContain('class="toggle" data-testid="details-toggle"');
    expect(details).toContain('aria-expanded="false"');
  });

  it('keeps sliders enabled so a legacy-disabled category recovers on first drag', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT, whiteBalanceEnabled: false });
    const numberInput = html.match(/<input[^>]*aria-label="Temperature value"[^>]*>/);
    expect(numberInput).not.toBeNull();
    expect(numberInput?.[0]).not.toMatch(/disabled/);
    const slider = html.match(/<input[^>]*data-tooltip="Double-click to reset temperature"[^>]*>/);
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
    const html = section({ open: false, ml: { id: 'white-balance', applied: true, onToggle: noop } });
    expect(html).toContain('is-collapsed');
    expect(html).not.toContain('slider-stub');
    // Collapsing hides the sliders, never the header control: the action
    // stays rendered, one click away.
    expect(html).toContain('data-testid="white-balance-ml"');
  });

  it('renders content and ML when controlled open', () => {
    const html = section({ open: true, ml: { id: 'white-balance', applied: false, onToggle: noop } });
    expect(html).not.toContain('is-collapsed');
    expect(html).toContain('slider-stub');
    expect(html).toContain('data-testid="white-balance-ml"');
    expect(html).not.toContain('section-reset');
  });

  it('stays self-managed without controlled visibility', () => {
    const html = section({});
    expect(html).not.toContain('is-collapsed');
    expect(html).toContain('slider-stub');
  });

  it('disables the header action and honors a custom tooltip when given', () => {
    // The shared header action carries the disabled state and a
    // section-specific tooltip instead of the computed one (the contract
    // One-Click Removal and Dust Spots both use).
    const html = section({ ml: { id: 'denoise', applied: false, onToggle: noop, disabled: true, hint: 'ISO 100 needs no denoise' } });
    expect(html).toContain('data-testid="denoise-ml"');
    const tag = html.match(/<button[^>]*data-testid="denoise-ml"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('disabled');
    expect(html).toContain('data-tooltip="ISO 100 needs no denoise"');
    expect(html).not.toContain('Automatically adjust');
  });

  it('omits the disabled attribute and computes the tooltip by default', () => {
    const html = section({ ml: { id: 'white-balance', applied: false, onToggle: noop } });
    const tag = html.match(/<button[^>]*data-testid="white-balance-ml"[^>]*>/)?.[0] ?? '';
    expect(tag).not.toContain('disabled');
    expect(html).toContain('data-tooltip="Automatically adjust white balance with ML"');
  });

  it('renders the header toggle as the one control, staying put while collapsed', () => {
    // The Color Adjustments sections drive their effect from the header
    // switch (on applies the suggestion, off resets to defaults) — the
    // Repair headers keep the ML/Auto button above. The switch stays
    // rendered while collapsed, like every other header control.
    const html = section({ open: false, toggle: { id: 'white-balance', checked: true, onToggle: noop, hint: 'White Balance on — click to reset to defaults' } });
    expect(html).toContain('is-collapsed');
    expect(html).not.toContain('slider-stub');
    expect(html).toContain('class="toggle is-on" data-testid="white-balance-toggle"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="White Balance"');
    expect(html).toContain('data-tooltip="White Balance on — click to reset to defaults"');
    expect(html).not.toContain('section-reset');
    expect(html).not.toContain('ml-button');
  });

  it('disables the header toggle and honors its tooltip when given', () => {
    // The Denoise contract: no suggestion (or a running job) disables the
    // switch, with a section-specific tooltip instead of the title.
    const html = section({ title: 'Denoise', toggle: { id: 'denoise', checked: false, onToggle: noop, disabled: true, hint: 'ISO 100 needs no denoise' } });
    expect(html).toContain('data-testid="denoise-toggle"');
    const tag = html.match(/<button[^>]*data-testid="denoise-toggle"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('disabled');
    expect(tag).toContain('aria-label="Denoise"');
    expect(html).toContain('data-tooltip="ISO 100 needs no denoise"');
  });
});
