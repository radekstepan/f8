import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { EditState, InpaintMethod, Photo } from '@f8/core';
import { CheckField, MenuSeparator, MlBadge, RevertButton, SegmentedControl } from './EditorUI.js';
import { EditorDialogs } from './EditorDialogs.js';
import { Inspector } from './Inspector.js';
import type { ObjectRemovalAssist, RepairAssist } from './Inspector.js';
import { PhotoBrowser } from './PhotoStrips.js';
import { useIsomorphicLayoutEffect } from '../hooks/useIsomorphicLayoutEffect.js';
import { isOutsideTargets } from '../hooks/useMenuDismiss.js';

// Shared UI primitives, rendered on the server (no jsdom): pins the exact
// markup each primitive emits, the consumers that render through them, and
// the no-copied-UI rule — component sources must use the shared primitives
// instead of pasting the same class names and listeners.

const here = dirname(fileURLToPath(import.meta.url));
const source = (name: string): string => readFileSync(resolve(here, name), 'utf8');

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

function renderRepair(method: InpaintMethod, removal?: ObjectRemovalAssist): string {
  const repairAssist: RepairAssist = {
    method,
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
    ...(removal === undefined ? {} : { removal }),
  };
  return renderToStaticMarkup(
    <Inspector
      photo={makePhoto()}
      edit={{ ...DEFAULT_EDIT }}
      tool="repair"
      histogram={null}
      brushSize={45}
      brushStrength={100}
      canPaste={false}
      repairAssist={repairAssist}
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

describe('shared primitives', () => {
  it('renders the ML badge with its hint tooltip', () => {
    expect(renderToStaticMarkup(<MlBadge hint="Does ML things" />))
      .toBe('<span class="ml-badge" title="Does ML things">ML</span>');
  });

  it('renders the ML badge without a tooltip when no hint is given', () => {
    expect(renderToStaticMarkup(<MlBadge />)).toBe('<span class="ml-badge">ML</span>');
  });

  it('renders the menu separator with the separator role', () => {
    expect(renderToStaticMarkup(<MenuSeparator />)).toBe('<div class="menu-separator" role="separator"></div>');
  });

  it('renders the revert button as the small undo icon with its testid', () => {
    const html = renderToStaticMarkup(<RevertButton testId="white-balance-ml-revert" label="Revert ML white balance" onClick={noop} />);
    expect(html).toContain('ml-revert');
    expect(html).toContain('data-testid="white-balance-ml-revert"');
    expect(html).toContain('aria-label="Revert ML white balance"');
    expect(html).toContain('lucide-undo-2');
  });

  it('renders the segmented group with its label, options, and active option', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        label="Repair search effort"
        testId="heal-quality-group"
        value="balanced"
        onChange={noop}
        options={[
          { value: 'fast', label: 'Fast', title: 'Fast fill', testId: 'heal-quality-fast' },
          { value: 'balanced', label: 'Balanced', title: 'Balanced fill', testId: 'heal-quality-balanced' },
        ]}
      />,
    );
    expect(html).toContain('<div class="segmented-control" role="group" aria-label="Repair search effort" data-testid="heal-quality-group">');
    expect(html).toContain('<button data-testid="heal-quality-fast" class="" title="Fast fill">Fast</button>');
    expect(html).toContain('<button data-testid="heal-quality-balanced" class="is-active" title="Balanced fill">Balanced</button>');
  });

  it('renders the checkbox row with a testid for detection confirm lists', () => {
    const html = renderToStaticMarkup(
      <CheckField testId="dust-spots-check-0" checked={true} onChange={noop}>Spot 1 · 92%</CheckField>,
    );
    expect(html).toBe('<label class="checkbox-field"><input type="checkbox" data-testid="dust-spots-check-0" checked=""/><span>Spot 1 · 92%</span></label>');
  });

  it('renders the checkbox row with an accessible label for export toggles', () => {
    const html = renderToStaticMarkup(
      <CheckField checked={false} disabled={false} onChange={noop} label="Super-resolution 2x">Super-resolution 2x</CheckField>,
    );
    expect(html).toContain('<label class="checkbox-field"><input type="checkbox" aria-label="Super-resolution 2x"/><span>Super-resolution 2x</span></label>');
  });
});

describe('shared primitive consumers', () => {
  it('renders the repair method and quality groups through the segmented control', () => {
    const html = renderRepair('heal');
    expect(html).toContain('data-testid="repair-method-group"');
    expect(html).toContain('<button data-testid="repair-method-heal" class="is-active" title="Repair: copies matching texture from nearby">Repair</button>');
    expect(html).toContain('data-testid="heal-quality-group"');
    expect(html).toContain('<button data-testid="heal-quality-balanced" class="is-active" title="Balanced: the default search reach and effort">Balanced</button>');
    // The neural tier drops the Fast option and renames the remaining hints.
    const ml = renderRepair('ml-heal');
    expect(ml).not.toContain('heal-quality-fast');
    expect(ml).toContain('title="Balanced: neural fill"');
  });

  it('renders the detection confirm rows through the shared checkbox', () => {
    const removal: ObjectRemovalAssist = {
      state: 'ready',
      detections: [{ label: 'person', score: 0.9, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, checked: true }],
      source: 'onnx',
      progress: null,
      note: null,
      message: null,
      onDetect: noop,
      onToggle: noop,
      onApply: noop,
      onDismiss: noop,
    };
    const html = renderRepair('heal', removal);
    expect(html).toContain('<input type="checkbox" data-testid="object-removal-check-0" checked=""/>');
    expect(html).toContain('Person 1 · 90% · ML');
  });

  it('separates context menu sections with the shared separator role', () => {
    const html = renderToStaticMarkup(
      <PhotoBrowser
        photos={[makePhoto()]}
        title="All Photos"
        search=""
        onSelect={noop}
        onFavorite={noop}
        onRemove={noop}
        onImport={noop}
        onSceneEnhance={noop}
        initialContextMenu={{ photoId: 'p1', x: 100, y: 120 }}
      />,
    );
    expect(html).toContain('<div class="menu-separator" role="separator"></div>');
  });

  it('renders the export 2x toggle through the shared checkbox and badge', () => {
    const html = renderToStaticMarkup(
      <EditorDialogs
        dialog="export"
        photo={makePhoto()}
        edit={{ ...DEFAULT_EDIT } as EditState}
        superres={{ run: async () => { throw new Error('unused'); }, health: async () => ({ ready: true, source: 'onnx', downloading: false, downloadPct: 1, error: null }) }}
        onClose={noop}
        onToast={noop}
        onCreateAlbum={noop}
        onSavePreset={noop}
        onRemovePhoto={noop}
      />,
    );
    expect(html).toContain('<label class="checkbox-field"><input type="checkbox" aria-label="Super-resolution 2x"/>');
    expect(html).toContain('<span class="ml-badge" title="Doubled by a machine-learning model on the photo server">ML</span>');
  });
});

describe('shared menu hooks', () => {
  it('treats targets outside every dismiss target as outside', () => {
    const inside = { current: { contains: (node: unknown) => node === 'in' } };
    expect(isOutsideTargets([inside], 'in')).toBe(false);
    expect(isOutsideTargets([inside], 'out')).toBe(true);
    expect(isOutsideTargets([inside, { current: null }, null, undefined], 'in')).toBe(false);
    expect(isOutsideTargets([inside, { current: null }, null, undefined], 'out')).toBe(true);
    expect(isOutsideTargets([], 'in')).toBe(true);
  });

  it('degrades to a plain effect on the server', () => {
    // This suite runs in node (no window), where measurement must not run
    // before paint — the hook is useEffect there by construction.
    expect(useIsomorphicLayoutEffect).toBe(useEffect);
  });
});

describe('no copied UI', () => {
  // Component sources must render through the shared primitives instead of
  // pasting the same class names, icons, and document listeners. EditorUI
  // owns the markup; useMenuDismiss owns menu dismissal.
  const cases: Array<[string, string[]]> = [
    ['Inspector.tsx', ['<span className="ml-badge"', '<div className="menu-separator"', '<div className="segmented-control"', '<label className="checkbox-field"', 'className="ml-revert"', "addEventListener('pointerdown'", "addEventListener('keydown'"]],
    ['Topbar.tsx', ['<span className="ml-badge"', '<div className="menu-separator"', "addEventListener('pointerdown'", "addEventListener('keydown'"]],
    ['PhotoStrips.tsx', ['<span className="ml-badge"', '<div className="menu-separator"', 'useIsomorphicLayoutEffect =', "addEventListener('pointerdown'", "addEventListener('keydown'"]],
    ['Sidebar.tsx', ['useIsomorphicLayoutEffect =', "addEventListener('pointerdown'", "addEventListener('keydown'", "addEventListener('scroll'", "addEventListener('resize'"]],
    ['EditorDialogs.tsx', ['<span className="ml-badge"', '<label className="checkbox-field"']],
    ['AdjustmentSection.tsx', ['className="ml-revert"', '<Undo2']],
  ];
  for (const [file, forbidden] of cases) {
    it(`${file} renders through the shared primitives`, () => {
      const text = source(file);
      for (const snippet of forbidden) {
        expect(text, `${file} must not paste ${snippet}`).not.toContain(snippet);
      }
    });
  }
});
