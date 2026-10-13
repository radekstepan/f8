import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MenuBar } from './Topbar.js';

// Top menu bar: triggers open flush with their dropdown panels, so the
// corners where they meet must be square — the open trigger's bottom
// corners and the panel's top corners. Hovering a closed trigger keeps
// the full pill rounding (there is no panel to join with), and all
// other .dropdown-menu users keep their own rounding. Stylesheet-pinned
// (same seam as topbarDropdownFlush.test.tsx): no jsdom, radii asserted
// from CSS, with the open-state wiring pinned from the Topbar.tsx source
// (dropdowns only render while open).

const here = dirname(fileURLToPath(import.meta.url));
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');
const source = () => readFileSync(resolve(here, 'Topbar.tsx'), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

/** Selector of every rule block zeroing the given corner radius. */
function zeroingSelectors(property: 'border-top-left-radius' | 'border-top-right-radius' | 'border-bottom-left-radius' | 'border-bottom-right-radius'): string[] {
  const selectors: string[] = [];
  const pattern = new RegExp(`${property}:\\s*0`, 'g');
  const text = css();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const blockStart = text.lastIndexOf('}', match.index);
    const selector = text.slice(blockStart + 1, text.indexOf('{', blockStart + 1)).trim().replace(/\/\*.*?\*\//gs, '').trim();
    selectors.push(selector);
  }
  return selectors;
}

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

describe('topbar dropdown meeting-edge rounding', () => {
  it('squares the open trigger bottom corners, and only via .is-open', () => {
    // (A plain cssRule('.menu-trigger.is-open') lookup would return the
    // earlier shared hover-background rule, so the zeroing rules are
    // located by their declarations instead.)
    for (const property of ['border-bottom-left-radius', 'border-bottom-right-radius'] as const) {
      const selectors = zeroingSelectors(property);
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        expect(selector).toBe('.menu-trigger.is-open');
      }
    }
  });

  it('keeps hover-alone and top corners rounded on the trigger', () => {
    // Base pill rounding untouched.
    expect(cssRule('.menu-trigger')).toMatch(/border-radius:\s*3px/);
    // No rule zeroes the trigger's top corners.
    expect(zeroingSelectors('border-top-left-radius')).not.toContain('.menu-trigger.is-open');
    expect(zeroingSelectors('border-top-right-radius')).not.toContain('.menu-trigger.is-open');
    // The shared hover rule only paints the background.
    const hoverRule = css().match(/\.menu-trigger:hover[^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(hoverRule).not.toContain('radius');
  });

  it('wires .is-open and aria-expanded to the open menu in Topbar.tsx', () => {
    expect(source()).toMatch(/open === name \? 'is-open' : ''/);
    expect(source()).toMatch(/aria-expanded=\{open === name\}/);
    // Closed render carries no open styling hook.
    const html = renderMenuBar();
    expect(html).toContain('menu-trigger');
    expect(html).not.toContain('is-open');
    expect(html).toContain('aria-expanded="false"');
  });

  it('squares the open panel top corners while staying flush', () => {
    const rule = cssRule('.menu-bar .dropdown-menu');
    expect(rule).toMatch(/border-top-left-radius:\s*0/);
    expect(rule).toMatch(/border-top-right-radius:\s*0/);
    expect(rule).toMatch(/top:\s*calc\(100% - 3px\)/);
  });

  it('keeps the panel bottom corners rounded', () => {
    expect(cssRule('.dropdown-menu')).toMatch(/border-radius:\s*7px/);
    const rule = cssRule('.menu-bar .dropdown-menu');
    expect(rule).not.toContain('border-bottom-left-radius');
    expect(rule).not.toContain('border-bottom-right-radius');
  });

  it('leaves every other dropdown user fully rounded', () => {
    for (const property of ['border-top-left-radius', 'border-top-right-radius'] as const) {
      const selectors = zeroingSelectors(property);
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        expect(selector).toBe('.menu-bar .dropdown-menu');
      }
    }
  });
});
