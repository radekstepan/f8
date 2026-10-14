import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Toolbar presets toggle position: the show/hide presets button sits
// directly between compare and info in the photo toolbar's actions row
// (reset, compare, presets, info, export), not ahead of reset. Rendered
// on the server (no jsdom): pins the markup order plus the narrow-viewport
// stylesheet hook (the presetPortraitWidth.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const webCss = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');

const noop = () => {};

function renderToolbar(presetsOpen: boolean): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool="adjust"
      compare={false}
      canUndo
      canRedo={false}
      showBacklink
      presetsOpen={presetsOpen}
      onTool={noop}
      onAction={noop}
      onDialog={noop}
      onTogglePresets={noop}
    />,
  );
}

/** Markup of the toolbar-actions block (reset, compare, presets toggle, info, export). */
function actionsBlock(html: string): string {
  return html.slice(html.indexOf('toolbar-actions'), html.indexOf('</header>'));
}

describe('toolbar presets toggle position', () => {
  for (const presetsOpen of [true, false]) {
    const label = presetsOpen ? 'Hide presets' : 'Show presets';
    it(`sits directly between compare and info while reading "${label}"`, () => {
      const actions = actionsBlock(renderToolbar(presetsOpen));
      const compare = actions.indexOf('aria-label="Compare with original (B)"');
      const presets = actions.indexOf(`aria-label="${label}"`);
      const info = actions.indexOf('aria-label="Photo information (I)"');
      for (const index of [compare, presets, info]) expect(index).toBeGreaterThanOrEqual(0);
      expect(compare).toBeLessThan(presets);
      expect(presets).toBeLessThan(info);
      // Adjacent on both sides: no other button opens between compare's
      // close and the toggle's open, nor between the toggle's close and
      // info's open.
      const compareClose = actions.indexOf('</button>', compare);
      const presetsOpenTag = actions.lastIndexOf('<button', presets);
      expect(presetsOpenTag).toBeGreaterThan(compareClose);
      expect(actions.slice(compareClose + '</button>'.length, presetsOpenTag)).not.toContain('<button');
      const presetsClose = actions.indexOf('</button>', presets);
      const infoOpen = actions.lastIndexOf('<button', info);
      expect(infoOpen).toBeGreaterThan(presetsClose);
      expect(actions.slice(presetsClose + '</button>'.length, infoOpen)).not.toContain('<button');
    });
  }

  it('keeps reset first in the actions row', () => {
    const actions = actionsBlock(renderToolbar(true));
    const firstOpen = actions.indexOf('<button');
    const resetOpen = actions.lastIndexOf('<button', actions.indexOf('aria-label="Reset to original"'));
    expect(resetOpen).toBe(firstOpen);
  });

  it('hides the reset button (by class hook) at narrow widths', () => {
    // The ≤850px rule used to hide the 2nd icon button positionally, so
    // every reorder silently changed which button vanished (info at init,
    // compare, then reset). The reset button now carries its own class and
    // the rule hides that class, so this reorder — and future ones — keep
    // hiding reset. Reset stays reachable via Edit > Reset All Adjustments.
    const css = webCss();
    const escaped = '.toolbar-actions > .toolbar-reset'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule).toMatch(/display\s*:\s*none/);
    expect(css).not.toContain('.toolbar-actions > .icon-button:nth-of-type');
    const resetTag = actionsBlock(renderToolbar(true)).match(/<button[^>]*aria-label="Reset to original"[^>]*>/)?.[0] ?? '';
    expect(resetTag).toContain('toolbar-reset');
  });
});
