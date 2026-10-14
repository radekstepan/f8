import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT, RESET_PATCH, isDefaultEdit, presetForPatch } from '@f8/core';
import type { EditState } from '@f8/core';

// Reset-button de-highlight: after "Reset to original" the toolbar button
// must lose its highlight, i.e. the recipe reset() leaves behind has to
// satisfy the same isDefaultEdit predicate App feeds to canReset. Rendered
// server-side elsewhere; here the reset patch and the predicate are pinned
// against each other through the built @f8/core barrel (the
// topbarMenus.test.tsx source-pin precedent for the hook wiring itself).

const here = dirname(fileURLToPath(import.meta.url));
const useEditorSource = () => readFileSync(resolve(here, 'useEditor.ts'), 'utf8');

describe('reset de-highlights the toolbar button', () => {
  it('reset() applies the shared RESET_PATCH, not an inline patch', () => {
    // An inline patch once omitted denoise and the nulled ML keys broke the
    // old stringify comparison — one shared patch keeps both in sync.
    expect(useEditorSource()).toContain('change({ ...RESET_PATCH })');
    expect(useEditorSource()).toContain('RESET_PATCH');
  });

  it('RESET_PATCH restores every default and nulls every ML look field', () => {
    expect(RESET_PATCH).toMatchObject({ ...DEFAULT_EDIT });
    expect(RESET_PATCH.sceneEnhance).toBeNull();
    expect(RESET_PATCH.faceAdjust).toBeNull();
    expect(RESET_PATCH.selectiveAdjust).toBeNull();
    expect(RESET_PATCH.denoise).toBeNull();
  });

  it('the reset-produced recipe satisfies isDefaultEdit (canReset goes false)', () => {
    const dirty: EditState = {
      ...DEFAULT_EDIT,
      exposure: 1,
      rotation: 90,
      preset: 'Custom',
      denoise: { strength: 40, auto: true, source: 'onnx' },
    };
    expect(isDefaultEdit(dirty)).toBe(false);
    // Same merge useEditor.change() performs: spread the real patch, then
    // resolve the preset label with the real presetForPatch.
    const next = { ...dirty, ...RESET_PATCH };
    const present = { ...next, preset: presetForPatch(dirty.preset, RESET_PATCH) };
    expect(isDefaultEdit(present)).toBe(true);
  });
});
