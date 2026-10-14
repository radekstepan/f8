import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Pending photo backlink: on a hard reload of a photo URL the collection
// state starts at the 'all' placeholder and the photo's album is adopted
// only after the first paint. The toolbar must render nothing (an empty
// breadcrumb) rather than flash the wrong "All Photos" name — no shimmer
// bar, no placeholder pill — and then fade the backlink in with the album
// name once it is known. Rendered on the server (no jsdom): pins the
// markup + prop wiring, with the App wiring pinned from source (the
// photoBacklink.test.tsx precedent) and the fade-in pinned from the
// stylesheet.

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

/** The breadcrumb block's markup (backlink button, empty slot, or static title). */
function breadcrumb(html: string): string {
  return html.match(/<div class="collection-breadcrumb">[\s\S]*?<\/div>/)?.[0] ?? '';
}

describe('pending photo backlink', () => {
  it('renders nothing — no button, no name, no placeholder bar — while the collection is unknown', () => {
    const crumb = breadcrumb(renderToolbar(null));
    expect(crumb).toBe('<div class="collection-breadcrumb"></div>');
    expect(crumb).not.toContain('<button');
    expect(crumb).not.toContain('<span');
    expect(crumb).not.toContain('Back to');
  });

  it('treats an empty name as pending too (never renders an empty button)', () => {
    const crumb = breadcrumb(renderToolbar(''));
    expect(crumb).toBe('<div class="collection-breadcrumb"></div>');
    expect(crumb).not.toContain('<button');
  });

  it('renders the real backlink unchanged once the collection is known', () => {
    const crumb = breadcrumb(renderToolbar('Dolomites'));
    expect(crumb).toContain('photo-backlink');
    expect(crumb).toContain('Dolomites');
  });

  it('leaves the library static title untouched', () => {
    const crumb = breadcrumb(renderToolbar('All Photos', false));
    expect(crumb).toContain('collection-title');
    expect(crumb).toContain('3 photos');
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

  it('has no placeholder bar left in the stylesheet', () => {
    expect(css()).not.toContain('backlink-pending');
    expect(css()).not.toContain('backlink-shimmer');
  });

  it('fades the backlink in (opacity-only) once the album name lands', () => {
    expect(cssRule('.photo-backlink')).toMatch(/animation:\s*backlink-in\b/);
    const keyframes = css().match(/^@keyframes backlink-in\s*\{.*\}$/m)?.[0] ?? '';
    expect(keyframes).toMatch(/from\s*\{\s*opacity:\s*0/);
    expect(keyframes).toMatch(/to\s*\{\s*opacity:\s*1/);
    // Pure fade: no slide/scale — the link must not drift while appearing.
    expect(keyframes).not.toMatch(/transform/);
    // Reduced motion: the link appears instantly instead of fading.
    expect(css()).toMatch(/prefers-reduced-motion[^{]*\{[\s\S]*?\.photo-backlink[\s\S]*?animation:\s*none/);
  });
});
