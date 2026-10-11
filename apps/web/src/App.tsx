import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Check, CloudOff, FolderSearch, ImagePlus, RefreshCw, X } from 'lucide-react';
import { PRESETS } from '@photomator/core';
import { RAW_ACCEPT } from '@photomator/core';
import { useEditor, useLibrary } from '@photomator/ui';
import type { DialogType, EditState, Tool, ViewMode } from '@photomator/core';
import { Sidebar } from '@photomator/ui';
import { AppStatus, MenuBar, Toolbar, type MenuAction } from '@photomator/ui';
import { PhotoCanvas, type HistogramData } from '@photomator/ui';
import { Filmstrip, PhotoBrowser, PresetStrip } from '@photomator/ui';
import { Inspector } from '@photomator/ui';
import { EditorDialogs } from '@photomator/ui';
import { useVisionWorker } from './vision/useVisionWorker';
import { useStraighten } from './vision/useStraighten';
import { useInpaintRepair } from './vision/useInpaintRepair';
import { FsBrowser } from './components/FsBrowser';

const collectionTitles: Record<string, string> = { all: 'All Photos', favorites: 'Favorites', edited: 'Recently Edited', imports: 'Imports', landscapes: 'Landscapes', raw: 'RAW Photos' };

type FolderDialog = { mode: 'import' } | { mode: 'locate'; photoId: string };

export default function App() {
  const library = useLibrary();
  const { photos, albums, customPresets } = library;
  const [selectedId, setSelectedId] = useState('photo-1');
  const [collection, setCollection] = useState('dolomites');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('editor');
  const [tool, setTool] = useState<Tool>('adjust');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 1080);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 760);
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [filmstripOpen, setFilmstripOpen] = useState(true);
  const [compare, setCompare] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [reversed, setReversed] = useState(false);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [brushSize, setBrushSize] = useState(45);
  const [brushStrength, setBrushStrength] = useState(85);
  const [clipboard, setClipboard] = useState<EditState | null>(null);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photo = photos.find((item) => item.id === selectedId) || photos[0];
  const editor = useEditor(photo?.id ?? selectedId, { initial: library.editsSeed, onPersist: library.saveEdit });
  const vision = useVisionWorker();
  const straighten = useStraighten(photo?.id ?? selectedId);
  const inpaintRepair = useInpaintRepair();
  const collectionName = albums.find((album) => album.id === collection)?.name || collectionTitles[collection] || 'Your Photos';
  const availablePresets = useMemo(() => [...PRESETS, ...customPresets], [customPresets]);

  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 3600);
  }, []);
  const notifyError = useCallback((reason: unknown, fallback: string) => {
    notify(reason instanceof Error ? reason.message : fallback);
  }, [notify]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const filteredPhotos = useMemo(() => {
    let items = photos.filter((item) => {
      if (search) return true;
      if (collection === 'all') return true;
      if (collection === 'favorites') return item.favorite;
      if (collection === 'edited') return Boolean(item.edited);
      if (collection === 'imports') return item.albumId === 'imports';
      if (collection === 'raw') return item.raw;
      if (collection === 'landscapes') return item.width > item.height;
      return item.albumId === collection;
    });
    if (search) {
      const query = search.toLowerCase();
      items = items.filter((item) => `${item.name} ${item.title} ${item.location} ${item.camera}`.toLowerCase().includes(query));
    }
    const byDate = [...items].sort((a, b) => a.date.localeCompare(b.date));
    return reversed ? byDate.reverse() : byDate;
  }, [photos, collection, search, reversed]);

  const selectPhoto = useCallback((id: string) => {
    setSelectedId(id);
    setView('editor');
    setZoom(1);
    setShowOriginal(false);
  }, []);

  const selectCollection = (id: string) => {
    setCollection(id);
    setSearch('');
    setView('library');
    if (window.innerWidth < 760) setSidebarOpen(false);
  };

  const toggleFavorite = useCallback((id?: string) => {
    const target = id ?? photo?.id;
    if (!target) return;
    const current = photos.find((item) => item.id === target);
    void library.updatePhoto(target, { favorite: !current?.favorite }).catch((reason: unknown) => notifyError(reason, 'Could not update the favorite.'));
  }, [photo?.id, photos, library, notifyError]);
  const setRating = (rating: number) => {
    if (!photo) return;
    void library.updatePhoto(photo.id, { rating }).catch((reason: unknown) => notifyError(reason, 'Could not update the rating.'));
  };

  const selectTool = (next: Tool) => {
    setTool(next);
    setView('editor');
    setInspectorOpen((current) => window.innerWidth < 760 && next === tool ? !current : true);
    if (window.innerWidth < 760) setSidebarOpen(false);
    if (next !== 'adjust') { setCompare(false); setShowOriginal(false); }
  };

  const copyAdjustments = () => { setClipboard({ ...editor.edit, retouches: [] }); notify('Adjustments copied. Pick another photo to paste them.'); };
  const pasteAdjustments = () => {
    if (!clipboard) return;
    editor.applyPreset({ id: 'clipboard', name: 'Pasted Adjustments', category: 'My Presets', values: clipboard });
    notify('Adjustments pasted onto this photo.');
  };

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const albumId = albums.some((album) => album.id === collection) ? collection : 'imports';
    notify('Importing your photos…');
    const summary = await library.uploadFiles(list, albumId);
    if (summary.firstId) {
      setCollection(albumId);
      setSearch('');
      selectPhoto(summary.firstId);
    }
    const notes = [
      summary.imported ? `${summary.imported} ${summary.imported === 1 ? 'photo' : 'photos'} imported.` : '',
      summary.deduplicated ? `${summary.deduplicated} ${summary.deduplicated === 1 ? 'was' : 'were'} already in your library.` : '',
      summary.suppressedSidecars ? `${summary.suppressedSidecars} JPEG sidecar${summary.suppressedSidecars === 1 ? ' was' : 's were'} skipped: the RAW original was kept.` : '',
      summary.failed ? `${summary.failed} could not be imported.` : '',
    ];
    notify(notes.filter(Boolean).join(' ') || 'Nothing to import.');
  };

  const importFromPaths = async (paths: string[]) => {
    const albumId = albums.some((album) => album.id === collection) ? collection : 'imports';
    const locating = folderDialog?.mode === 'locate' ? folderDialog.photoId : null;
    setFolderDialog(null);
    notify('Importing from disk…');
    try {
      const report = await library.importPaths(paths, albumId);
      const first = report.imported[0] ?? report.relinked[0] ?? report.duplicates[0];
      if (first) {
        if (!locating) setCollection(albumId);
        setSearch('');
        selectPhoto(first.id);
      }
      if (locating) {
        const healed = [...report.relinked, ...report.duplicates].some((item) => item.id === locating);
        notify(healed ? 'Original relinked. Your edits are back.' : 'That file does not match the missing photo.');
        return;
      }
      const notes = [
        report.imported.length ? `${report.imported.length} ${report.imported.length === 1 ? 'photo' : 'photos'} imported.` : '',
        report.relinked.length ? `${report.relinked.length} relinked with ${report.relinked.length === 1 ? 'its' : 'their'} edits intact.` : '',
        report.duplicates.length ? `${report.duplicates.length} already in your library.` : '',
        report.suppressedSidecars ? `${report.suppressedSidecars} JPEG sidecar${report.suppressedSidecars === 1 ? ' was' : 's were'} skipped: the RAW original was kept.` : '',
        report.skipped.length ? `${report.skipped.length} skipped.` : '',
        report.truncated ? 'Stopped at the per-import limit; run it again for the rest.' : '',
      ];
      notify(notes.filter(Boolean).join(' ') || 'Nothing to import.');
    } catch (reason) {
      notifyError(reason, 'Could not import from disk.');
    }
  };

  const handleAction = (action: MenuAction) => {
    switch (action) {
      case 'import': fileInput.current?.click(); break;
      case 'import-folder': setFolderDialog({ mode: 'import' }); break;
      case 'export': setDialog('export'); break;
      case 'album': setDialog('album'); break;
      case 'undo': editor.undo(); break;
      case 'redo': editor.redo(); break;
      case 'reset': editor.reset(); notify('Adjustments reset. Your original is unchanged.'); break;
      case 'copy': copyAdjustments(); break;
      case 'paste': pasteAdjustments(); break;
      case 'enhance': editor.autoEnhance(photo?.src); setView('editor'); break;
      case 'rotate': editor.change({ rotation: (editor.edit.rotation - 90) % 360 }); break;
      case 'favorite': toggleFavorite(); break;
      case 'sidebar': setSidebarOpen((current) => !current); if (window.innerWidth < 760) setInspectorOpen(false); break;
      case 'inspector': setInspectorOpen((current) => !current); break;
      case 'presets': setPresetsOpen((current) => !current); break;
      case 'filmstrip': setFilmstripOpen((current) => !current); break;
      case 'compare': setCompare((current) => !current); setView('editor'); break;
      case 'grid': setView((current) => current === 'editor' ? 'library' : 'editor'); break;
      case 'fit': setZoom(1); break;
      case 'fullscreen': { const showing = sidebarOpen || inspectorOpen; setSidebarOpen(!showing); setInspectorOpen(!showing); break; }
      case 'shortcuts': setDialog('shortcuts'); break;
      case 'about': setDialog('about'); break;
    }
  };

  const actionRef = useRef(handleAction);
  const toolRef = useRef(selectTool);
  actionRef.current = handleAction;
  toolRef.current = selectTool;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialog) return;
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select') || target.isContentEditable || target.closest('[role="menu"]') || target.closest('[aria-haspopup="menu"]')) return;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command) {
        const shortcut = key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'o' ? event.shiftKey ? 'import-folder' : 'import' : event.shiftKey && key === 'e' ? 'export' : event.shiftKey && key === 'c' ? 'copy' : event.shiftKey && key === 'v' ? 'paste' : null;
        if (shortcut) { event.preventDefault(); actionRef.current(shortcut); }
        return;
      }
      if (event.key === '\\') { event.preventDefault(); setShowOriginal(true); return; }
      if (event.altKey) return;
      if (key === 'f' && event.shiftKey) { event.preventDefault(); actionRef.current('fullscreen'); return; }
      if (key === '?') { setDialog('shortcuts'); return; }
      if (key === '/') { event.preventDefault(); setSidebarOpen(true); if (window.innerWidth < 760) setInspectorOpen(false); window.setTimeout(() => document.getElementById('photo-search')?.focus(), 20); return; }
      if (key === 'i') { setDialog('info'); return; }
      if (key === '0') { setZoom(1); return; }
      if (key === '+' || key === '=') { setZoom((current) => Math.min(3, current + 0.25)); return; }
      if (key === '-') { setZoom((current) => Math.max(0.5, current - 0.25)); return; }
      if (key === 'arrowleft' || key === 'arrowright') {
        event.preventDefault();
        const index = filteredPhotos.findIndex((item) => item.id === selectedId);
        const next = filteredPhotos[(index + (key === 'arrowright' ? 1 : -1) + filteredPhotos.length) % filteredPhotos.length];
        if (next) selectPhoto(next.id);
        return;
      }
      const actions: Record<string, MenuAction> = { a: 'enhance', f: 'favorite', b: 'compare', g: 'grid', r: 'rotate' };
      const tools: Record<string, Tool> = { v: 'adjust', c: 'crop', j: 'repair' };
      if (actions[key]) actionRef.current(actions[key]);
      if (tools[key]) toolRef.current(tools[key]);
      if (key === 'escape') { setCompare(false); setTool('adjust'); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === '\\') setShowOriginal(false); };
    const onBlur = () => setShowOriginal(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, [dialog, filteredPhotos, selectedId, selectPhoto]);

  const createAlbum = (name: string, includePhoto: boolean) => {
    void (async () => {
      try {
        const album = await library.createAlbum(name, includePhoto && photo ? photo.thumbnail : '');
        if (includePhoto && photo) await library.updatePhoto(photo.id, { albumId: album.id });
        setCollection(album.id);
        setView('library');
        setDialog(null);
        notify(`"${name}" is ready for your photos.`);
      } catch (reason) {
        notifyError(reason, 'Could not create the album.');
      }
    })();
  };

  const savePreset = (name: string) => {
    const { rotation: _rotation, flipH: _flipH, flipV: _flipV, straighten: _straighten, cropRatio: _cropRatio, retouches: _retouches, ...values } = editor.edit;
    void library.createPreset(name, values).then(
      () => {
        editor.change({ preset: name });
        setPresetsOpen(true);
        setDialog(null);
        notify(`"${name}" saved to My Presets.`);
      },
      (reason: unknown) => notifyError(reason, 'Could not save the preset.'),
    );
  };

  const handleDrag = (event: DragEvent, enter: boolean) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragCount.current += enter ? 1 : -1;
    setDragging(dragCount.current > 0);
  };

  if (library.status === 'loading' || !library.editsSeed) {
    return <div className="library-gate" role="status"><span className="loading-spinner" aria-hidden="true" /><p>Opening your library…</p></div>;
  }

  if (library.status === 'offline') {
    return <div className="library-gate">
      <CloudOff size={40} strokeWidth={1.25} />
      <h2>The library server is not running.</h2>
      <p>{library.error || 'Start it with yarn dev, then try again.'}</p>
      <button className="primary-button" onClick={() => void library.retry()}><RefreshCw size={14} />Try again</button>
    </div>;
  }

  if (!photo) {
    return <div className="library-gate">
      <ImagePlus size={40} strokeWidth={1.25} />
      <h2>A fresh perspective starts here.</h2>
      <p>Import a few photos to make this space your own.</p>
      <div className="gate-actions">
        <button className="primary-button" onClick={() => fileInput.current?.click()}>Import photos</button>
        <button className="secondary-button" onClick={() => setFolderDialog({ mode: 'import' })}>Import from folder</button>
      </div>
      <input className="hidden" ref={fileInput} type="file" multiple accept={`image/*,${RAW_ACCEPT}`} aria-label="Import photos" onChange={(event) => { if (event.target.files) void importFiles(event.target.files); event.target.value = ''; }} />
      {folderDialog && <FsBrowser title="Import from folder" subtitle="Referenced in place — nothing is copied." actionLabel="Import selected" onClose={() => setFolderDialog(null)} onSelect={(paths) => void importFromPaths(paths)} />}
      {toast && <div className="toast" role="status"><span className="toast-check"><Check size={13} /></span><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={13} /></button></div>}
    </div>;
  }

  return <div className={`app-shell ${sidebarOpen ? 'has-sidebar' : ''} ${inspectorOpen ? 'has-inspector' : ''}`} onDragEnter={(event) => handleDrag(event, true)} onDragLeave={(event) => handleDrag(event, false)} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); dragCount.current = 0; setDragging(false); void importFiles(event.dataTransfer.files); }}>
    <MenuBar onAction={handleAction} canUndo={editor.canUndo} canRedo={editor.canRedo} canPaste={Boolean(clipboard)} sidebar={sidebarOpen} inspector={inspectorOpen} presets={presetsOpen} filmstrip={filmstripOpen} />
    <Toolbar collectionName={collectionName} count={filteredPhotos.length} tool={tool} enhanced={editor.edit.autoEnhanced} compare={compare} canUndo={editor.canUndo} canRedo={editor.canRedo} libraryView={view === 'library'} onTool={selectTool} onAction={handleAction} onDialog={setDialog} />
    <div className="workspace">
      {sidebarOpen && <Sidebar photos={photos} albums={albums} collection={collection} search={search} editedCount={photos.filter((item) => item.edited).length} onSearch={(value) => { setSearch(value); setView('library'); }} onSelect={selectCollection} onImport={() => fileInput.current?.click()} onNewAlbum={() => setDialog('album')} />}
      <main className="editor-column">
        {view === 'library' ? (
          <PhotoBrowser photos={filteredPhotos} title={collectionName} search={search} onSelect={selectPhoto} onFavorite={toggleFavorite} onImport={() => fileInput.current?.click()} />
        ) : (
          <>
            {photo.missing ? (
              <div className="missing-original" role="alert">
                <FolderSearch size={40} strokeWidth={1.25} />
                <h2>The original file moved.</h2>
                <p>Your edits are safe. Reimport <strong>{photo.name}</strong> from its new location to relink them.</p>
                {photo.path && <span className="missing-path">Last seen at {photo.path}</span>}
                <button className="primary-button" onClick={() => setFolderDialog({ mode: 'locate', photoId: photo.id })}>Locate original…</button>
              </div>
            ) : (
              <PhotoCanvas
                photo={photo} edit={editor.edit} tool={tool} zoom={zoom}
                compare={compare} showOriginal={showOriginal}
                brushSize={brushSize} brushStrength={brushStrength}
                inpaintRepair={inpaintRepair}
                onZoom={setZoom} onCompare={() => setCompare(!compare)}
                onFavorite={() => toggleFavorite()} onRating={setRating}
                onInfo={() => setDialog('info')} onChange={editor.change} onHistogram={setHistogram}
              />
            )}
            {presetsOpen && <PresetStrip
              photo={photo} presets={availablePresets} selected={editor.edit.preset}
              onSelect={editor.applyPreset} onAdd={() => setDialog('preset')} onToggle={() => setPresetsOpen(false)}
            />}
            {filmstripOpen && <Filmstrip
              photos={filteredPhotos} selectedId={photo.id} collectionName={collectionName}
              onSelect={selectPhoto} onGrid={() => setView('library')}
              onSort={() => setReversed(!reversed)} reversed={reversed}
              showPresets={presetsOpen} onShowPresets={() => setPresetsOpen(true)}
            />}
          </>
        )}
      </main>
      {inspectorOpen && <Inspector
        photo={photo} edit={editor.edit} tool={tool} histogram={histogram}
        brushSize={brushSize} brushStrength={brushStrength} canPaste={Boolean(clipboard)}
        straightenAssist={{ state: straighten.state, angle: straighten.angle, confidence: straighten.confidence, message: straighten.message, onDetect: () => straighten.detect(photo.src), onDismiss: straighten.dismiss }}
        repairAssist={{ method: inpaintRepair.method, status: inpaintRepair.status, onMethodChange: inpaintRepair.setMethod }}
        onChange={editor.change} onTool={selectTool} onReset={() => handleAction('reset')}
        onAuto={() => editor.autoEnhance(photo.src)} onAutoWhiteBalance={() => editor.autoWhiteBalance(photo.src)} onAutoLightness={() => editor.autoLightness(photo.src)} onCopy={copyAdjustments} onPaste={pasteAdjustments}
        onSavePreset={() => setDialog('preset')} onBrushSize={setBrushSize} onBrushStrength={setBrushStrength}
        onApplyCrop={() => { setTool('adjust'); notify('Composition updated. You can change it again at any time.'); }}
        onClose={() => setInspectorOpen(false)}
      />}
    </div>
    <AppStatus
      count={photos.length}
      edited={editor.edit.preset !== 'Original'}
      vision={{
        status: vision.status,
        version: vision.version,
        selfTest: vision.selfTest,
        onActivate: () => void vision.ensureReady(),
      }}
    />
    <input className="hidden" ref={fileInput} type="file" multiple accept={`image/*,${RAW_ACCEPT}`} aria-label="Import photos" onChange={(event) => { if (event.target.files) void importFiles(event.target.files); event.target.value = ''; }} />
    <EditorDialogs dialog={dialog} photo={photo} edit={editor.edit} inpaintRepair={inpaintRepair} onClose={() => setDialog(null)} onToast={notify} onCreateAlbum={createAlbum} onSavePreset={savePreset} />
    {folderDialog && <FsBrowser
      title={folderDialog.mode === 'locate' ? 'Locate original' : 'Import from folder'}
      subtitle={folderDialog.mode === 'locate' ? 'Find the file in its new home.' : 'Referenced in place — nothing is copied.'}
      actionLabel={folderDialog.mode === 'locate' ? 'Relink photo' : 'Import selected'}
      onClose={() => setFolderDialog(null)}
      onSelect={(paths) => void importFromPaths(paths)}
    />}
    {toast && <div className="toast" role="status"><span className="toast-check"><Check size={13} /></span><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={13} /></button></div>}
    {dragging && <div className="drop-overlay"><div><ImagePlus size={43} strokeWidth={1.25} /><h2>A new perspective.</h2><p>Drop your photos anywhere to start creating.</p><span>JPEG, PNG, WebP, RAW and more</span></div></div>}
  </div>;
}
