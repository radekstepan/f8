import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Top menu bar dropdowns open flush with their trigger pills. The
// trigger carries `margin: 3px 0` inside the full-height
// `.menu-anchor`, so the shared `.dropdown-menu` base rule
// (`top: 100%`, measured from the anchor) would leave a 3px gap
// below the pill; a `.menu-bar`-scoped override subtracts the
// trigger's bottom margin. Stylesheet-pinned (same seam as
// topbarMenus.test.tsx): no jsdom, positions asserted from CSS.

const here = dirname(fileURLToPath(import.meta.url));
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

/** Vertical (top/bottom) margin in px from a `margin:` shorthand. */
function verticalMarginPx(rule: string): number | null {
  const value = rule.match(/margin:\s*([^;]+);/)?.[1]?.trim().split(/\s+/) ?? [];
  const first = value[0];
  if (!first || !first.endsWith('px')) return null;
  return Number(first.slice(0, -2));
}

describe('topbar dropdown flush alignment', () => {
  it('opens the menu flush with the trigger pill bottom edge (no 3px gap)', () => {
    const rule = cssRule('.menu-bar .dropdown-menu');
    expect(rule).toContain('top:');
    const offset = rule.match(/top:\s*calc\(100%\s*-\s*(\d+)px\)/)?.[1];
    expect(offset).toBeDefined();
    // The subtracted offset must equal the trigger's own bottom
    // margin, or the menu edge drifts off the pill edge.
    expect(Number(offset)).toBe(verticalMarginPx(cssRule('.menu-trigger')));
  });

  it('keeps horizontal alignment on the shared/edge rules, not the override', () => {
    const rule = cssRule('.menu-bar .dropdown-menu');
    expect(rule).not.toContain('left:');
    expect(rule).not.toContain('right:');
    expect(cssRule('.dropdown-menu')).toMatch(/left:\s*0/);
    expect(css()).toMatch(/\.menu-anchor:nth-last-child\(-n\+2\) \.dropdown-menu\s*\{[^}]*right:\s*0/);
  });

  it('leaves other .dropdown-menu users on their own anchoring', () => {
    // Base rule still anchors at the anchor bottom for inspector /
    // browser menus; the scoped topbar override must not leak.
    expect(cssRule('.dropdown-menu')).toMatch(/top:\s*100%/);
    expect(cssRule('.add-adjustment-menu')).toMatch(/bottom:\s*calc\(100% \+ 3px\)/);
    expect(cssRule('.sidebar-album-menu')).toMatch(/position:\s*fixed/);
    expect(cssRule('.sidebar-album-menu')).toMatch(/top:\s*auto/);
    expect(cssRule('.inspector-options')).not.toContain('top:');
  });
});
