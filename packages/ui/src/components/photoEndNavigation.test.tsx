import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Home/End first/last-photo navigation, pinned from the App source (the
// focusMode.test.tsx precedent): the wiring lives in the global keydown
// effect, so there is no renderable output to assert on. The rule itself
// is unit-tested in core (photoEndNavigation.test.ts); this file pins that
// App actually calls it, that the shortcut is discoverable, and that the
// filmstrip focus handler still keys on the same event.key so focus and
// selection land on the same end photo.

const here = dirname(fileURLToPath(import.meta.url));
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');
const dialogsSource = () => readFileSync(resolve(here, './EditorDialogs.tsx'), 'utf8');
const stripsSource = () => readFileSync(resolve(here, './PhotoStrips.tsx'), 'utf8');

describe('home/end photo navigation', () => {
  it('navigates to the first/last photo from the global key handler', () => {
    const source = appSource();
    expect(source).toContain('if (shouldNavigateToPhotoEnd(event.key, view)) {');
    expect(source).toContain('const targetId = photoEndTargetId(event.key, filteredPhotos, selectedId);');
    expect(source).toContain('if (targetId) selectPhoto(targetId);');
  });

  it('lists the shortcut in the keyboard shortcuts dialog', () => {
    expect(dialogsSource()).toContain("['First / last photo', 'Home / End']");
  });

  it('keeps filmstrip focus keyed on the same event.key so it lands together', () => {
    // The strip moves focus while App moves the selection; both read
    // event.key, so Home focuses the first item exactly when App opens it.
    expect(stripsSource()).toContain('filmstripArrowIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)');
  });
});
