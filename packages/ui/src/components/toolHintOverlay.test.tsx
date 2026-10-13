import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { PhotoCanvas } from './PhotoCanvas.js';

// Repair tool hint: it must overlay the canvas without taking layout space,
// so showing/hiding it never shifts the photo (the old sticky in-flow hint
// inside the scroll stage changed the scroll height on mount/unmount).

function makePhoto(id: string): Photo {
  return {
    id,
    name: `${id}.ARW`,
    title: `Photo ${id}`,
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

const cssRule = (selector: string): string => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
  const css = readFileSync(cssPath, 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

const renderCanvas = (tool: 'repair' | 'adjust' | 'crop', straightenFlash?: { runId: number; message: string } | null) =>
  renderToStaticMarkup(
    <PhotoCanvas
      photo={makePhoto('p1')}
      edit={DEFAULT_EDIT}
      tool={tool}
      zoom={1}
      compare={false}
      showOriginal={false}
      brushSize={40}
      brushStrength={70}
      {...(straightenFlash ? { straightenFlash } : {})}
      onZoom={noop}
      onCompare={noop}
      onFavorite={noop}
      onRating={noop}
      onInfo={noop}
      onChange={noop}
      onHistogram={noop}
    />,
  );

/** Ancestor div classes of the element carrying the given data-testid. */
const ancestorClasses = (html: string, testId: string): string[] | null => {
  const stack: string[] = [];
  const tag = /<\/?div\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    const token = match[0];
    if (token.startsWith('</')) {
      stack.pop();
    } else {
      if (token.includes(`data-testid="${testId}"`)) return [...stack];
      stack.push(/\bclass="([^"]*)"/.exec(token)?.[1] ?? '');
    }
  }
  return null;
};

describe('repair tool hint overlay', () => {
  it('is an absolutely positioned overlay with no layout footprint', () => {
    const rule = cssRule('.tool-hint');
    expect(rule).toMatch(/position\s*:\s*absolute/);
    expect(rule).not.toMatch(/sticky/);
    expect(rule).not.toMatch(/margin\s*:/);
    expect(rule).toMatch(/pointer-events\s*:\s*none/);
  });

  it('stays horizontally centered at the bottom of the stage', () => {
    const rule = cssRule('.tool-hint');
    expect(rule).toMatch(/bottom\s*:\s*12px/);
    expect(rule).toMatch(/left\s*:\s*50%/);
    expect(rule).toMatch(/translateX\(-50%\)/);
  });

  it('renders outside the scroll stage so mount/unmount cannot shift the photo', () => {
    const ancestors = ancestorClasses(renderCanvas('repair'), 'tool-hint');
    expect(ancestors).not.toBeNull();
    expect(ancestors!.join(' ')).toContain('canvas-stage-wrap');
    expect(ancestors!.join(' ')).not.toContain('canvas-stage-inner');
    expect(ancestors!).not.toContain('canvas-stage');
  });

  it('keeps the photo frame centered inside the scroll stage', () => {
    const ancestors = ancestorClasses(renderCanvas('repair'), 'photo-frame');
    expect(ancestors).not.toBeNull();
    expect(ancestors!).toContain('canvas-stage-inner');
  });

  it('renders no hint for non-repair tools', () => {
    expect(renderCanvas('adjust')).not.toContain('data-testid="tool-hint"');
  });
});

describe('straighten no-horizon flash', () => {
  const flash = { runId: 3, message: 'No clear horizon found — adjust Straighten manually.' };

  it('flashes the message over the photo through the shared tool-hint overlay', () => {
    const html = renderCanvas('crop', flash);
    expect(html).toContain('data-testid="tool-hint"');
    expect(html).toContain('No clear horizon found — adjust Straighten manually.');
  });

  it('renders outside the scroll stage so mount/unmount cannot shift the photo', () => {
    const ancestors = ancestorClasses(renderCanvas('crop', flash), 'tool-hint');
    expect(ancestors).not.toBeNull();
    expect(ancestors!.join(' ')).toContain('canvas-stage-wrap');
    expect(ancestors!.join(' ')).not.toContain('canvas-stage-inner');
    expect(ancestors!).not.toContain('canvas-stage');
  });

  it('renders no hint without a flash, even in the crop tool', () => {
    expect(renderCanvas('crop')).not.toContain('data-testid="tool-hint"');
  });

  it('stays hidden outside the crop tool so a late result never surprises another tool', () => {
    expect(renderCanvas('adjust', flash)).not.toContain('data-testid="tool-hint"');
  });
});
