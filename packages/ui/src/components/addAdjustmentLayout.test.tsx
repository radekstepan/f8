import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Add Adjustment button layout: the "+" and chevron icons sit snugly next
// to the label, centered as one group. They used to carry opposing
// margin auto rules that pushed each icon to the far edge of the
// full-width button. Positioning lives in CSS, so the rules are pinned
// here (same seam as albumMenuOverlay.test.tsx); the button markup in
// Inspector.tsx stays untouched.

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

const cssRules = (selector: string): string[] => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css().matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1] ?? '');
};

describe('add adjustment button layout', () => {
  it('centers the label and icons as one group', () => {
    const rule = cssRule('.add-adjustment');
    expect(rule).toMatch(/justify-content\s*:\s*center/);
    expect(rule).toMatch(/gap\s*:\s*7px/);
  });

  it('does not push the icons to the far edges', () => {
    // Every rule targeting the button's icons must be free of opposing
    // auto margins; flex gap alone sets the spacing to the label.
    const iconRules = [
      ...cssRules('.add-adjustment > svg:first-child'),
      ...cssRules('.add-adjustment > svg:last-child'),
    ];
    expect(iconRules.length).toBeGreaterThan(0);
    for (const rule of iconRules) {
      expect(rule).not.toMatch(/margin-(left|right)\s*:\s*auto/);
    }
  });
});
