import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Sidebar album "..." menus must float above the UI: the menu used to be
// absolutely positioned inside the sidebar's scroll container, so the
// container's overflow clipped it. Positioning lives in CSS, so pin the
// rules themselves; the viewport anchoring math is unit-tested in
// @f8/core (menuAnchor.test.ts), and open/close interaction is client-only.

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('sidebar album menu overlay', () => {
  it('floats the sidebar album menu above the UI instead of clipping it', () => {
    // Fixed positioning escapes the sidebar scroll container's overflow;
    // the z-index matches the photo context menu (above modal backdrops).
    const rule = cssRule('.sidebar-album-menu');
    expect(rule).toMatch(/position\s*:\s*fixed/);
    expect(rule).toMatch(/z-index\s*:\s*120/);
  });

  it('lets the measured coordinates place the menu without stretching it', () => {
    // The component sets inline left/top from the trigger rect. The shared
    // .album-menu rule pins right: 0 for the grid header menus; on a fixed
    // box inline left + right would stretch the menu, so the sidebar
    // variant must clear the horizontal pins (top comes from inline style,
    // with top: auto as the pre-measure fallback).
    const rule = cssRule('.sidebar-album-menu');
    expect(rule).toMatch(/left\s*:\s*auto/);
    expect(rule).toMatch(/right\s*:\s*auto/);
    expect(rule).toMatch(/top\s*:\s*auto/);
  });

  it('keeps the shared album-menu rule anchoring the grid header menus', () => {
    // The library-grid sort/album menus reuse .album-menu inside relative
    // containers: they still drop below their triggers via the base
    // absolute positioning, so the shared rule must not go fixed.
    const rule = cssRule('.album-menu');
    expect(rule).not.toMatch(/position\s*:/);
    expect(rule).toMatch(/right\s*:\s*0/);
  });
});
