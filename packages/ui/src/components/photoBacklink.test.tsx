import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Photo backlink: the toolbar offers a way back to the collection from an
// open photo — and only from an open photo. The editor shows a quiet
// single-line ghost button (chevron + collection name) that dispatches the
// one-directional 'back' action, while the library grid shows the same
// block as static text with no control at all. Rendered on the server
// (no jsdom): pins the markup + prop wiring, with the action wiring pinned
// from the Topbar/App sources (the topbarMenus.test.tsx precedent) and the
// button styling pinned from the stylesheet.

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../../../apps/web/src');
const css = () => readFileSync(resolve(webRoot, 'index.css'), 'utf8');
const topbarSource = () => readFileSync(resolve(here, 'Topbar.tsx'), 'utf8');
const appSource = () => readFileSync(resolve(webRoot, 'App.tsx'), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

const noop = () => {};

function renderToolbar(showBacklink: boolean): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool="adjust"
      compare={false}
      canUndo
      canRedo={false}
      showBacklink={showBacklink}
      onTool={noop}
      onAction={noop}
      onDialog={noop}
    />,
  );
}

/** The breadcrumb block's markup (backlink button or static title). */
function breadcrumb(html: string): string {
  return html.match(/<div class="collection-breadcrumb">[\s\S]*?<\/div>/)?.[0] ?? '';
}

describe('photo backlink', () => {
  it('shows a single-line backlink on an open photo, naming the collection', () => {
    const html = renderToolbar(true);
    const crumb = breadcrumb(html);
    expect(crumb).toContain('photo-backlink');
    expect(crumb).toContain('All Photos');
    expect(crumb).toMatch(/aria-label="Back to All Photos"/);
    // A chevron leads the button (lucide chevron-left), decorative only.
    expect(crumb).toContain('lucide-chevron-left');
    expect(crumb).toContain('backlink-chevron');
    expect(crumb).toMatch(/aria-hidden="true"/);
    // Single line: no count line, no stacked text block — the count lives
    // in the grid title and the status bar, not on the way back.
    expect(crumb).not.toContain('3 photos');
    expect(crumb).not.toContain('backlink-text');
    expect(crumb).not.toContain('<small');
    expect(crumb).not.toContain('collection-title');
  });

  it('renders one control on a photo: a single button for the whole backlink', () => {
    const crumb = breadcrumb(renderToolbar(true));
    expect(crumb.match(/<button/g)?.length).toBe(1);
  });

  it('advertises the G shortcut in the tooltip', () => {
    const crumb = breadcrumb(renderToolbar(true));
    expect(crumb).toContain('Back to All Photos (G)');
  });

  it('dispatches the one-directional back action, never the grid toggle', () => {
    const source = topbarSource();
    const backlinkLine = source.split('\n').find((line) => line.includes('photo-backlink') && line.includes('onClick')) ?? '';
    expect(backlinkLine).toContain("onAction('back')");
    expect(backlinkLine).not.toContain("onAction('grid')");
    // The App handler for it sets the library view unconditionally.
    expect(appSource()).toMatch(/case 'back':\s*setView\('library'\); break;/);
  });

  it('shows no control at all in the library grid — static title only', () => {
    const crumb = breadcrumb(renderToolbar(false));
    expect(crumb).toContain('collection-title');
    expect(crumb).toContain('All Photos');
    expect(crumb).toContain('3 photos');
    expect(crumb).toContain('collection-count');
    expect(crumb).not.toContain('<button');
    expect(crumb).not.toContain('photo-backlink');
    expect(crumb).not.toContain('lucide-chevron-left');
  });

  it('styles the backlink as a ghost button with a nudging chevron', () => {
    expect(cssRule('.photo-backlink')).toMatch(/border-radius/);
    expect(cssRule('.photo-backlink:hover')).toMatch(/background/);
    // The chevron eases left on hover for a tactile pull-back feel.
    expect(css()).toMatch(/\.photo-backlink:hover[^{]*\{[^}]*translateX\(-/);
    expect(cssRule('.backlink-chevron')).toMatch(/transition/);
    // Long collection names ellipsize instead of pushing the tools aside.
    expect(cssRule('.backlink-name')).toMatch(/text-overflow:\s*ellipsis/);
    expect(cssRule('.backlink-name')).toMatch(/max-width/);
    // Keyboard users get the shared visible focus ring (global button rule).
    expect(css()).toMatch(/button:focus-visible[^{]*\{[^}]*outline/);
  });

  it('keeps the backlink independent of the sidebar (toolbar-owned, always mounted)', () => {
    // The Toolbar takes no sidebar prop: the backlink cannot depend on it.
    expect(topbarSource()).not.toMatch(/interface ToolbarProps \{[^}]*\bsidebar\b/);
    // And no backlink/breadcrumb selector is gated on the sidebar class.
    const gated = css().match(/[^{}]*\.has-sidebar[^{}]*\{[^}]*\}/g) ?? [];
    expect(gated.filter((rule) => rule.includes('breadcrumb') || rule.includes('backlink'))).toEqual([]);
    // The small-screen layout keeps the button clickable (never hidden).
    expect(css()).not.toMatch(/\.photo-backlink[^{]*\{[^}]*display:\s*none/);
    // The breadcrumb flexes instead of reserving a fixed slot, so the
    // narrower window-toolbar (sidebar off) never squeezes it out.
    expect(cssRule('.collection-breadcrumb')).toMatch(/min-width:\s*0/);
  });
});
