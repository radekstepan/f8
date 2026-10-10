import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Check, ImagePlus, X } from 'lucide-react';
import { SAMPLE_ALBUMS, SAMPLE_PHOTOS, PRESETS } from '@photomator/core';
import { decodeImportSize } from '@photomator/core';
import { useEditor } from '@photomator/ui';
import type { Album, DialogType, EditState, Photo, Preset, Tool, ViewMode } from '@photomator/core';
import { Sidebar } from '@photomator/ui';
import { AppStatus, MenuBar, Toolbar, type MenuAction } from '@photomator/ui';
import { PhotoCanvas, type HistogramData } from '@photomator/ui';
import { Filmstrip, PhotoBrowser, PresetStrip } from '@photomator/ui';
import { Inspector } from '@photomator/ui';
import { EditorDialogs } from '@photomator/ui';
import { useVisionWorker } from './vision/useVisionWorker';
import { useStraighten } from './vision/useStraighten';
import { useInpaintRepair } from './vision/useInpaintRepair';

function readSaved<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(value) && value.length ? value as T : fallback;
  } catch { return fallback; }
}

const collectionTitles: Record<string, string> = { all: 'All Photos', favorites: 'Favorites', edited: 'Recently Edited', imports: 'Imports', landscapes: 'Landscapes', raw: 'RAW Photos' };

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>(() => readSaved('photomator-demo-library-v1', SAMPLE_PHOTOS));
  const [albums, setAlbums] = useState<Album[]>(() => readSaved('photomator-demo-albums-v1', SAMPLE_ALBUMS));
  const [customPresets, setCustomPresets] = useState<Preset[]>(() => readSaved('photomator-demo-presets-v1', []));
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
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectUrls = useRef<string[]>([]);
  const photo = photos.find((item) => item.id === selectedId) || photos[0]!;
  const editor = useEditor(photo.id);
  const vision = useVisionWorker();
  const straighten = useStraighten(photo.id);
  const inpaintRepair = useInpaintRepair();
  const collectionName = albums.find((album) => album.id === collection)?.name || collectionTitles[collection] || 'Your Photos';
  const availablePresets = useMemo(() => [...PRESETS, ...customPresets], [customPresets]);

  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 3600);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('photomator-demo-library-v1', JSON.stringify(photos.filter((item) => !item.id.startsWith('import-'))));
      localStorage.setItem('photomator-demo-albums-v1', JSON.stringify(albums.map((album) => ({ ...album, cover: album.cover.startsWith('blob:') ? '' : album.cover }))));
      localStorage.setItem('photomator-demo-presets-v1', JSON.stringify(customPresets));
    } catch { /* Storage is optional: the current editing session still works. */ }
  }, [photos, albums, customPresets]);

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const filteredPhotos = useMemo(() => {
    let items = photos.filter((item) => {
      if (search) return true;
      if (collection === 'all') return true;
      if (collection === 'favorites') return item.favorite;
      if (collection === 'edited') return item.id === 'photo-1' || Boolean(editor.histories[item.id]);
      if (collection === 'imports') return item.id.startsWith('import-');
      if (collection === 'raw') return item.raw;
      if (collection === 'landscapes') return !item.id.startsWith('import-');
      return item.albumId === collection;
    });
    if (search) {
      const query = search.toLowerCase();
      items = items.filter((item) => `${item.name} ${item.title} ${item.location} ${item.camera}`.toLowerCase().includes(query));
    }
    return reversed ? [...items].reverse() : items;
  }, [photos, collection, search, reversed, editor.histories]);

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

  const toggleFavorite = useCallback((id = photo.id) => setPhotos((current) => current.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item)), [photo.id]);
  const setRating = (rating: number) => setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, rating } : item));

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
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!images.length) { notify('Choose a JPEG, PNG, WebP, or another browser-supported image.'); return; }
    const albumId = albums.some((album) => album.id === collection) ? collection : 'imports';
    const imported = await Promise.all(images.slice(0, 30).map(async (file, index) => {
      const src = URL.createObjectURL(file);
      objectUrls.current.push(src);
      try {
        // EXIF-aware decode: the browser pre-rotates pixels so the recorded
        // size is the upright (orientation 1) size, never sideways.
        const { width, height } = await decodeImportSize(file, src);
        return {
          id: `import-${Date.now()}-${index}`, name: file.name, title: file.name.replace(/\.[^.]+$/, ''), src, thumbnail: src,
          albumId, location: 'Imported from this device', date: new Date(file.lastModified).toISOString(),
          width, height, camera: 'Imported image', lens: 'No camera metadata',
          iso: 0, aperture: '-', shutter: '-', focalLength: '-', raw: false, favorite: false, rating: 0,
        } satisfies Photo;
      } catch { URL.revokeObjectURL(src); return null; }
    }));
    const valid = imported.filter((item): item is NonNullable<typeof item> => Boolean(item));
    const first = valid[0];
    if (!first) { notify('These files could not be decoded. Try JPEG, PNG, or WebP.'); return; }
    setPhotos((current) => [...current, ...valid]);
    setCollection(albumId);
    setSearch('');
    selectPhoto(first.id);
    notify(`${valid.length} ${valid.length === 1 ? 'photo' : 'photos'} imported. Imported originals stay in this session.`);
  };

  const handleAction = (action: MenuAction) => {
    switch (action) {
      case 'import': fileInput.current?.click(); break;
      case 'export': setDialog('export'); break;
      case 'album': setDialog('album'); break;
      case 'undo': editor.undo(); break;
      case 'redo': editor.redo(); break;
      case 'reset': editor.reset(); notify('Adjustments reset. Your original is unchanged.'); break;
      case 'copy': copyAdjustments(); break;
      case 'paste': pasteAdjustments(); break;
      case 'enhance': editor.autoEnhance(photo.src); setView('editor'); break;
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
        const shortcut = key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'o' ? 'import' : event.shiftKey && key === 'e' ? 'export' : event.shiftKey && key === 'c' ? 'copy' : event.shiftKey && key === 'v' ? 'paste' : null;
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
    if (albums.some((album) => album.name.toLowerCase() === name.toLowerCase())) { notify('An album with that name already exists.'); return; }
    const id = `album-${Date.now()}`;
    setAlbums((current) => [...current, { id, name, cover: includePhoto ? photo.thumbnail : '' }]);
    if (includePhoto) setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, albumId: id } : item));
    setCollection(id);
    setView('library');
    setDialog(null);
    notify(`"${name}" is ready for your photos.`);
  };

  const savePreset = (name: string) => {
    if ([...PRESETS, ...customPresets].some((preset) => preset.name.toLowerCase() === name.toLowerCase())) { notify('A preset with that name already exists. Choose another name.'); return; }
    const { rotation: _rotation, flipH: _flipH, flipV: _flipV, straighten: _straighten, cropRatio: _cropRatio, retouches: _retouches, ...values } = editor.edit;
    setCustomPresets((current) => [...current, { id: `preset-${Date.now()}`, name, category: 'My Presets', values }]);
    editor.change({ preset: name });
    setPresetsOpen(true);
    setDialog(null);
    notify(`"${name}" saved to My Presets.`);
  };

  const handleDrag = (event: DragEvent, enter: boolean) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragCount.current += enter ? 1 : -1;
    setDragging(dragCount.current > 0);
  };

  return <div className={`app-shell ${sidebarOpen ? 'has-sidebar' : ''} ${inspectorOpen ? 'has-inspector' : ''}`} onDragEnter={(event) => handleDrag(event, true)} onDragLeave={(event) => handleDrag(event, false)} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); dragCount.current = 0; setDragging(false); void importFiles(event.dataTransfer.files); }}>
    <MenuBar onAction={handleAction} canUndo={editor.canUndo} canRedo={editor.canRedo} canPaste={Boolean(clipboard)} sidebar={sidebarOpen} inspector={inspectorOpen} presets={presetsOpen} filmstrip={filmstripOpen} />
    <Toolbar collectionName={collectionName} count={filteredPhotos.length} tool={tool} enhanced={editor.edit.autoEnhanced} compare={compare} canUndo={editor.canUndo} canRedo={editor.canRedo} libraryView={view === 'library'} onTool={selectTool} onAction={handleAction} onDialog={setDialog} />
    <div className="workspace">
      {sidebarOpen && <Sidebar photos={photos} albums={albums} collection={collection} search={search} editedCount={photos.filter((item) => item.id === 'photo-1' || Boolean(editor.histories[item.id])).length} onSearch={(value) => { setSearch(value); setView('library'); }} onSelect={selectCollection} onImport={() => fileInput.current?.click()} onNewAlbum={() => setDialog('album')} />}
      <main className="editor-column">
        {view === 'library' ? (
          <PhotoBrowser photos={filteredPhotos} title={collectionName} search={search} onSelect={selectPhoto} onFavorite={toggleFavorite} onImport={() => fileInput.current?.click()} />
        ) : (
          <>
            <PhotoCanvas
              photo={photo} edit={editor.edit} tool={tool} zoom={zoom}
              compare={compare} showOriginal={showOriginal}
              brushSize={brushSize} brushStrength={brushStrength}
              inpaintRepair={inpaintRepair}
              onZoom={setZoom} onCompare={() => setCompare(!compare)}
              onFavorite={() => toggleFavorite()} onRating={setRating}
              onInfo={() => setDialog('info')} onChange={editor.change} onHistogram={setHistogram}
            />
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
        onAuto={() => editor.autoEnhance(photo.src)} onCopy={copyAdjustments} onPaste={pasteAdjustments}
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
    <input className="hidden" ref={fileInput} type="file" multiple accept="image/*" aria-label="Import photos" onChange={(event) => { if (event.target.files) void importFiles(event.target.files); event.target.value = ''; }} />
    <EditorDialogs dialog={dialog} photo={photo} edit={editor.edit} inpaintRepair={inpaintRepair} onClose={() => setDialog(null)} onToast={notify} onCreateAlbum={createAlbum} onSavePreset={savePreset} />
    {toast && <div className="toast" role="status"><span className="toast-check"><Check size={13} /></span><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={13} /></button></div>}
    {dragging && <div className="drop-overlay"><div><ImagePlus size={43} strokeWidth={1.25} /><h2>A new perspective.</h2><p>Drop your photos anywhere to start creating.</p><span>JPEG, PNG, WebP and more</span></div></div>}
  </div>;
}
