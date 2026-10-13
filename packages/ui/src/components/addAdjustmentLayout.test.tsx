import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { Inspector } from './Inspector.js';

// Add Adjustment button: a single chevron sits snugly right of the label,
// centered as one group. It used to carry both a "+" and a chevron; the
// redundant "+" is gone. Positioning lives in CSS, so the rules are pinned
// here (same seam as albumMenuOverlay.test.tsx); the menu toggle wiring is
// pinned from the Inspector.tsx source.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');
const source = () => readFileSync(resolve(here, 'Inspector.tsx'), 'utf8');

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

function renderButton(): string {
  const html = renderToStaticMarkup(
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
  return html.match(/<button class="add-adjustment"[\s\S]*?<\/button>/)?.[0] ?? '';
}

describe('add adjustment button icon', () => {
  it('shows a single chevron right of the label, no plus icon', () => {
    const button = renderButton();
    expect(button).toContain('Add Adjustment');
    // Exactly one icon in the button.
    expect(button.match(/<svg/g)?.length ?? 0).toBe(1);
    // The single icon comes after the label, and the source pins it as
    // the chevron — no Plus component remains anywhere in Inspector.
    const label = button.indexOf('Add Adjustment');
    const icon = button.indexOf('<svg');
    expect(label).toBeGreaterThan(-1);
    expect(icon).toBeGreaterThan(label);
    expect(source()).toContain('Add Adjustment<ChevronDown size={12} />');
    expect(source()).not.toContain('<Plus');
    expect(source()).not.toMatch(/import \{[^}]*\bPlus\b/);
  });

  it('still toggles the adjustment menu', () => {
    // The button flips addMenu on click, exposes the state for assistive
    // tech, and the menu renders only while open.
    expect(source()).toContain(
      '<button className="add-adjustment" onClick={() => setAddMenu(!addMenu)} aria-expanded={addMenu}>',
    );
    expect(source()).toContain('{addMenu && <div className="dropdown-menu add-adjustment-menu"');
  });

  it('centers the label and chevron as one group', () => {
    const rule = cssRule('.add-adjustment');
    expect(rule).toMatch(/justify-content\s*:\s*center/);
    expect(rule).toMatch(/gap\s*:\s*7px/);
  });

  it('keeps the chevron near the label, not at the far edge', () => {
    // A single icon rule, free of auto margins; flex gap alone sets the
    // spacing to the label.
    const rule = cssRule('.add-adjustment > svg');
    expect(rule.length).toBeGreaterThan(0);
    expect(rule).not.toMatch(/margin-(left|right)\s*:\s*auto/);
    expect(css()).not.toContain('.add-adjustment > svg:first-child');
    expect(css()).not.toContain('.add-adjustment > svg:last-child');
  });
});
