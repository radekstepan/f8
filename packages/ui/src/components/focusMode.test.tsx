import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Focus mode (View → Focus Mode, Shift F): only the open photo and the
// album filmstrip stay on screen — the menu bar, toolbar, library
// sidebar, adjustments panel, preset strip, and status bar unmount, while
// the filmstrip is forced on even when the user normally keeps it closed.
// Pinned from the App source + stylesheet (the photoToolsGating.test.tsx
// precedent): App owns the mode, so there is no component to render.

const here = dirname(fileURLToPath(import.meta.url));
const appSource = () => readFileSync(resolve(here, '../../../../apps/web/src/App.tsx'), 'utf8');
const css = () => readFileSync(resolve(here, '../../../../apps/web/src/index.css'), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

/** The one-line `fullscreen` action case (the mode toggle). */
function fullscreenCase(): string {
  return appSource().split('\n').find((line) => line.includes("case 'fullscreen'")) ?? '';
}

describe('focus mode', () => {
  it('toggles an explicit mode state and opens the photo on entry', () => {
    expect(appSource()).toContain('const [focusMode, setFocusMode] = useState(false);');
    const toggle = fullscreenCase();
    expect(toggle).toContain('if (focusMode) setFocusMode(false);');
    expect(toggle).toContain("else { setFocusMode(true); setView('editor'); }");
  });

  it('leaves the panel preferences alone so exit restores the layout', () => {
    // The old toggle flipped the sidebar/inspector prefs, clobbering the
    // layout; the mode now hides panels at render time instead.
    const toggle = fullscreenCase();
    expect(toggle).not.toContain('setSidebarOpen');
    expect(toggle).not.toContain('setInspectorOpen');
  });

  it('unmounts every shell region except the photo and the filmstrip', () => {
    const source = appSource();
    expect(source).toContain('{!focusMode && <MenuBar');
    expect(source).toContain('{!focusMode && <Toolbar');
    expect(source).toContain('{!focusMode && sidebarOpen && <Sidebar');
    expect(source).toContain('const showInspector = isInspectorVisible(view, inspectorOpen) && !focusMode;');
    expect(source).toContain('{!focusMode && presetsOpen && <PresetStrip');
    expect(source).toContain('{!focusMode && <AppStatus');
    expect(source).toContain("${focusMode ? 'is-focus' : ''}");
  });

  it('forces the photo view and the filmstrip through the core predicates', () => {
    const source = appSource();
    expect(source).toContain('isFilmstripVisible');
    expect(source).toContain('resolveFocusView');
    expect(source).toContain('const effectiveView = resolveFocusView(view, focusMode);');
    expect(source).toContain('const showFilmstrip = isFilmstripVisible(filmstripOpen, focusMode);');
    expect(source).toContain("{effectiveView === 'library' ? (");
    expect(source).toContain('{showFilmstrip && <Filmstrip');
  });

  it('exits on Shift F, Esc, grid navigation, and browser history', () => {
    const source = appSource();
    expect(source).toContain("actionRef.current('fullscreen')");
    expect(source).toContain("if (key === 'escape') { if (focusMode) { setFocusMode(false); return; }");
    expect(source).toContain("case 'grid': setFocusMode(false);");
    // 'back' needs no exit: only the toolbar backlink dispatches it, and
    // the toolbar is unmounted in focus mode — the case stays pristine
    // (pinned exactly by photoBacklink.test.tsx).
    expect(source).toMatch(/case 'back':\s*setView\('library'\); break;/);
    const popstate = source.slice(source.indexOf('const onPopState'), source.indexOf('const onPopState') + 500);
    expect(popstate).toContain('setFocusMode(false);');
    // The Esc branch reads live state: without the dep the global handler
    // would keep the stale (pre-entry) value and never exit.
    expect(source).toContain('[dialog, filteredPhotos, selectedId, selectPhoto, view, focusMode]');
  });

  it('floats an exit button over the photo (the toolbar is gone)', () => {
    const source = appSource();
    expect(source).toContain('{focusMode && <div className="focus-exit">');
    expect(source).toContain('label="Exit focus mode (Shift F)"');
    const exit = source.split('\n').find((line) => line.includes('focus-exit')) ?? '';
    expect(exit).toContain("handleAction('fullscreen')");
    expect(exit).toContain('Minimize2 size={17}');
  });

  it('parks the exit button top-right below dialogs and toasts', () => {
    const rule = cssRule('.focus-exit');
    expect(rule).toMatch(/position\s*:\s*fixed/);
    expect(rule).toMatch(/top\s*:\s*12px/);
    expect(rule).toMatch(/right\s*:\s*12px/);
    expect(rule).toMatch(/z-index\s*:\s*90/);
    // Subtle until needed: half opacity at rest, full on hover/focus.
    expect(rule).toMatch(/opacity\s*:\s*0\.55/);
    expect(cssRule('.focus-exit:hover, .focus-exit:focus-within')).toMatch(/opacity\s*:\s*1/);
  });
});
