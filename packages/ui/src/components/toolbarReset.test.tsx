import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Topbar.js';

// Toolbar reset-to-original: the top bar leads its actions row with a reset
// action, so a photo can be restored to its original without opening the
// Edit menu. Rendered on the server (no jsdom): effects never run, so this
// pins the markup + prop wiring — the button order, the reset glyph, the
// disabled-when-clean gate, and the highlighted-when-edited state — with
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

/** Markup of the toolbar-actions block (reset, compare, presets toggle, remove, info, export). */
function actionsBlock(html: string): string {
  return html.slice(html.indexOf('toolbar-actions'), html.indexOf('</header>'));
}

describe('toolbar reset to original', () => {
  it('renders a reset button in the toolbar actions', () => {
    const actions = actionsBlock(renderToolbar());
    expect(actions).toContain('aria-label="Reset to original"');
    expect(actions).toContain('lucide-rotate-ccw');
  });

  it('leads the actions row with reset, ahead of compare and the presets toggle', () => {
    const actions = actionsBlock(renderToolbar());
    const reset = actions.indexOf('aria-label="Reset to original"');
    const compare = actions.indexOf('aria-label="Compare with original (B)"');
    const presets = actions.indexOf('aria-label="Hide presets"');
    const info = actions.indexOf('aria-label="Photo information (I)"');
    for (const index of [reset, compare, presets, info]) expect(index).toBeGreaterThanOrEqual(0);
    expect(reset).toBeLessThan(compare);
    expect(compare).toBeLessThan(presets);
    expect(presets).toBeLessThan(info);
    // Reset is the row's first button: nothing opens before it.
    const firstOpen = actions.indexOf('<button');
    const resetOpen = actions.lastIndexOf('<button', reset);
    expect(resetOpen).toBe(firstOpen);
    // Adjacent controls: no other button opens between reset's close and compare's open.
    const resetClose = actions.indexOf('</button>', reset);
    const compareOpen = actions.lastIndexOf('<button', compare);
    expect(compareOpen).toBeGreaterThan(resetClose);
    expect(actions.slice(resetClose + '</button>'.length, compareOpen)).not.toContain('<button');
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
    expect(topbarSource()).toContain(`label="Reset to original" className="toolbar-reset" active={canReset} disabled={!canReset} onClick={() => onAction('reset')}`);
    expect(appSource()).toContain("case 'reset': {");
  });

  it('highlights the reset button only when the image has edits', () => {
    for (const html of [renderToolbar(true), renderToolbar()]) {
      const resetTag = actionsBlock(html).match(/<button[^>]*aria-label="Reset to original"[^>]*>/)?.[0] ?? '';
      expect(resetTag).toContain('is-active');
      expect(resetTag).toContain('aria-pressed="true"');
    }
    const cleanTag = actionsBlock(renderToolbar(false)).match(/<button[^>]*aria-label="Reset to original"[^>]*>/)?.[0] ?? '';
    expect(cleanTag).not.toContain('is-active');
    expect(cleanTag).toContain('aria-pressed="false"');
  });

  it('derives canReset from the default-recipe check, mirroring reset() itself', () => {
    // useEditor.reset() reports "changed" exactly when !isDefaultEdit, so
    // the same predicate gates the button: enabled iff clicking resets.
    expect(appSource()).toContain('canReset={!isDefaultEdit(editor.edit)}');
    expect(appSource()).toContain('isDefaultEdit');
  });
});
