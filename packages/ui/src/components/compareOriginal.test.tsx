import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Compare must show the true original against the edit: while denoised
// pixels are applied the canvas shows a derived base, so the app has to hand
// PhotoCanvas the untouched src for its Original layer. The paint itself runs
// in an effect (unreachable from server rendering), so pin the wiring.

function photoCanvasBlock(): string {
  const appPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src/App.tsx');
  const source = readFileSync(appPath, 'utf8');
  const start = source.indexOf('<PhotoCanvas');
  const end = source.indexOf('/>', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('compare original source', () => {
  it('feeds PhotoCanvas the denoised base for display', () => {
    expect(photoCanvasBlock()).toContain('photo={viewPhoto ?? photo}');
  });

  it('feeds PhotoCanvas the untouched src for the Compare Original layer', () => {
    expect(photoCanvasBlock()).toContain('originalSrc={photo.src}');
  });
});
