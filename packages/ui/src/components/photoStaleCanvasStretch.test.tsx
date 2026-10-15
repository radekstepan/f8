import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Stale pixels stretched across the frame on photo switch, pinned from the
// PhotoCanvas source + CSS (the photoPreviewStretch.test.tsx precedent): the
// wiring lives in effects and stylesheets, so there is no renderable output
// to assert on. The preview-cache fix kept `loading` true until paint, but
// two stale-pixel paths remained:
//
// 1. `.edited-canvas` fades its opacity over 350 ms. On a photo switch the
//    frame snaps to the new photo's predicted aspect instantly while the old
//    canvas fades out — the previous photo's pixels, CSS-stretched
//    (width/height: 100%) into the new frame, visible until the fade
//    finishes or the cached preview decodes over them. Only noticeable when
//    consecutive photos differ in aspect, which is why only "some" photos
//    stretched.
// 2. The Compare "Original" layer's clip is not gated on loading, so with
//    Compare (or hold-for-original) on, the previous photo's original pixels
//    show stretched in the new frame for the whole pipeline run, then snap
//    when the on-demand repaint lands.

const here = dirname(fileURLToPath(import.meta.url));
const canvasSource = () => readFileSync(resolve(here, './PhotoCanvas.tsx'), 'utf8');

const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const fullCss = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fullCss().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

/** The photo-switch reset effect, from the flush call to its dep array. */
const resetEffect = (): string => {
  const source = canvasSource();
  const start = source.indexOf('useEffect(() => { flushPreviewCache();');
  const end = source.indexOf('}, [photo.id, photo.src]);', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('no stretched stale pixels on photo switch', () => {
  it('hides the stale edited canvas instantly while loading (no stretched fade-out)', () => {
    const rule = cssRule('.photo-frame.is-loading .edited-canvas');
    expect(rule).toMatch(/opacity\s*:\s*0/);
    // The base crossfade would otherwise keep the previous photo's pixels
    // visible (stretched into the new frame's aspect) for 350 ms after every
    // switch. transition: none kills the fade-out; the fade-in still runs
    // because removing is-loading restores the base transition for the 0→1
    // change.
    expect(rule).toMatch(/transition\s*:\s*none/);
  });

  it('keeps the canvas crossfade for the settle (fresh paint still fades in)', () => {
    expect(cssRule('.edited-canvas')).toMatch(/transition\s*:\s*opacity/);
  });

  it('hides the Compare original layer while loading', () => {
    // The layer's clipPath is not gated on loading, so without this the
    // previous photo's original pixels show (stretched) for the whole
    // pipeline run whenever Compare or hold-for-original is on.
    const rule = cssRule('.photo-frame.is-loading .original-layer');
    expect(rule).toMatch(/opacity\s*:\s*0/);
  });

  it('wipes the original canvas backing store on photo switch', () => {
    // The original layer repaints in a passive effect after loading clears,
    // so one frame could flash stale stretched pixels between the commit and
    // the repaint. A zero-size backing store renders nothing until then.
    const effect = resetEffect();
    expect(effect).toContain('originalPaintedKey.current = null;');
    expect(effect).toContain('originalRef.current.width = 0');
    expect(effect).toContain('originalRef.current.height = 0');
  });
});
