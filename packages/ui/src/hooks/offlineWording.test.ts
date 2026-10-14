import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Offline wording: the server is no longer library-only (edits, ML, cull,
// semantic search), so user-facing copy must say "application server",
// never "library server". The offline gate lives in apps/web (no unit-test
// runner there — Playwright only, out of scope), so the heading and the
// hook fallback are pinned at the source level, following the
// resetDehighlights/topbarMenus source-pin precedent. The core client
// message itself is pinned behaviorally in library-client.test.ts.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

const appSource = () => readFileSync(resolve(root, 'apps/web/src/App.tsx'), 'utf8');
const hookSource = () => readFileSync(resolve(here, 'useLibrary.ts'), 'utf8');
const clientSource = () => readFileSync(resolve(root, 'packages/core/src/library.ts'), 'utf8');

describe('offline wording says application server', () => {
  it('heads the offline gate with the application server', () => {
    expect(appSource()).toContain('<h2>The application server is not running.</h2>');
  });

  it('falls back to the application server when the load error has no message', () => {
    expect(hookSource()).toContain('"Could not reach the application server."');
  });

  it('keeps the client unreachable message on the application server', () => {
    expect(clientSource()).toContain(
      '"The application server is not reachable. Start it with yarn dev and try again."',
    );
  });

  it('says "library server" nowhere in the offline path', () => {
    for (const [file, source] of [
      ['App.tsx', appSource()],
      ['useLibrary.ts', hookSource()],
      ['library.ts', clientSource()],
    ] as const) {
      expect(source, file).not.toMatch(/library server/i);
    }
  });
});
