import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Toolbar reset-to-original: the top bar carries a reset action directly
// next to the show/hide presets toggle, so a photo can be restored to its
// original without opening the Edit menu. Rendered on the server (no
// jsdom): effects never run, so this pins the markup + prop wiring — the
// button order, the reset glyph, and the disabled-when-clean gate — with
// the 'reset' dispatch and the App-side canReset derivation pinned from
// source (the topbarMenus.test.tsx precedent).

const here = dirname(fileURLToPath(import.meta.url));
const topbarSource = () => readFileSync(resolve(here, 'Topbar.tsx'), 'utf8');
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');

const noop = () => {};

function renderToolbar(canReset?: boolean): string {
  return renderToStaticMarkup(
    <Toolbar
      collectionName="All Photos"
      count={3}
      tool="adjust"
      compare={false}
      canUndo
      canRedo={false}
      showBacklink
      presetsOpen
      {...(canReset === undefined ? {} : { canReset })}
      onTool={noop}
      onAction={noop}
      onDialog={noop}
      onTogglePresets={noop}
    />,
  );
}

/** Markup of the toolbar-actions block (presets toggle, reset, compare, info, export). */
function actionsBlock(html: string): string {
  return html.slice(html.indexOf('toolbar-actions'), html.indexOf('</header>'));
}

describe('toolbar reset to original', () => {
  it('renders a reset button in the toolbar actions', () => {
    const actions = actionsBlock(renderToolbar());
    expect(actions).toContain('aria-label="Reset to original"');
    expect(actions).toContain('lucide-rotate-ccw');
  });

  it('places the reset button directly after the presets toggle', () => {
    const actions = actionsBlock(renderToolbar());
    const presets = actions.indexOf('aria-label="Hide presets"');
    const reset = actions.indexOf('aria-label="Reset to original"');
    const compare = actions.indexOf('aria-label="Compare with original (B)"');
    expect(presets).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(presets);
    expect(compare).toBeGreaterThan(reset);
    // Adjacent controls: no other button opens between the toggle's close and the reset's open.
    const toggleClose = actions.indexOf('</button>', presets);
    const resetOpen = actions.lastIndexOf('<button', reset);
    expect(resetOpen).toBeGreaterThan(toggleClose);
    expect(actions.slice(toggleClose + '</button>'.length, resetOpen)).not.toContain('<button');
  });

  it('disables the reset button only when there is nothing to reset', () => {
    const disabled = actionsBlock(renderToolbar(false));
    expect(disabled).toMatch(/<button[^>]*disabled[^>]*aria-label="Reset to original"|<button[^>]*aria-label="Reset to original"[^>]*disabled/);
    for (const html of [renderToolbar(true), renderToolbar()]) {
      const resetTag = actionsBlock(html).match(/<button[^>]*aria-label="Reset to original"[^>]*>/)?.[0] ?? '';
      expect(resetTag).not.toContain('disabled');
    }
  });

  it('dispatches the shared reset action (same handler as Edit > Reset All Adjustments)', () => {
    expect(topbarSource()).toContain(`label="Reset to original" disabled={!canReset} onClick={() => onAction('reset')}`);
    expect(appSource()).toContain("case 'reset': {");
  });

  it('derives canReset from the default-recipe check, mirroring reset() itself', () => {
    // useEditor.reset() reports "changed" exactly when !isDefaultEdit, so
    // the same predicate gates the button: enabled iff clicking resets.
    expect(appSource()).toContain('canReset={!isDefaultEdit(editor.edit)}');
    expect(appSource()).toContain('isDefaultEdit');
  });
});
