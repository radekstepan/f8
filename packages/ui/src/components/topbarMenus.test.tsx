import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MenuBar } from './Topbar.js';

// Top menu bar: dropdowns hang flush off their triggers (no 5px offset
// gap), the f/8 brand mark is a static logo rather than a dropdown
// trigger (About + Shortcuts live under Help), and the triggers are
// slim pills with top/bottom margin instead of full-height rounded
// blocks. Rendered on the server (no jsdom): pins the trigger markup,
// with positioning pinned from the stylesheet (same seam as
// addAdjustmentLayout.test.tsx) and the Help content pinned from the
// Topbar.tsx source (dropdowns only render while open).

const here = dirname(fileURLToPath(import.meta.url));
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');
const source = () => readFileSync(resolve(here, 'Topbar.tsx'), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

const noop = () => {};

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
    />,
  );
}

/** Trigger labels in render order. */
function triggerLabels(html: string): string[] {
  return Array.from(html.matchAll(/class="menu-trigger[^"]*"[^>]*>([^<]+)</g)).map((match) => match[1] ?? '');
}

describe('topbar menus and buttons', () => {
  it('renders exactly the File–Help triggers, with no f/8 brand trigger', () => {
    const labels = triggerLabels(renderMenuBar());
    expect(labels).toEqual(['File', 'Edit', 'Image', 'View', 'Window', 'Help']);
    expect(renderMenuBar()).not.toContain('brand-name');
  });

  it('keeps the brand mark as a static logo, not a trigger', () => {
    const html = renderMenuBar();
    // The gradient logo svg still leads the menu bar, outside the nav.
    expect(html).toMatch(/<div class="menu-bar"[^>]*><svg/);
    expect(html).not.toMatch(/<button[^>]*>\s*f\/8\s*</);
  });

  it('keeps About and Keyboard Shortcuts under Help', () => {
    const helpLine = source().split('\n').find((line) => line.trimStart().startsWith('Help:')) ?? '';
    expect(helpLine).toContain("'shortcuts'");
    expect(helpLine).toContain("'about'");
  });

  it('opens dropdowns flush with their triggers (no offset gap)', () => {
    const rule = cssRule('.dropdown-menu');
    expect(rule).toMatch(/top:\s*100%/);
    expect(rule).not.toContain('calc(100%');
    // Left edge aligned with the trigger; the small-screen right-aligned
    // variant is untouched.
    expect(rule).toMatch(/left:\s*0/);
    expect(css()).toMatch(/\.menu-anchor:nth-last-child\(-n\+2\) \.dropdown-menu\s*\{[^}]*right:\s*0/);
  });

  it('gives triggers top/bottom margin and tones down the rounding', () => {
    const rule = cssRule('.menu-trigger');
    expect(rule).toMatch(/margin:\s*3px 0/);
    expect(rule).toMatch(/border-radius:\s*3px/);
    expect(css()).not.toContain('brand-name');
  });

  it('still hides Window (now the 5th menu) on very small screens', () => {
    const labels = triggerLabels(renderMenuBar());
    expect(labels[4]).toBe('Window');
    expect(css()).toMatch(/\.menu-anchor:nth-child\(5\)\s*\{\s*display:\s*none/);
    expect(css()).not.toContain('nth-child(6)');
  });
});
