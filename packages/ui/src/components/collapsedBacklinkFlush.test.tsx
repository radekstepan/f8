import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Collapsed-library backlink flush: with the sidebar closed the photo
// backlink must open flush against the sidebar toggle (the PanelLeft
// button that re-expands the library). The collapsed window-toolbar used
// to keep a fixed 131px column, stranding ~90px of dead space between
// the 29px toggle and the backlink; now the column hugs the toggle and
// the main-toolbar drops its left gutter so the two boxes meet edge to
// edge. Stylesheet-pinned (the topbarDropdownFlush.test.tsx precedent):
// no jsdom, geometry asserted from CSS plus a markup-adjacency probe.

// Toggle geometry the hug arithmetic depends on: a 29px button in a
// 19px-left-padded column hugs to exactly 48px.
const TOGGLE_WIDTH_PX = 29;
const TOGGLE_LEFT_PAD_PX = 19;

const here = dirname(fileURLToPath(import.meta.url));
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');

const cssRule = (selector: string, source: string = css()): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

/** Body of one @media block, so breakpoint overrides pin separately. */
function mediaBlock(query: string): string {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`@media \\(${escaped}\\) \\{([\\s\\S]*?)\\n\\}\\n`))?.[1] ?? '';
}

/** Left value in px from a `padding:` shorthand (2- or 4-value form). */
function paddingLeftPx(rule: string): number | null {
  const parts = rule.match(/padding:\s*([^;]+);/)?.[1]?.trim().split(/\s+/) ?? [];
  const left = parts.length === 4 ? parts[3] : parts.length === 2 ? parts[1] : null;
  if (!left || !left.endsWith('px')) return null;
  return Number(left.slice(0, -2));
}

const noop = () => {};

function renderToolbar(): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool="adjust"
      compare={false}
      canUndo
      canRedo={false}
      showBacklink
      onTool={noop}
      onAction={noop}
      onDialog={noop}
    />,
  );
}

describe('collapsed backlink flush', () => {
  it('hugs the collapsed window-toolbar to the toggle (no dead column)', () => {
    const rule = cssRule('.app-shell:not(.has-sidebar) .window-toolbar');
    expect(rule).toMatch(/width:\s*auto/);
    expect(rule).toMatch(/padding-right:\s*0/);
    // No fixed collapsed width may remain: any px width re-opens the gap.
    expect(rule).not.toMatch(/width:\s*\d+px/);
    // The toggle itself keeps its size, or the hug arithmetic drifts.
    expect(cssRule('.icon-button')).toMatch(new RegExp(`width:\\s*${TOGGLE_WIDTH_PX}px`));
  });

  it('keeps the toggle parked while collapsing (same 19px left padding)', () => {
    // The collapsed override touches only width/right padding: left
    // padding inherits the open column's 19px, so the toggle never jumps
    // sideways when the sidebar closes.
    expect(cssRule('.app-shell:not(.has-sidebar) .window-toolbar')).not.toContain('padding-left');
    expect(cssRule('.app-shell:not(.has-sidebar) .window-toolbar')).not.toMatch(/padding:/);
    expect(paddingLeftPx(cssRule('.window-toolbar'))).toBe(TOGGLE_LEFT_PAD_PX);
  });

  it('meets the backlink box edge to the toggle edge (zero gutter)', () => {
    // Hug width (19 + 29 = 48px) plus zero left gutter: the backlink box
    // starts exactly where the toggle ends.
    expect(TOGGLE_LEFT_PAD_PX + TOGGLE_WIDTH_PX).toBe(48);
    expect(cssRule('.app-shell:not(.has-sidebar) .main-toolbar')).toMatch(/padding-left:\s*0/);
    // The chevron glyph still clears the toggle via the backlink's own
    // internal padding — flush boxes, not touching glyphs.
    expect(paddingLeftPx(cssRule('.photo-backlink'))).toBeGreaterThan(0);
  });

  it('leaves the open-sidebar toolbar geometry untouched', () => {
    expect(cssRule('.window-toolbar')).toMatch(/width:\s*var\(--sidebar-width\)/);
    expect(cssRule('.window-toolbar')).toMatch(/padding:\s*0 17px 0 19px/);
    expect(paddingLeftPx(cssRule('.main-toolbar'))).toBe(7);
    // The open layout never sees the zero-gutter override.
    expect(cssRule('.main-toolbar')).not.toContain('padding-left:');
  });

  it('keeps the backlink flush at the overlay-sidebar breakpoint too', () => {
    const block = mediaBlock('max-width: 1020px');
    expect(block.length).toBeGreaterThan(0);
    // Open keeps its narrowed column; collapsed keeps hugging (the old
    // combined 124px selector would have re-opened the gap here).
    expect(cssRule('.window-toolbar', block)).toMatch(/width:\s*124px/);
    const collapsed = cssRule('.app-shell:not(.has-sidebar) .window-toolbar', block);
    expect(collapsed).toMatch(/width:\s*auto/);
    expect(collapsed).toMatch(/padding-right:\s*0/);
    expect(css()).not.toMatch(/\.window-toolbar,\s*\.app-shell:not\(\.has-sidebar\) \.window-toolbar\s*\{[^}]*width:\s*124px/);
  });

  it('leaves the small-screen grid toolbar alone (already flush)', () => {
    // Mobile centers the toggle in a 42px grid cell directly beside the
    // breadcrumb cell — no dead column exists there to fix.
    const block = mediaBlock('max-width: 760px');
    expect(block).toMatch(/\.window-toolbar,\s*\.app-shell:not\(\.has-sidebar\) \.window-toolbar\s*\{[^}]*width:\s*42px[^}]*justify-content:\s*center/);
  });

  it('renders the toggle column immediately before the backlink column', () => {
    // The CSS adjacency assumes DOM adjacency: nothing may sit between
    // the toggle cell and the breadcrumb cell.
    const html = renderToolbar();
    expect(html).toMatch(/<div class="window-toolbar">[\s\S]*?<\/div>\s*<div class="main-toolbar">/);
    const toggleCell = html.match(/<div class="window-toolbar">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(toggleCell).toContain('Toggle library sidebar');
    const breadcrumb = html.match(/<div class="collection-breadcrumb">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(breadcrumb).toContain('photo-backlink');
  });
});
