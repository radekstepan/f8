import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Offline recovery wiring: the photo-load error lost its Try again button,
// broken thumbnails flip the standard offline takeover (via a verified
// burst, not a single failure), and the offline gate resolves itself by
// pinging until the server answers. The hook effects need window/DOM (the
// UI suite runs in node, no jsdom) and the gate lives in apps/web
// (Playwright only, out of scope), so the wiring is pinned at the source
// level, following the offlineWording.test.ts precedent — while the burst
// logic itself runs behaviorally in core's offline.test.ts.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

const hookSource = () => readFileSync(resolve(here, 'useLibrary.ts'), 'utf8');
const canvasSource = () => readFileSync(resolve(here, '../components/PhotoCanvas.tsx'), 'utf8');
const imageSource = () => readFileSync(resolve(root, 'packages/core/src/image.ts'), 'utf8');
const appSource = () => readFileSync(resolve(root, 'apps/web/src/App.tsx'), 'utf8');

describe('photo-load error has no retry', () => {
  it('renders the error overlay without a button', () => {
    const errorLine = canvasSource().split('\n').find((line) => line.includes('photo-error'));
    expect(errorLine).toBeDefined();
    expect(errorLine!).toContain('{error}');
    expect(errorLine!).not.toContain('<button');
  });

  it('offers no Try again anywhere in the photo path', () => {
    expect(canvasSource()).not.toContain('Try again');
    expect(canvasSource()).not.toContain('setRetry');
    expect(imageSource()).not.toMatch(/try again/i);
  });

  it('keeps both copies of the load-failure message in sync', () => {
    // loadImage rejects with the message; the canvas fallback covers
    // non-Error rejections. Both must read identically.
    const message = 'This photo could not be loaded. Check your connection.';
    expect(imageSource()).toContain(message);
    expect(canvasSource()).toContain(message);
  });
});

describe('offline detection flips the takeover', () => {
  it('listens to the browser online/offline events', () => {
    expect(hookSource()).toContain('addEventListener("offline", onOffline)');
    expect(hookSource()).toContain('addEventListener("online", onOnline)');
    expect(hookSource()).toContain('removeEventListener("offline", onOffline)');
    expect(hookSource()).toContain('removeEventListener("online", onOnline)');
  });

  it('reloads the library when the browser comes back online', () => {
    expect(hookSource()).toContain('if (statusRef.current === "offline") void load();');
  });

  it('counts broken images via a capture-phase error listener', () => {
    // Resource errors don't bubble, so the listener must capture.
    expect(hookSource()).toContain('addEventListener("error", onResourceError, true)');
    expect(hookSource()).toContain('event.target instanceof HTMLImageElement');
    expect(hookSource()).toContain('noteImageFailure(imageFailures.current, Date.now())');
    expect(hookSource()).toContain('if (burst.burst) void verifyConnection();');
  });

  it('verifies a suspected outage with a ping before flipping offline', () => {
    expect(hookSource()).toContain('await client.ping();');
    expect(hookSource()).toContain('reason.status === 0');
    expect(hookSource()).toContain('setStatus("offline")');
  });

  it('names the connection when the browser reports the outage', () => {
    expect(hookSource()).toContain('verifyConnection(BROWSER_OFFLINE_MESSAGE)');
    expect(hookSource()).toContain('The network connection is down.');
  });
});

describe('offline gate recovers by itself', () => {
  it('pings on a fixed cadence while offline and reloads on success', () => {
    expect(hookSource()).toContain('if (status !== "offline" || typeof window === "undefined") return;');
    expect(hookSource()).toContain('}, OFFLINE_PING_INTERVAL_MS);');
    expect(hookSource()).toContain('if (!stopped) void load();');
  });

  it('tells the user the gate retries automatically', () => {
    expect(appSource()).toContain('Retrying automatically — this page reloads when the server is back.');
  });

  it('keeps the manual Try again on the gate itself', () => {
    expect(appSource()).toContain('onClick={() => void library.retry()}');
  });
});
