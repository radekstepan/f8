import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, Photo, SelectiveAdjustState } from '@f8/core';
import { Inspector } from './Inspector.js';
import type { SelectiveMaskAssist } from './Inspector.js';

// ML selective-mask control, rendered on the server (no jsdom): effects
// never run, so this pins the markup + prop wiring, not click behavior.

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

function assist(overrides: Partial<SelectiveMaskAssist> = {}): SelectiveMaskAssist {
  return {
    state: 'idle',
    found: false,
    coverage: 0,
    source: null,
    progress: null,
    note: null,
    message: null,
    applied: null,
    onDetect: noop,
    onAdjust: noop,
    onToggle: noop,
    onClear: noop,
    onDismiss: noop,
    ...overrides,
  };
}

const APPLIED: SelectiveAdjustState = {
  maskB64: 'eA==',
  maskWidth: 4,
  maskHeight: 4,
  subject: { exposure: 0.5, contrast: 10, saturation: 0 },
  background: { exposure: 0, contrast: 0, saturation: 0 },
  source: 'onnx',
};

function renderAdjust(edit: EditState, selectiveAssist?: SelectiveMaskAssist): string {
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
      {...(selectiveAssist === undefined ? {} : { selectiveAssist })}
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

describe('selective mask control', () => {
  it('is absent without a selective assist', () => {
    expect(renderAdjust({ ...DEFAULT_EDIT })).not.toContain('data-testid="selective-mask"');
  });

  it('runs segmentation from a header toggle with an ML badge, never a full-width bar', () => {
    const html = renderAdjust({ ...DEFAULT_EDIT }, assist());
    expect(html).toContain('data-testid="selective-mask"');
    expect(html).toContain('data-testid="selective-mask-toggle"');
    expect(html).toContain('class="toggle" data-testid="selective-mask-toggle"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('data-tooltip="Find the subject with ML"');
    // A model runs here, so the tool name carries the little ML badge.
    expect(html).toContain('<h3>Subject &amp; Background</h3><span class="ml-badge"');
    expect(html).toContain('Changes save automatically');
    // No detect bar in the content, no header button, no reset.
    expect(html).not.toContain('data-testid="selective-mask-detect"');
    expect(html).not.toContain('Enhance Subject &amp; Background');
    expect(html).not.toContain('data-testid="selective-mask-ml"');
    expect(html).not.toContain('aria-label="Reset subject &amp; background"');
  });

  it('keeps the section title visible before and after detection', () => {
    // The title names the action in every state, so the sliders always
    // have a visible group; the header toggle drives segment/clear.
    const idle = renderAdjust({ ...DEFAULT_EDIT }, assist());
    expect(idle).toContain('<h3>Subject &amp; Background</h3>');
    expect(idle).toContain('data-testid="selective-mask-toggle"');
    const applied = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    expect(applied).toContain('<h3>Subject &amp; Background</h3>');
    expect(applied).toContain('data-testid="selective-mask-toggle"');
    expect(applied).not.toContain('aria-label="Reset subject &amp; background"');
    expect(applied).not.toContain('data-testid="selective-mask-detect"');
  });

  it('lights the header toggle while a mask is stored, with no reset beside it', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    expect(html).toContain('class="toggle is-on" data-testid="selective-mask-toggle"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-tooltip="Subject &amp; Background on — click to turn off"');
    expect(html).not.toContain('aria-label="Reset subject &amp; background"');
  });

  it('auto-applies an ML result with no apply step or target toggle', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({ state: 'ready', found: true, coverage: 0.23, source: 'onnx' }),
    );
    expect(html).toContain('data-testid="selective-mask-summary"');
    expect(html).toContain('Subject 23%');
    expect(html).toContain('· ML');
    expect(html).toContain('applying to photo');
    expect(html).not.toContain('data-testid="selective-mask-apply"');
    expect(html).not.toContain('-target-subject');
    expect(html).not.toContain('-target-background');
  });

  it('labels classical results as a scan and omits the ML tag', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT },
      assist({
        state: 'ready',
        found: true,
        coverage: 0.31,
        source: 'classic',
        note: 'Classical scan — ML weights are still downloading or offline, so this is approximate.',
      }),
    );
    expect(html).toContain('Subject 31%');
    expect(html).toContain('Classical scan');
    expect(html).not.toContain('· ML');
  });

  it('reports no subject and offers retry on error', () => {
    const empty = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'ready', found: false, coverage: 0, source: 'onnx' }));
    expect(empty).toContain('No subject found.');
    const classicalEmpty = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'ready', found: false, coverage: 0, source: 'classic' }));
    expect(classicalEmpty).toContain('No subject found by the classical scan.');
    const failed = renderAdjust({ ...DEFAULT_EDIT }, assist({ state: 'error', message: 'Photo server unreachable.' }));
    expect(failed).toContain('Photo server unreachable.');
    expect(failed).toContain('data-testid="selective-mask-retry"');
  });

  it('shows both live slider groups with rescan and clear, and no content toggle', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    // The header owns the only switch; the content holds just actions.
    expect(html).toContain('class="toggle is-on" data-testid="selective-mask-toggle"');
    expect(html).not.toContain('Enable subject and background enhance');
    expect(html).toContain('data-testid="selective-mask-subject-group"');
    expect(html).toContain('data-testid="selective-mask-subject-exposure"');
    expect(html).toContain('data-testid="selective-mask-subject-contrast"');
    expect(html).toContain('data-testid="selective-mask-background-group"');
    expect(html).toContain('data-testid="selective-mask-background-exposure"');
    expect(html).toContain('data-testid="selective-mask-background-saturation"');
    expect(html).toContain('data-testid="selective-mask-redetect"');
    expect(html).toContain('data-testid="selective-mask-clear"');
    expect(html).not.toContain('data-testid="selective-mask-apply"');
    expect(html).not.toContain('data-testid="selective-mask-detect"');
  });

  it('keeps exactly one switch in the section — the header toggle', () => {
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    const headingAt = html.indexOf('<h3>Subject &amp; Background</h3>');
    expect(headingAt).toBeGreaterThan(-1);
    const section = html.slice(html.lastIndexOf('<section', headingAt), html.indexOf('</section>', headingAt));
    expect(section.match(/role="switch"/g)).toHaveLength(1);
    expect(section).toContain('data-testid="selective-mask-toggle"');
  });

  it('drops the golden settings summary — the sliders show the values', () => {
    const both: SelectiveAdjustState = {
      ...APPLIED,
      subject: { exposure: 0.5, contrast: 0, saturation: 0 },
      background: { exposure: 0, contrast: 0, saturation: -20 },
      source: 'classic',
    };
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: both },
      assist({ applied: both }),
    );
    expect(html).not.toContain('data-testid="selective-mask-applied"');
    expect(html).not.toContain('Subject (+0.5 EV)');
    expect(html).not.toContain('Background (S -20)');
    expect(html).not.toContain('No changes yet');
    // The sliders themselves still carry both sides' values.
    expect(html).toContain('data-testid="selective-mask-subject-exposure"');
    expect(html).toContain('data-testid="selective-mask-background-saturation"');
  });

  it('keeps the sliders on a stored-but-neutral mask instead of an empty state', () => {
    const neutral: SelectiveAdjustState = {
      ...APPLIED,
      subject: { exposure: 0, contrast: 0, saturation: 0 },
      background: { exposure: 0, contrast: 0, saturation: 0 },
    };
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: neutral },
      assist({ applied: neutral }),
    );
    expect(html).toContain('class="toggle is-on" data-testid="selective-mask-toggle"');
    expect(html).toContain('data-testid="selective-mask-subject-exposure"');
    expect(html).toContain('data-testid="selective-mask-background-exposure"');
    expect(html).not.toContain('data-testid="selective-mask-detect"');
  });

  it('keeps the actions row switch-free — Rescan and Clear only', () => {
    // The header owns the only switch now; the row holds just the two
    // text actions, so row CSS must never target first-child buttons —
    // that once stretched a leading switch into a wide gold bar.
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    const rowStart = html.indexOf('selective-mask-row');
    expect(rowStart).toBeGreaterThan(-1);
    const row = html.slice(rowStart, html.indexOf('selective-mask-subject-group', rowStart));
    expect(row).not.toContain('role="switch"');
    expect(row).toContain('data-testid="selective-mask-redetect"');
    expect(row).toContain('data-testid="selective-mask-clear"');
  });

  it('has no first-child button rule that could stretch a leading control', () => {
    expect(css()).not.toMatch(/\.auto-enhance-row > button:first-child/);
  });

  it('drops the row-toggle sizing rule and dims bypassed slider groups instead', () => {
    // No switch lives in the content anymore, so its sizing rule is gone;
    // the bypassed state dims the slider groups (the Faces is-off value).
    expect(cssRule('.selective-mask-row > .toggle')).toBe('');
    expect(cssRule('.selective-mask.is-off .selective-group')).toContain('opacity: .45');
  });

  it('gives each slider group an icon so the subsections scan faster', () => {
    // Subject takes the avatar glyph, Background the picture glyph — both
    // from the same lucide set as every section header icon.
    const html = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    const subjectStart = html.indexOf('data-testid="selective-mask-subject-group"');
    const backgroundStart = html.indexOf('data-testid="selective-mask-background-group"');
    expect(subjectStart).toBeGreaterThan(-1);
    expect(backgroundStart).toBeGreaterThan(subjectStart);
    const subjectGroup = html.slice(subjectStart, backgroundStart);
    const backgroundGroup = html.slice(backgroundStart);
    expect(subjectGroup).toContain('lucide-circle-user-round');
    expect(subjectGroup).toContain('>Subject<');
    expect(backgroundGroup).toContain('lucide-image');
    expect(backgroundGroup).toContain('>Background<');
    // The glyphs are decorative: screen readers keep hearing just the label.
    expect(subjectGroup).toContain('aria-hidden="true"');
    expect(backgroundGroup).toContain('aria-hidden="true"');
  });

  it('aligns the subgroup icons with their labels', () => {
    const rule = cssRule('.selective-group-label');
    expect(rule).toContain('inline-flex');
    expect(rule).toContain('align-items: center');
    expect(rule).toContain('gap: 4px');
  });

  it('drives bypass from the header toggle without deleting the mask', () => {
    const on = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: APPLIED },
      assist({ applied: APPLIED }),
    );
    expect(on).toContain('class="toggle is-on" data-testid="selective-mask-toggle"');
    expect(on).toContain('data-tooltip="Subject &amp; Background on — click to turn off"');
    const off = renderAdjust(
      { ...DEFAULT_EDIT, selectiveAdjust: { ...APPLIED, enabled: false } },
      assist({ applied: { ...APPLIED, enabled: false } }),
    );
    // The header reads the enabled flag: bypassed shows off with a
    // restore hint, and the slider groups dim so the state reads there.
    expect(off).toContain('class="toggle" data-testid="selective-mask-toggle"');
    expect(off).toContain('data-tooltip="Subject &amp; Background off — click to turn on"');
    expect(off).toContain('selective-mask is-off');
    // The sliders and rescan/clear stay, so values survive the toggle.
    expect(off).toContain('data-testid="selective-mask-subject-exposure"');
    expect(off).toContain('data-testid="selective-mask-background-exposure"');
    expect(off).toContain('data-testid="selective-mask-redetect"');
    expect(off).toContain('data-testid="selective-mask-clear"');
    expect(off).not.toContain('aria-label="Reset subject &amp; background"');
  });
});
