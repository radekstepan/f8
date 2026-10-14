import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdjustmentSection } from './AdjustmentSection.js';
import { IconButton, MlBadge, RangeControl, SegmentedControl, Toggle } from './EditorUI.js';
import { Toolbar } from './Topbar.js';
import { TOOLTIP_ATTRIBUTE, Tooltip, TooltipHost, positionTooltip, tooltipProps } from './Tooltip.js';

// Custom tooltips, rendered on the server (no jsdom): pins the
// viewport-safe positioning math, the data-tooltip markup contract, the
// app-wide absence of native title tooltips, and the themed bubble CSS.
// Hover/focus behavior lives in TooltipHost effects, which never run here.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

const noop = () => {};

describe('positionTooltip', () => {
  const viewport = { width: 800, height: 600 };
  const tip = { width: 120, height: 30 };

  it('centers above the trigger by default', () => {
    expect(positionTooltip({ x: 100, y: 200, width: 50, height: 20 }, tip, viewport)).toEqual({
      x: 65,
      y: 162,
      placement: 'top',
    });
  });

  it('flips below the trigger near the top edge', () => {
    expect(positionTooltip({ x: 100, y: 10, width: 50, height: 20 }, tip, viewport)).toEqual({
      x: 65,
      y: 38,
      placement: 'bottom',
    });
  });

  it('clamps to the left and right edges', () => {
    const right = positionTooltip({ x: 760, y: 200, width: 30, height: 20 }, tip, viewport);
    expect(right.x).toBe(672);
    const left = positionTooltip({ x: 0, y: 200, width: 10, height: 20 }, tip, viewport);
    expect(left.x).toBe(8);
  });

  it('parks at the padding when the bubble is wider than the viewport', () => {
    const wide = positionTooltip({ x: 100, y: 200, width: 50, height: 20 }, { width: 900, height: 30 }, viewport);
    expect(wide.x).toBe(8);
  });

  it('honors a bottom preference, flipping up near the bottom edge', () => {
    const fits = positionTooltip({ x: 100, y: 200, width: 50, height: 20 }, tip, viewport, { placement: 'bottom' });
    expect(fits).toEqual({ x: 65, y: 228, placement: 'bottom' });
    const flips = positionTooltip({ x: 100, y: 570, width: 50, height: 20 }, tip, viewport, { placement: 'bottom' });
    expect(flips).toEqual({ x: 65, y: 532, placement: 'top' });
  });

  it('clamps inside when neither side fits whole', () => {
    const tiny = { width: 400, height: 100 };
    const placed = positionTooltip({ x: 100, y: 40, width: 50, height: 20 }, { width: 120, height: 90 }, tiny);
    expect(placed.placement).toBe('bottom');
    expect(placed.y).toBe(8);
    expect(placed.x).toBeGreaterThanOrEqual(8);
    expect(placed.x + 120).toBeLessThanOrEqual(400 - 8);
  });

  it('respects custom gap and padding', () => {
    const placed = positionTooltip({ x: 0, y: 200, width: 10, height: 20 }, tip, viewport, { gap: 2, padding: 20 });
    expect(placed).toEqual({ x: 20, y: 168, placement: 'top' });
  });
});

describe('tooltipProps', () => {
  it('renders the attribute only for non-empty text', () => {
    expect(tooltipProps('Undo (Ctrl Z)')).toEqual({ [TOOLTIP_ATTRIBUTE]: 'Undo (Ctrl Z)' });
    expect(tooltipProps('')).toEqual({});
    expect(tooltipProps(undefined)).toEqual({});
    expect(tooltipProps(null)).toEqual({});
  });
});

describe('tooltip triggers', () => {
  it('renders icon buttons with data-tooltip and no native title', () => {
    const html = renderToStaticMarkup(<IconButton label="Undo (Ctrl Z)" onClick={noop}><i /></IconButton>);
    expect(html).toContain('data-tooltip="Undo (Ctrl Z)"');
    expect(html).toContain('aria-label="Undo (Ctrl Z)"');
    expect(html).not.toContain('title=');
  });

  it('renders toggles with data-tooltip and no native title', () => {
    const html = renderToStaticMarkup(<Toggle checked={false} onChange={noop} label="Denoise enabled" />);
    expect(html).toContain('data-tooltip="Denoise enabled"');
    expect(html).not.toContain('title=');
  });

  it('renders ML badges with data-tooltip only when a hint is given', () => {
    expect(renderToStaticMarkup(<MlBadge hint="Neural fill on the photo server" />)).toBe(
      '<span class="ml-badge" data-tooltip="Neural fill on the photo server">ML</span>',
    );
    expect(renderToStaticMarkup(<MlBadge />)).toBe('<span class="ml-badge">ML</span>');
  });

  it('renders segmented options with data-tooltip and no native title', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        label="Repair search effort"
        testId="heal-quality-group"
        value="balanced"
        onChange={noop}
        options={[
          { value: 'fast', label: 'Fast', hint: 'Fast fill', testId: 'heal-quality-fast' },
          { value: 'balanced', label: 'Balanced', hint: 'Balanced fill', testId: 'heal-quality-balanced' },
        ]}
      />,
    );
    expect(html).toContain('data-tooltip="Fast fill"');
    expect(html).not.toContain('title=');
  });

  it('renders the section ML action with data-tooltip and no native title', () => {
    const html = renderToStaticMarkup(
      <AdjustmentSection
        title="White Balance"
        icon={<i />}
        ml={{ id: 'white-balance', applied: false, onToggle: noop }}
      >
        <span />
      </AdjustmentSection>,
    );
    expect(html).toContain('data-tooltip="Automatically adjust white balance with ML"');
    expect(html).not.toContain('title=');
  });

  it('renders the slider reset hint as data-tooltip', () => {
    const html = renderToStaticMarkup(<RangeControl label="Exposure" value={0} onChange={noop} />);
    expect(html).toContain('data-tooltip="Double-click to reset exposure"');
    expect(html).not.toContain('title=');
  });

  it('renders toolbar triggers with data-tooltip and no native title', () => {
    const html = renderToStaticMarkup(
      <Toolbar
        collectionName="All Photos"
        count={3}
        tool="adjust"
        compare={false}
        canUndo={false}
        canRedo={false}
        showBacklink
        onTool={noop}
        onAction={noop}
        onDialog={noop}
      />,
    );
    expect(html).toContain('data-tooltip="Back to All Photos (G)"');
    expect(html).toContain('data-tooltip="Adjust"');
    expect(html).not.toContain('title=');
  });
});

describe('TooltipHost', () => {
  it('renders nothing on the server (the bubble only exists in the browser)', () => {
    expect(renderToStaticMarkup(<TooltipHost />)).toBe('');
  });

  it('wraps opt-in triggers without disturbing layout', () => {
    expect(renderToStaticMarkup(<Tooltip content="Hi"><b>x</b></Tooltip>)).toBe(
      '<span class="tooltip-anchor" data-tooltip="Hi"><b>x</b></span>',
    );
    expect(renderToStaticMarkup(<Tooltip content="Hi" placement="bottom"><b>x</b></Tooltip>)).toBe(
      '<span class="tooltip-anchor" data-tooltip="Hi" data-tooltip-placement="bottom"><b>x</b></span>',
    );
  });
});

describe('no native tooltips', () => {
  // Every remaining `title=` in component sources must be a heading prop
  // (Modal, AdjustmentSection, PhotoBrowser, FsBrowser) — never a native
  // tooltip on a host element. Additions fail here until migrated.
  const sources = [
    'EditorUI.tsx',
    'AdjustmentSection.tsx',
    'Topbar.tsx',
    'Inspector.tsx',
    'PhotoStrips.tsx',
    'PhotoCanvas.tsx',
    'EditorDialogs.tsx',
    '../../../../apps/web/src/App.tsx',
    '../../../../apps/web/src/components/FsBrowser.tsx',
  ];
  const headingTags = ['Modal', 'AdjustmentSection', 'PhotoBrowser', 'FsBrowser'];

  for (const name of sources) {
    it(`leaves no native title tooltip in ${name.split('/').pop()}`, () => {
      const text = readFileSync(resolve(here, name), 'utf8');
      for (const match of text.matchAll(/title=/g)) {
        const before = text.slice(0, match.index);
        // The enclosing tag: the last `<Tag` with no angle bracket between
        // it and the attribute (single- and multi-line tags alike).
        const tag = before.match(/<([A-Za-z][A-Za-z0-9]*)[^<>]*$/)?.[1] ?? '?';
        const line = before.slice(before.lastIndexOf('\n') + 1).trim().slice(0, 100);
        expect(headingTags.includes(tag), `native title tooltip on <${tag}: ${line}`).toBe(true);
      }
    });
  }
});

describe('tooltip theme', () => {
  it('floats a fixed bubble above every overlay', () => {
    const bubble = cssRule('.f8-tooltip');
    expect(bubble).toMatch(/position\s*:\s*fixed/);
    expect(bubble).toMatch(/z-index\s*:\s*300/);
    expect(bubble).toMatch(/pointer-events\s*:\s*none/);
    expect(bubble).toMatch(/max-width\s*:\s*260px/);
  });

  it('matches the dropdown/menu theme', () => {
    const bubble = cssRule('.f8-tooltip');
    expect(bubble).toMatch(/background\s*:\s*#303033f5/);
    expect(bubble).toMatch(/border\s*:\s*1px solid #515157/);
    expect(bubble).toMatch(/color\s*:\s*#ececef/);
    const menu = cssRule('.dropdown-menu');
    expect(menu).toContain('#303033f5');
    expect(menu).toContain('#515157');
  });

  it('respects reduced motion and keeps the anchor inline', () => {
    expect(css()).toMatch(/prefers-reduced-motion[\s\S]*?\.f8-tooltip\s*\{\s*animation\s*:\s*none/);
    expect(cssRule('.tooltip-anchor')).toMatch(/display\s*:\s*inline-flex/);
  });
});
