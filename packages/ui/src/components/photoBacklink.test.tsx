import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Photo backlink: the toolbar offers a way back to the collection from an
// open photo — and only from an open photo. Previously the breadcrumb
// fired the 'grid' toggle in both views, so clicking "All Photos" in the
// library grid carried the user into a single photo. Now the editor shows
// a backlink pill that dispatches the one-directional 'back' action,
// while the library grid shows the same block as static text with no
// control at all. Rendered on the server (no jsdom): pins the markup +
// prop wiring, with the action wiring pinned from the Topbar/App sources
// (the topbarMenus.test.tsx precedent) and the pill styling pinned from
// the stylesheet.

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

/** The breadcrumb block's markup (backlink pill or static title). */
function breadcrumb(html: string): string {
  return html.match(/<div class="collection-breadcrumb">[\s\S]*?<\/div>/)?.[0] ?? '';
}

describe('photo backlink', () => {
  it('shows the backlink pill on an open photo, naming the collection', () => {
    const html = renderToolbar(true);
    const crumb = breadcrumb(html);
    expect(crumb).toContain('photo-backlink');
    expect(crumb).toContain('All Photos');
    expect(crumb).toContain('3 photos');
    expect(crumb).toMatch(/aria-label="Back to All Photos"/);
    // A chevron leads the pill (lucide chevron-left), not a bare arrow icon.
    expect(crumb).toContain('lucide-chevron-left');
    expect(crumb).not.toContain('collection-title');
  });

  it('renders one control on a photo: a single button for the whole pill', () => {
    const crumb = breadcrumb(renderToolbar(true));
    expect(crumb.match(/<button/g)?.length).toBe(1);
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
    expect(crumb).not.toContain('<button');
    expect(crumb).not.toContain('photo-backlink');
    expect(crumb).not.toContain('lucide-chevron-left');
  });

  it('styles the pill with a hover state and a nudging chevron', () => {
    expect(cssRule('.photo-backlink')).toMatch(/border-radius/);
    expect(cssRule('.photo-backlink:hover')).toMatch(/background/);
    // The chevron eases left on hover for a tactile pull-back feel.
    expect(css()).toMatch(/\.photo-backlink:hover[^{]*\{[^}]*translateX\(-/);
    expect(cssRule('.backlink-chevron')).toMatch(/transition/);
  });

  it('keeps the backlink independent of the sidebar (toolbar-owned, always mounted)', () => {
    // The Toolbar takes no sidebar prop: the pill cannot depend on it.
    expect(topbarSource()).not.toMatch(/interface ToolbarProps \{[^}]*\bsidebar\b/);
    // And no backlink/breadcrumb selector is gated on the sidebar class.
    const gated = css().match(/[^{}]*\.has-sidebar[^{}]*\{[^}]*\}/g) ?? [];
    expect(gated.filter((rule) => rule.includes('breadcrumb') || rule.includes('backlink'))).toEqual([]);
    // The small-screen layout keeps the pill clickable (the old arrow hid).
    expect(css()).not.toMatch(/\.photo-backlink[^{]*\{[^}]*display:\s*none/);
  });
});
