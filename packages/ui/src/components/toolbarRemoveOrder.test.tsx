import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Toolbar remove action position: the trash button moved out of the photo
// heading into the photo toolbar's actions row, directly left of the info
// button (reset, compare, presets, remove, info, export). Rendered on the
// server (no jsdom): pins the markup order plus the dispatch and the
// danger-hover stylesheet hook (the presetsToggleOrder.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const topbarSource = () => readFileSync(resolve(here, 'Topbar.tsx'), 'utf8');
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');
const webCss = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');

const noop = () => {};

function renderToolbar(presetsOpen = true, showPhotoTools = true): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool="adjust"
      compare={false}
      canUndo
      canRedo={false}
      showBacklink
      showPhotoTools={showPhotoTools}
      presetsOpen={presetsOpen}
      onTool={noop}
      onAction={noop}
      onDialog={noop}
      onTogglePresets={noop}
    />,
  );
}

/** Markup of the toolbar-actions block (reset, compare, presets toggle, remove, info, export). */
function actionsBlock(html: string): string {
  return html.slice(html.indexOf('toolbar-actions'), html.indexOf('</header>'));
}

describe('toolbar remove action position', () => {
  for (const presetsOpen of [true, false]) {
    const label = presetsOpen ? 'Hide presets' : 'Show presets';
    it(`sits directly left of info (after the presets toggle) while it reads "${label}"`, () => {
      const actions = actionsBlock(renderToolbar(presetsOpen));
      const presets = actions.indexOf(`aria-label="${label}"`);
      const remove = actions.indexOf('aria-label="Remove from library (Del)"');
      const info = actions.indexOf('aria-label="Photo information (I)"');
      for (const index of [presets, remove, info]) expect(index).toBeGreaterThanOrEqual(0);
      expect(presets).toBeLessThan(remove);
      expect(remove).toBeLessThan(info);
      // Adjacent on both sides: no other button opens between the toggle's
      // close and remove's open, nor between remove's close and info's open.
      const presetsClose = actions.indexOf('</button>', presets);
      const removeOpen = actions.lastIndexOf('<button', remove);
      expect(removeOpen).toBeGreaterThan(presetsClose);
      expect(actions.slice(presetsClose + '</button>'.length, removeOpen)).not.toContain('<button');
      const removeClose = actions.indexOf('</button>', remove);
      const infoOpen = actions.lastIndexOf('<button', info);
      expect(infoOpen).toBeGreaterThan(removeClose);
      expect(actions.slice(removeClose + '</button>'.length, infoOpen)).not.toContain('<button');
    });
  }

  it('renders the trash glyph under the toolbar-remove hook', () => {
    const actions = actionsBlock(renderToolbar());
    expect(actions).toContain('lucide-trash-2');
    const removeTag = actions.match(/<button[^>]*aria-label="Remove from library \(Del\)"[^>]*>/)?.[0] ?? '';
    expect(removeTag).toContain('toolbar-remove');
  });

  it('dispatches the shared remove action (same handler as Image > Remove from Library)', () => {
    expect(topbarSource()).toContain(`label="Remove from library (Del)" className="toolbar-remove" onClick={() => onAction('remove')}`);
    expect(appSource()).toContain("case 'remove': if (photo) requestRemove(photo.id); break;");
  });

  it('keeps the danger hover tint, now on the toolbar hook', () => {
    const css = webCss();
    const escaped = '.toolbar-actions .toolbar-remove:hover'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule).toMatch(/color\s*:\s*#f29c97/);
    expect(css).not.toContain('photo-remove');
  });

  it('is photo-only: absent from the library-grid toolbar', () => {
    expect(actionsBlock(renderToolbar(true, false))).not.toContain('Remove from library (Del)');
  });
});
