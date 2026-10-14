import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Pending photo backlink: on a hard reload of a photo URL the collection
// state starts at the 'all' placeholder and the photo's album is adopted
// only after the first paint. The toolbar must show nothing (an empty
// shimmer placeholder) rather than flash the wrong "All Photos" name.
// Rendered on the server (no jsdom): pins the markup + prop wiring, with
// the App wiring pinned from source (the photoBacklink.test.tsx precedent)
// and the placeholder styling pinned from the stylesheet.

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../../../apps/web/src');
const css = () => readFileSync(resolve(webRoot, 'index.css'), 'utf8');
const appSource = () => readFileSync(resolve(webRoot, 'App.tsx'), 'utf8');

const cssRule = (selector: string): string => {
  // Anchored at line start so indented reduced-motion overrides never win
  // over the top-level rule.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';
};

const noop = () => {};

function renderToolbar(collectionName: string | null, showBacklink = true): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName={collectionName}
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

/** The breadcrumb block's markup (backlink button, pending slot, or static title). */
function breadcrumb(html: string): string {
  return html.match(/<div class="collection-breadcrumb">[\s\S]*?<\/div>/)?.[0] ?? '';
}

describe('pending photo backlink', () => {
  it('shows an empty placeholder — no button, no name — while the collection is unknown', () => {
    const crumb = breadcrumb(renderToolbar(null));
    expect(crumb).toContain('backlink-pending');
    expect(crumb).not.toContain('<button');
    expect(crumb).not.toContain('photo-backlink');
    expect(crumb).not.toContain('Back to');
    // Decorative only: hidden from assistive tech until the real link lands.
    expect(crumb).toMatch(/aria-hidden="true"/);
  });

  it('treats an empty name as pending too (never renders an empty button)', () => {
    const crumb = breadcrumb(renderToolbar(''));
    expect(crumb).toContain('backlink-pending');
    expect(crumb).not.toContain('<button');
  });

  it('renders the real backlink unchanged once the collection is known', () => {
    const crumb = breadcrumb(renderToolbar('Dolomites'));
    expect(crumb).toContain('photo-backlink');
    expect(crumb).toContain('Dolomites');
    expect(crumb).not.toContain('backlink-pending');
  });

  it('leaves the library static title untouched', () => {
    const crumb = breadcrumb(renderToolbar('All Photos', false));
    expect(crumb).toContain('collection-title');
    expect(crumb).toContain('3 photos');
    expect(crumb).not.toContain('backlink-pending');
  });

  it('wires the App toolbar to the resolved backlink name, not the raw collection', () => {
    const source = appSource();
    // The toolbar names the resolved collection (null while unknown)…
    expect(source).toMatch(/collectionName=\{backlinkName\}/);
    expect(source).toMatch(/resolveBacklinkCollection\(view, photo/);
    expect(source).toMatch(/const backlinkName = backlinkCollection === null \? null/);
    // …which the inference gate settles: photo deep-links start unsettled
    // (the 'all' default is a placeholder there), grid loads start settled.
    expect(source).toMatch(/const \[collectionSettled, setCollectionSettled\] = useState\(start\.view === 'library'\)/);
    expect(source).toContain('setCollectionSettled(true)');
  });

  it('styles the placeholder as a shimmer pill (visible loading, no wrong text)', () => {
    const rule = cssRule('.backlink-pending');
    expect(rule).toMatch(/width:\s*118px/);
    expect(rule).toMatch(/border-radius/);
    expect(rule).toMatch(/linear-gradient/);
    expect(rule).toMatch(/backlink-shimmer/);
    expect(css()).toContain('@keyframes backlink-shimmer');
    // Reduced motion: the pill stays put instead of shimmering.
    expect(css()).toMatch(/prefers-reduced-motion[^{]*\{[\s\S]*?\.backlink-pending[\s\S]*?animation:\s*none/);
  });
});
