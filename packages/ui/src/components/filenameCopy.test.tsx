import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EDIT } from '@f8/core';
import type { Photo } from '@f8/core';
import { PhotoCanvas } from './PhotoCanvas.js';
import { copyTextToClipboard } from '../utils/clipboard.js';

// Clicking the filename in photo view copies it: the heading name is a
// button with a "Copy filename" tooltip, a copy icon revealed on hover,
// and a transient "Copied!" confirmation on success.

function makePhoto(overrides: Partial<Photo> = {}): Photo {
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
    ...overrides,
  };
}

const noop = () => {};

function renderCanvas(photo: Photo): string {
  return renderToStaticMarkup(
    <PhotoCanvas
      photo={photo}
      edit={{ ...DEFAULT_EDIT }}
      tool="adjust"
      zoom={1}
      compare={false}
      showOriginal={false}
      brushSize={45}
      brushStrength={100}
      onZoom={noop}
      onCompare={noop}
      onFavorite={noop}
      onRating={noop}
      onInfo={noop}
      onChange={noop}
      onHistogram={noop}
    />,
  );
}

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/index.css');
const fullCss = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fullCss().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('filename copy button', () => {
  it('renders the filename as a button with a copy hint', () => {
    const html = renderCanvas(makePhoto());
    expect(html).toContain('data-testid="filename-copy"');
    expect(html).toContain('data-tooltip="Copy filename"');
    expect(html).toContain('aria-label="Copy filename DSC06308.ARW"');
    expect(html).toMatch(/<button[^>]*data-testid="filename-copy"[^>]*><span>DSC06308\.ARW<\/span>/);
  });

  it('keeps the file-type badge and edited indicator next to the button', () => {
    const html = renderCanvas(makePhoto());
    expect(html.indexOf('data-testid="filename-copy"')).toBeLessThan(html.indexOf('file-type'));
  });

  it('styles the button as an affordance with a hover-revealed icon', () => {
    expect(cssRule('.filename-copy')).toMatch(/cursor\s*:\s*pointer/);
    expect(cssRule('.filename-copy > svg')).toMatch(/opacity\s*:\s*0/);
    expect(cssRule('.filename-copy:hover > svg, .filename-copy:focus-visible > svg, .filename-copy.is-copied > svg')).toMatch(
      /opacity\s*:\s*1/,
    );
  });

  it('tints the button while the copied confirmation shows', () => {
    expect(cssRule('.filename-copy.is-copied')).toMatch(/color\s*:\s*var\(--accent\)/);
  });
});

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyTextToClipboard('DSC06308.ARW')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('DSC06308.ARW');
  });

  it('falls back to execCommand when the Clipboard API is missing', async () => {
    vi.stubGlobal('navigator', {});
    const area = { value: '', style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn() };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(area),
      body: { appendChild, removeChild },
      execCommand,
    });
    await expect(copyTextToClipboard('DSC06308.ARW')).resolves.toBe(true);
    expect(area.value).toBe('DSC06308.ARW');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(removeChild).toHaveBeenCalledWith(area);
  });

  it('resolves false when no clipboard mechanism exists', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyTextToClipboard('DSC06308.ARW')).resolves.toBe(false);
  });

  it('resolves false instead of throwing when copying fails', async () => {
    // Rejected Clipboard API write, and no document for the legacy path.
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await expect(copyTextToClipboard('DSC06308.ARW')).resolves.toBe(false);
  });

  it('resolves false when the legacy copy reports failure', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue({ value: '', style: {}, setAttribute: vi.fn(), select: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: vi.fn().mockReturnValue(false),
    });
    await expect(copyTextToClipboard('DSC06308.ARW')).resolves.toBe(false);
  });
});
