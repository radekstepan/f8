import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { AdjustmentSection } from './AdjustmentSection.js';
import { Inspector } from './Inspector.js';
import type { DustSpotsAssist, ObjectRemovalAssist, RepairAssist } from './Inspector.js';

// Shared collapse/expand panels + the ~1px collapse shift, rendered on the
// server (no jsdom): pins that every inspector panel reuses the one shared
// disclosure component, that its header markup is identical open and
// collapsed (so toggling cannot shift text), and that the CSS keeps the
// heading height and scrollbar gutter stable across the toggle.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');
const source = (file: string) => readFileSync(resolve(here, file), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

function makePhoto(): Photo {
  return {
    id: 'p1',
    name: 'DSC06308.ARW',
    title: 'Alpine morning',
    src: 'http://localhost/photo.jpg',
    thumbnail: 'http://localhost/thumb.jpg',
    albumId: 'a1',
    location: 'Dolomites',
    date: '2024-01-01',
    width: 3000,
    height: 2000,
    camera: 'Test camera',
    lens: 'Test lens',
    iso: 100,
    aperture: 'f/8',
    shutter: '1/250',
    focalLength: '35mm',
    raw: false,
    favorite: false,
    rating: 0,
  };
}

const noop = () => {};

const idleRemoval: ObjectRemovalAssist = {
  state: 'idle',
  detections: [],
  source: null,
  progress: null,
  note: null,
  message: null,
  onDetect: noop,
  onToggle: noop,
  onApply: noop,
  onDismiss: noop,
};

const idleDustSpots: DustSpotsAssist = {
  state: 'idle',
  spots: [],
  source: null,
  progress: null,
  note: null,
  message: null,
  onDetect: noop,
  onToggle: noop,
  onApply: noop,
  onDismiss: noop,
};

function renderInspector(tool: 'adjust' | 'repair'): string {
  const repairAssist: RepairAssist = {
    method: 'heal',
    quality: 'balanced',
    seamlessLight: false,
    featherPx: 2,
    status: 'ready',
    mlProgress: null,
    serverDown: false,
    onRetry: noop,
    onMethodChange: noop,
    onQualityChange: noop,
    onSeamlessLightChange: noop,
    onFeatherChange: noop,
    removal: idleRemoval,
    dustSpots: idleDustSpots,
  };
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool={tool}
      histogram={null}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      {...(tool === 'repair' ? { repairAssist } : {})}
      onChange={noop}
      onRotate={noop}
      onStraighten={noop}
      onReset={noop}
      onAuto={noop}
      onRevertEnhance={noop}
      onAutoWhiteBalance={noop}
      onAutoLightness={noop}
      onAutoColor={noop}
      onRevertWhiteBalance={noop}
      onRevertLightness={noop}
      onRevertColor={noop}
      onCopy={noop}
      onPaste={noop}
      onSavePreset={noop}
      onBrushSize={noop}
      onBrushStrength={noop}
      onClose={noop}
    />,
  );
}

/** The disclosure-button header of one section, for open/collapsed comparison. */
function disclosureOf(html: string): string {
  return html.match(/<button class="section-disclosure"[\s\S]*?<\/button>/)?.[0] ?? '';
}

/** The header actions row of one section, for open/collapsed comparison. */
function actionsOf(html: string): string {
  return html.match(/<div class="section-actions">[\s\S]*?<\/div>/)?.[0] ?? '';
}

describe('shared collapse panels', () => {
  it('renders every Repair panel through the shared disclosure', () => {
    const html = renderInspector('repair');
    const titles = ['Brush', 'Reconstruction', 'One-Click Removal', 'Dust Spots', 'Repairs'];
    // One section + one disclosure header per panel, no second implementation.
    // (The trailing character class excludes the per-header adjustment-section-icon.)
    expect(html.match(/class="adjustment-section[ "]/g)?.length).toBe(titles.length);
    expect(html.match(/class="section-disclosure"/g)?.length).toBe(titles.length);
    for (const title of titles) {
      const heading = html.match(new RegExp(`<button class="section-disclosure"[\\s\\S]*?<h3>${title}</h3>`));
      expect(heading, `${title} sits inside the shared disclosure`).not.toBeNull();
    }
  });

  it('renders every adjust panel through the same shared disclosure', () => {
    const html = renderInspector('adjust');
    // No assists passed, so no ML sections; Curves/Effects/Details
    // start collapsed but their headings still render. Auto Enhance is no
    // panel at all — it lives in the Color Adjustments header.
    const titles = ['White Balance', 'Lightness', 'Hue &amp; Saturation', 'Curves', 'Details', 'Effects'];
    expect(html.match(/class="adjustment-section[ "]/g)?.length).toBe(titles.length);
    expect(html.match(/class="section-disclosure"/g)?.length).toBe(titles.length);
    for (const title of titles) {
      const heading = html.match(new RegExp(`<button class="section-disclosure"[\\s\\S]*?<h3>${title}</h3>`));
      expect(heading, `${title} sits inside the shared disclosure`).not.toBeNull();
    }
  });

  it('keeps the single disclosure implementation in the shared module', () => {
    const inspector = source('Inspector.tsx');
    // Inspector consumes the component; it owns no disclosure markup itself.
    expect(inspector).toContain("from './AdjustmentSection.js'");
    expect(inspector).toContain('<AdjustmentSection');
    expect(inspector).not.toContain('section-disclosure');
    expect(inspector).not.toContain('adjustment-heading');
    // Exactly one disclosure header implementation, in the shared module.
    const shared = source('AdjustmentSection.tsx');
    expect(shared.match(/section-disclosure/g)?.length).toBe(1);
    expect(shared.match(/adjustment-heading/g)?.length).toBe(1);
  });

  it('renders an identical header open and collapsed, modulo chevron + aria', () => {
    const render = (open: boolean) =>
      renderToStaticMarkup(
        <AdjustmentSection
          title="Dust Spots"
          icon={<i />}
          badge={<span className="ml-badge">ML</span>}
          ml={{ id: 'dust-spots', applied: false, canRevert: false, onToggle: noop, onRevert: noop }}
          onReset={noop}
          dirty
          open={open}
        >
          <span>content-stub</span>
        </AdjustmentSection>,
      );
    const normalize = (html: string) =>
      disclosureOf(html)
        .replace(/aria-expanded="(true|false)"/, 'aria-expanded=X')
        .replace(/lucide-chevron-(down|right)/, 'lucide-chevron-X')
        .replace(/<path d="[^"]*"><\/path>/, '<path d=X/>');
    const open = render(true);
    const collapsed = render(false);
    expect(disclosureOf(open).length).toBeGreaterThan(0);
    expect(disclosureOf(collapsed).length).toBeGreaterThan(0);
    expect(open).toContain('content-stub');
    expect(collapsed).not.toContain('content-stub');
    // Same box for both chevrons, so the swap cannot move the title.
    for (const html of [open, collapsed]) {
      expect(disclosureOf(html)).toMatch(/<svg[^>]*width="12"[^>]*height="12"/);
    }
    expect(normalize(open)).toBe(normalize(collapsed));
    // The header controls ride along: collapsing hides the content, never
    // the reset or the action — the actions row is byte-identical.
    expect(actionsOf(open).length).toBeGreaterThan(0);
    expect(actionsOf(open)).toBe(actionsOf(collapsed));
  });

  it('keeps the collapsed heading the same height as the open one', () => {
    // The ~1px shift: collapsed headings used to be 1px shorter (40px vs
    // 41px), nudging every panel below on each toggle.
    expect(cssRule('.adjustment-heading')).toMatch(/min-height\s*:\s*41px/);
    expect(cssRule('.adjustment-section.is-collapsed .adjustment-heading')).toBe('');
    expect(css()).not.toMatch(/\.adjustment-section\.is-collapsed \.adjustment-heading\s*\{\s*min-height/);
  });

  it('reserves the inspector scrollbar gutter so toggling never reflows text', () => {
    // Collapsing a panel can drop the inspector below its overflow
    // threshold; without a stable gutter the vanishing scrollbar hands its
    // width back to the content and every line jumps sideways.
    expect(cssRule('.inspector-scroll')).toMatch(/scrollbar-gutter\s*:\s*stable/);
  });
});
