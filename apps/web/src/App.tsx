import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Check, CloudOff, FolderSearch, ImagePlus, RefreshCw, X } from 'lucide-react';
import { CROP_RATIOS, PRESETS, SELECTIVE_MASK_DEFAULT_EXPOSURE, buildLibraryUrl, collectionForPhoto, createLibraryClient, groupRetouchStrokes, hasStraightenHorizon, isDeletableCollection, isDenoiseActive, isFaceAdjustStored, isInspectorVisible, isRecentlyEdited, normalizeSelectiveAdjust, parseLibraryUrl, photoInCollection, remapRetouchesForStraighten, rotateRetouches, shouldEscapeToLibrary } from '@f8/core';
import { RAW_ACCEPT, formatImportProgress, formatUploadSummary, importPercent, sortAlbumPhotos } from '@f8/core';
import { useEditor, useLibrary } from '@f8/ui';
import type { AlbumSortDir, AlbumSortKey, DetectionPreview, DialogType, EditState, Tool, ViewMode } from '@f8/core';
import { Sidebar } from '@f8/ui';
import { AppStatus, MenuBar, Toolbar, type MenuAction } from '@f8/ui';
import { PhotoCanvas, type HistogramData } from '@f8/ui';
import { Filmstrip, PhotoBrowser, PresetStrip } from '@f8/ui';
import { Inspector } from '@f8/ui';
import { EditorDialogs } from '@f8/ui';
import { useVisionWorker } from './vision/useVisionWorker';
import { useStraighten } from './vision/useStraighten';
import { useObjectRemoval } from './vision/useObjectRemoval';
import { useDustSpots } from './vision/useDustSpots';
import { useFaceEnhance } from './vision/useFaceEnhance';
import { useSelectiveMask } from './vision/useSelectiveMask';
import { useDenoise } from './vision/useDenoise';
import { useSemanticSearch } from './vision/useSemanticSearch';
import { useCullAssist } from './vision/useCullAssist';
import type { SelectiveAdjustParams, SelectiveTarget } from '@f8/core';
import { useInpaintRepair } from './vision/useInpaintRepair';
import { fetchSuperresHealth, runRemoteSuperres, warmupRemoteSuperres } from './vision/remoteSuperres';
import { FsBrowser } from './components/FsBrowser';
import { readToolPrefs, writeToolPrefsRaw } from './hooks/useToolPrefs';

const collectionTitles: Record<string, string> = { all: 'All Photos', favorites: 'Favorites', edited: 'Recently Edited' };

type FolderDialog = { mode: 'import' } | { mode: 'locate'; photoId: string };

interface InitialUrl {
  view: ViewMode;
  photoId: string;
  collectionId: string;
  tool: Tool;
}

// The deep-link decides the starting view: ?photo= opens the editor (the
// album is inferred from the photo), ?album= opens that album's grid.
// Bare or malformed URLs open the editor on the seed photo, as before.
function initialUrl(): InitialUrl {
  const fallback: InitialUrl = { view: 'editor', photoId: 'photo-1', collectionId: 'all', tool: 'adjust' };
  try {
    const parsed = parseLibraryUrl(window.location.search);
    if (parsed.photoId) {
      return { view: 'editor', photoId: parsed.photoId, collectionId: 'all', tool: parsed.tool ?? 'adjust' };
    }
    if (parsed.collectionId) {
      return { view: 'library', photoId: 'photo-1', collectionId: parsed.collectionId, tool: 'adjust' };
    }
  } catch {
    /* Non-browser context — fall through to defaults. */
  }
  return fallback;
}

export type EditedFilter = 'all' | 'edited' | 'unedited';
export type FavoriteFilter = 'all' | 'favorited' | 'not';
export type CullFilter = 'all' | 'blurry';

// Live import status: determinate file counts for dropped/picked files, or a
// bare label (total 0) for folder scans, which resolve to one long request.
interface ImportStatus {
  done: number;
  total: number;
  label?: string;
}

// Persistent progress toast: unlike notify() toasts it never auto-dismisses,
// so bulk imports keep their status line until the final summary lands.
function ImportProgressToast({ status }: { status: ImportStatus }) {
  const determinate = status.total > 0;
  const text = status.label ?? formatImportProgress(status.done, status.total);
  return <div
    className="toast importing"
    role="progressbar"
    aria-label={text}
    aria-valuemin={0}
    aria-valuemax={determinate ? status.total : undefined}
    aria-valuenow={determinate ? status.done : undefined}
  >
    <span className="loading-spinner small" aria-hidden="true" />
    <span className="importing-body">
      <span>{text}</span>
      <span className={`import-bar${determinate ? '' : ' is-indeterminate'}`} aria-hidden="true">
        <span style={determinate ? { width: `${importPercent(status.done, status.total)}%` } : undefined} />
      </span>
    </span>
  </div>;
}

export default function App() {
  const library = useLibrary();
  const { photos, albums, customPresets } = library;
  // Parsed once: the deep-link decides the starting view.
  const [start] = useState(initialUrl);
  const [selectedId, setSelectedId] = useState(start.photoId);
  const [collection, setCollection] = useState(start.collectionId);
  const [search, setSearch] = useState('');
  // Grid multi-selection (Ctrl/Cmd-click, Shift-click, marquee): photo ids in
  // selection order. Cleared below whenever the list identity changes.
  const [selection, setSelection] = useState<string[]>([]);
  const [editedFilter, setEditedFilter] = useState<EditedFilter>('all');
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>('all');
  const [cullFilter, setCullFilter] = useState<CullFilter>('all');
  const [view, setView] = useState<ViewMode>(start.view);
  const [tool, setTool] = useState<Tool>(start.tool);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 1080);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 760);
  const [presetsOpen, setPresetsOpen] = useState(() => readToolPrefs().presetsOpen);
  const [filmstripOpen, setFilmstripOpen] = useState(() => readToolPrefs().filmstripOpen);
  const [compare, setCompare] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [sortKey, setSortKey] = useState<AlbumSortKey>(() => readToolPrefs().albumSortKey);
  const [sortDir, setSortDir] = useState<AlbumSortDir>(() => readToolPrefs().albumSortDir);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [brushSize, setBrushSize] = useState(() => readToolPrefs().brushSize);
  const [brushStrength, setBrushStrength] = useState(() => readToolPrefs().brushStrength);
  const [straightenDragging, setStraightenDragging] = useState(false);
  const [highlightStroke, setHighlightStroke] = useState<number | null>(null);
  // Removal candidate hovered in the repair sidebar (person or dust-spot
  // list row); the canvas previews its region in red like a healed area.
  const [highlightRemoval, setHighlightRemoval] = useState<{ source: 'removal' | 'dust'; index: number } | null>(null);
  const [clipboard, setClipboard] = useState<EditState | null>(null);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const [removeAlbumTargetId, setRemoveAlbumTargetId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  const [toast, setToast] = useState('');
  const [importProgress, setImportProgress] = useState<ImportStatus | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const importRun = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photo = photos.find((item) => item.id === selectedId) || photos[0];
  const editor = useEditor(photo?.id ?? selectedId, { initial: library.editsSeed, onPersist: library.saveEdit });
  const vision = useVisionWorker();
  const straighten = useStraighten(photo?.id ?? selectedId);
  const objectRemoval = useObjectRemoval(photo?.id ?? selectedId);
  const dustSpots = useDustSpots(photo?.id ?? selectedId);
  const faceEnhance = useFaceEnhance(photo?.id ?? selectedId);
  const selectiveMask = useSelectiveMask(photo?.id ?? selectedId);
  const denoise = useDenoise(photo?.id ?? selectedId);
  const semantic = useSemanticSearch();
  const cull = useCullAssist();
  const inpaintRepair = useInpaintRepair();
  // Canvas binding: ML strokes are gated until the tier is warmed, so the
  // brush cursor stays hidden and painting is ignored while loading.
  const canvasRepairBinding = useMemo(() => {
    if (inpaintRepair.method !== "ml-heal") return { ...inpaintRepair, mlReady: true as const, mlWarming: false as const };
    const needsModel = inpaintRepair.mlEngine !== "classic";
    const ready = !needsModel || (inpaintRepair.mlReady?.engine === inpaintRepair.mlEngine && inpaintRepair.mlReady.cached);
    return { ...inpaintRepair, mlReady: ready, mlWarming: inpaintRepair.mlWarming };
  }, [inpaintRepair]);
  // Prefetch the ML engine's weights while the user picks a brush: the first
  // stroke then inpaints immediately instead of waiting on the download.
  // Fire-and-forget by design — jobs fall back down the tier chain anyway.
  useEffect(() => {
    if (tool === 'repair' && inpaintRepair.method === 'ml-heal') {
      void inpaintRepair.warmup().catch(() => { /* Fallback chain covers it. */ });
    }
    // Narrow deps: the inpaintRepair object identity changes on every ML
    // progress tick, which must not re-trigger the prefetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, inpaintRepair.method, inpaintRepair.warmup]);
  // Persist tool preferences (brush, panels, album sort) across reloads.
  // Adjust sliders are excluded by design — those persist per-photo on the
  // server.
  useEffect(() => {
    writeToolPrefsRaw({ brushSize, brushStrength, presetsOpen, filmstripOpen, albumSortKey: sortKey, albumSortDir: sortDir });
  }, [brushSize, brushStrength, presetsOpen, filmstripOpen, sortKey, sortDir]);
  // Deep-link the view so a reload or shared URL restores it. View-only
  // pointer: edits still live on the server. Inside a photo the URL names
  // the photo (?photo=&tool=) and the album is inferred from it below, so
  // sidebar, toolbar, and filmstrip can never disagree with the photo. In
  // an album the URL names the collection (?album=) instead: there is no
  // open photo to infer from, so a stale photo id would lie about what's
  // on screen. Same-view updates replaceState (no history spam on every
  // filmstrip click); view switches pushState so Back returns to the
  // previous view with its URL. Writing fresh params also strips stale
  // mixed ?photo=&album= pairs and legacy ?collection= links.
  const photoIdForUrl = photo?.id ?? selectedId;
  const lastUrlView = useRef(start.view);
  useEffect(() => {
    try {
      const query = view === 'library'
        ? buildLibraryUrl({ view: 'library', collectionId: collection })
        : buildLibraryUrl({ view: 'editor', photoId: photoIdForUrl, tool });
      const url = `${window.location.pathname}${query}`;
      // Back/forward already landed on this URL: the popstate handler set
      // the state, so there is nothing to write (and pushing would fork
      // the history stack the user is walking).
      if (`${window.location.pathname}${window.location.search}` === url) {
        lastUrlView.current = view;
        return;
      }
      if (lastUrlView.current === view) {
        window.history.replaceState(null, '', url);
      } else {
        lastUrlView.current = view;
        window.history.pushState(null, '', url);
      }
    } catch {
      /* Non-browser / restricted context — URL stays as-is. */
    }
  }, [view, photoIdForUrl, tool, collection]);
  // The open photo decides the collection: sidebar, toolbar, and filmstrip
  // always agree with what's on screen. Gated on photo change (not
  // collection change) so picking a collection in the sidebar — same photo,
  // library view — is never yanked back. The first photo always adopts its
  // album: the 'all' default contains everything, so the outside-check alone
  // would never fire on load. Editor-only: in the grid the collection is
  // user- or URL-driven, and adopting here would clobber a deep-linked
  // ?album= on load. The photo id is still recorded, so opening a photo
  // from the grid infers normally once the view flips to editor.
  const lastPhotoId = useRef<string | null>(null);
  useEffect(() => {
    if (!photo) return;
    const firstPhoto = lastPhotoId.current === null;
    if (lastPhotoId.current === photo.id) return;
    lastPhotoId.current = photo.id;
    if (view !== 'editor') return;
    if (firstPhoto || !photoInCollection(photo, collection)) setCollection(collectionForPhoto(photo));
  }, [photo, collection, view]);
  // A deep-linked album may not exist (removed, or a hand-typed URL):
  // fall back to All Photos once the library is in, instead of an empty
  // grid titled 'Your Photos'. Built-ins always resolve.
  useEffect(() => {
    if (view !== 'library' || library.status !== 'ready') return;
    if (collection === 'all' || collection === 'favorites' || collection === 'edited') return;
    if (!albums.some((album) => album.id === collection)) setCollection('all');
  }, [view, collection, albums, library.status]);
  useEffect(() => {
    const onPopState = () => {
      try {
        const parsed = parseLibraryUrl(window.location.search);
        if (parsed.photoId) {
          // The photo wins over any album param (stale pairs resolve to
          // the photo); the collection follows via the inference effect.
          setSelectedId(parsed.photoId);
          if (parsed.tool) setTool(parsed.tool);
          setView('editor');
        } else if (parsed.collectionId) {
          setCollection(parsed.collectionId);
          setView('library');
        } else {
          // Bare URL: the default view is the editor; keep the open photo
          // rather than yanking back to the seed.
          setView('editor');
        }
      } catch {
        /* Keep current state on malformed URLs. */
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const collectionName = albums.find((album) => album.id === collection)?.name || collectionTitles[collection] || 'Your Photos';
  const removeAlbumRow = dialog === 'remove-album' ? albums.find((album) => album.id === removeAlbumTargetId) ?? null : null;
  const removeAlbumTarget = removeAlbumRow ? { id: removeAlbumRow.id, name: removeAlbumRow.name, count: photos.filter((item) => item.albumId === removeAlbumRow.id).length } : null;
  const availablePresets = useMemo(() => [...PRESETS, ...customPresets], [customPresets]);
  // Live session recipes per photo: thumbnails prefer these over the last
  // persisted edit so the grid and filmstrip match the canvas immediately
  // instead of lagging the 500 ms save debounce.
  const liveEdits = useMemo(
    () => Object.fromEntries(Object.entries(editor.histories).map(([id, history]) => [id, history.present] as const)),
    [editor.histories],
  );

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

  // Server search rank for the current query (stale ranks never apply: the
  // hook tags every rank with its query, and anything else falls back to the
  // client-side substring filter over the loaded library).
  const trimmedSearch = search.trim();
  const searchRank = trimmedSearch && semantic.rank && semantic.rank.query === trimmedSearch ? semantic.rank : null;
  const filteredPhotos = useMemo(() => {
    let items = photos.filter((item) => {
      if (search) return true;
      if (collection === 'all') return true;
      if (collection === 'favorites') return item.favorite;
      if (collection === 'edited') return isRecentlyEdited(item);
      return item.albumId === collection;
    });
    if (searchRank) {
      const byId = new Map(items.map((item) => [item.id, item]));
      items = searchRank.ids.map((id) => byId.get(id)).filter((item): item is (typeof items)[number] => Boolean(item));
    } else if (search) {
      const query = search.toLowerCase();
      items = items.filter((item) => `${item.name} ${item.title} ${item.location} ${item.camera} ${(item.labels ?? []).map((entry) => entry.label).join(' ')}`.toLowerCase().includes(query));
    }
    if (editedFilter === 'edited') items = items.filter((item) => Boolean(item.edited));
    else if (editedFilter === 'unedited') items = items.filter((item) => !item.edited);
    if (favoriteFilter === 'favorited') items = items.filter((item) => item.favorite);
    else if (favoriteFilter === 'not') items = items.filter((item) => !item.favorite);
    // Cull flags ride the shared labels (ML-assigned or hand-added alike).
    if (cullFilter === 'blurry') items = items.filter((item) => (item.labels ?? []).some((entry) => entry.label === 'blurry'));
    // Semantic ranks carry their own relevance order; everything else sorts.
    if (searchRank?.mode === 'semantic') return items;
    return sortAlbumPhotos(items, sortKey, sortDir);
  }, [photos, collection, search, searchRank, sortKey, sortDir, editedFilter, favoriteFilter, cullFilter]);
  const searchNote = searchRank?.mode === 'semantic'
    ? `Semantic matches${searchRank.matched.length ? ` for “${searchRank.matched.join(', ')}”` : ''} · ML`
    : null;

  // Search text feeds both the client filter and the debounced server rank.
  const updateSearch = useCallback((value: string) => {
    setSearch(value);
    semantic.search(value);
  }, [semantic]);

  const selectPhoto = useCallback((id: string) => {
    setSelectedId(id);
    setView('editor');
    // Search is a library-finding aid: once a photo is open, the editor
    // context is its collection, so the filmstrip below agrees with the
    // sidebar. Chip filters persist (grid and filmstrip share them).
    setSearch('');
    semantic.search('');
    setZoom(1);
    setShowOriginal(false);
    setHighlightStroke(null);
  }, [semantic]);

  // Library shortcuts turn on the same chip filters used within each
  // album, so the grid always shows why it is narrowed. Recently Edited
  // additionally implies recency (last week) via the collection predicate.
  const selectCollection = (id: string) => {
    setCollection(id);
    setSearch('');
    semantic.search('');
    setEditedFilter(id === 'edited' ? 'edited' : 'all');
    setFavoriteFilter(id === 'favorites' ? 'favorited' : 'all');
    setCullFilter('all');
    setView('library');
    if (window.innerWidth < 760) setSidebarOpen(false);
  };

  // Chips narrow within albums, but the Library shortcuts are just entry
  // presets: touching any chip there drops back to All Photos with that
  // filter applied, so the sidebar never claims a scope the chips undid.
  // Re-clicking the active chip is a no-op, not a scope change.
  const handleEditedFilter = (value: EditedFilter) => {
    if (value === editedFilter) return;
    if (collection === 'favorites' || collection === 'edited') setCollection('all');
    setEditedFilter(value);
  };

  const handleFavoriteFilter = (value: FavoriteFilter) => {
    if (value === favoriteFilter) return;
    if (collection === 'favorites' || collection === 'edited') setCollection('all');
    setFavoriteFilter(value);
  };

  const handleCullFilter = (value: CullFilter) => {
    if (value === cullFilter) return;
    if (collection === 'favorites' || collection === 'edited') setCollection('all');
    setCullFilter(value);
  };

  const clearFilters = () => {
    if (collection === 'favorites' || collection === 'edited') setCollection('all');
    setEditedFilter('all');
    setFavoriteFilter('all');
    setCullFilter('all');
  };

  // A selection names photos in one list; navigating or narrowing the list
  // (or opening a photo, which clears the search) invalidates it.
  useEffect(() => {
    setSelection([]);
  }, [collection, search, editedFilter, favoriteFilter, cullFilter]);

  // Move grid photos into an album (context menu or sidebar drop). Photos
  // already home are skipped so a drop onto the current album is a no-op
  // with a note, not an error; the selection clears either way.
  const movePhotosToAlbum = useCallback((photoIds: string[], albumId: string) => {
    const target = albums.find((entry) => entry.id === albumId);
    if (!target) return;
    const moving = photoIds.filter((id) => photos.some((item) => item.id === id && item.albumId !== albumId));
    setSelection([]);
    if (!moving.length) {
      notify(`Already in "${target.name}".`);
      return;
    }
    void (async () => {
      try {
        await Promise.all(moving.map((id) => library.updatePhoto(id, { albumId })));
        notify(`Moved ${moving.length} ${moving.length === 1 ? 'photo' : 'photos'} to "${target.name}".`);
      } catch (reason) {
        notifyError(reason, 'Could not move the photos.');
      }
    })();
  }, [albums, photos, library, notify, notifyError]);

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

  // Removal is always confirmed: the dialog names the photo and promises the
  // original file stays on disk. The browser trash can target a photo other
  // than the open one, so the target id travels with the dialog.
  const requestRemove = useCallback((id: string) => {
    setRemoveTargetId(id);
    setDialog('remove');
  }, []);

  // Album deletion is always confirmed too. Only user albums reach the
  // dialog — the built-ins have no menu trigger, and the guard below makes
  // a stray call a no-op. Photos are never touched: they keep their album
  // id server-side and stay visible in All Photos.
  const requestRemoveAlbum = useCallback((id: string) => {
    if (!isDeletableCollection(id)) return;
    if (!albums.some((album) => album.id === id)) return;
    setRemoveAlbumTargetId(id);
    setDialog('remove-album');
  }, [albums]);

  const confirmRemoveAlbum = useCallback((id: string) => {
    const target = albums.find((album) => album.id === id);
    const kept = photos.filter((item) => item.albumId === id).length;
    setDialog(null);
    setRemoveAlbumTargetId(null);
    void library.removeAlbum(id).then(
      () => {
        // The open grid must not strand on a deleted album: the existing
        // unknown-collection effect also covers this, but switching
        // immediately avoids one empty-grid frame.
        setCollection((current) => (current === id ? 'all' : current));
        notify(target ? `"${target.name}" deleted. ${kept === 1 ? 'Its photo stays' : `Its ${kept} photos stay`} in your library.` : 'Album deleted.');
      },
      (reason: unknown) => notifyError(reason, 'Could not delete the album.'),
    );
  }, [albums, photos, library, notify, notifyError]);

  // Album ML labeling: embeds + labels every photo that lacks ML labels
  // yet (the hook downloads the weights once on first use, with progress).
  // The library reloads afterwards so the new labels land everywhere.
  const labelAlbumPhotos = useCallback((albumId: string) => {
    const album = albums.find((entry) => entry.id === albumId);
    void (async () => {
      try {
        const report = await semantic.labelAlbum(albumId);
        await library.retry();
        const name = album ? `"${album.name}"` : 'Album';
        const notes = [
          report.labeled.length ? `${name}: labeled ${report.labeled.length} ${report.labeled.length === 1 ? 'photo' : 'photos'} with ML.` : `${name}: everything already labeled — new imports label automatically.`,
          report.alreadyLabeled.length > 0 && report.labeled.length > 0 ? `${report.alreadyLabeled.length} already labeled.` : '',
          report.skipped.length ? `${report.skipped.length} skipped.` : '',
          report.failed.length ? `${report.failed.length} failed.` : '',
        ];
        notify(notes.filter(Boolean).join(' '));
      } catch (reason) {
        notifyError(reason, 'Could not label the album.');
      }
    })();
  }, [albums, library, notify, notifyError, semantic]);

  // Album ML cull assist: flags blurry photos and near-duplicate groups
  // (files the server already assessed are never re-detected). The library
  // reloads afterwards so the new flags land everywhere.
  const cullAlbumPhotos = useCallback((albumId: string) => {
    const album = albums.find((entry) => entry.id === albumId);
    void (async () => {
      try {
        const report = await cull.cullAlbum(albumId);
        await library.retry();
        const name = album ? `"${album.name}"` : 'Album';
        const duplicates = report.groups.reduce((total, group) => total + group.members.length - 1, 0);
        const checked = report.labeled.length;
        const head = checked
          ? `${name}: checked ${checked} ${checked === 1 ? 'photo' : 'photos'} with ML — ${report.blurry.length} blurry, ${duplicates} ${duplicates === 1 ? 'duplicate' : 'duplicates'}.`
          : `${name}: everything already checked.`;
        const notes = [
          head,
          report.alreadyLabeled.length > 0 && checked > 0 ? `${report.alreadyLabeled.length} already checked.` : '',
          report.skipped.length ? `${report.skipped.length} skipped.` : '',
          report.failed.length ? `${report.failed.length} failed.` : '',
        ];
        notify(notes.filter(Boolean).join(' '));
      } catch (reason) {
        notifyError(reason, 'Could not check the album.');
      }
    })();
  }, [albums, library, notify, notifyError, cull]);

  const confirmRemovePhoto = useCallback((id: string) => {
    const list = filteredPhotos.some((item) => item.id === id) ? filteredPhotos : photos;
    const index = list.findIndex((item) => item.id === id);
    const next = list[index + 1] ?? list[index - 1] ?? photos.find((item) => item.id !== id);
    setDialog(null);
    setRemoveTargetId(null);
    void library.removePhoto(id).then(
      () => {
        if (next && next.id !== id) setSelectedId(next.id);
        notify('Removed from your library. The original file is untouched.');
      },
      (reason: unknown) => notifyError(reason, 'Could not remove the photo.'),
    );
  }, [filteredPhotos, photos, library, notify, notifyError]);

  const selectTool = (next: Tool) => {
    setTool(next);
    setView('editor');
    setInspectorOpen((current) => window.innerWidth < 760 && next === tool ? !current : true);
    if (window.innerWidth < 760) setSidebarOpen(false);
    if (next === 'crop') { setCompare(false); setShowOriginal(false); }
  };

  // Records the last-used crop ratio as a tool preference (per-photo crop
  // state itself still lives on the server). Brush/repair prefs persist via
  // the tool-prefs effect and useInpaintRepair; Adjust sliders are excluded.
  const handleEditChange: typeof editor.change = useCallback((patch, mergeKey) => {
    if (patch.cropRatio !== undefined) {
      writeToolPrefsRaw({ cropRatio: patch.cropRatio });
    }
    editor.change(patch, mergeKey);
  }, [editor]);

  // Canvas preview for the hovered removal row: the detection's normalized
  // region, or null when the hover is stale (rescan, photo switch, dismiss).
  const removalPreview = useMemo((): DetectionPreview | null => {
    if (!highlightRemoval) return null;
    if (highlightRemoval.source === 'removal') {
      const detection = objectRemoval.detections[highlightRemoval.index];
      return detection ? { kind: 'box', box: detection.box } : null;
    }
    const spot = dustSpots.spots[highlightRemoval.index];
    return spot ? { kind: 'disc', x: spot.x, y: spot.y, radius: spot.radius } : null;
  }, [highlightRemoval, objectRemoval.detections, dustSpots.spots]);
  useEffect(() => { setHighlightRemoval(null); }, [photo?.id, tool]);

  // One-click removal: checked detections become repair strokes in one atomic
  // history entry (one stroke id per person, so each removal stays
  // individually deletable); the existing pipeline heals them from there.
  const applyObjectRemoval = useCallback(() => {
    if (!photo) return;
    const aspect = photo.height > 0 ? photo.width / photo.height : 1;
    const points = objectRemoval.apply(editor.edit.retouches, aspect);
    if (points.length === 0) return;
    const people = objectRemoval.detections.filter((detection) => detection.checked).length;
    handleEditChange({ retouches: [...editor.edit.retouches, ...points] });
    setHighlightRemoval(null);
    objectRemoval.dismiss();
    notify(`Removing ${people} ${people === 1 ? 'person' : 'people'} — healing with ${inpaintRepair.method === 'ml-heal' ? 'ML Repair' : 'the current repair method'}.`);
  }, [photo, editor, handleEditChange, objectRemoval, inpaintRepair.method]);

  // Auto dust spots: checked spots become repair strokes in one atomic
  // history entry (one stroke id per spot, so each repair stays
  // individually deletable); the existing pipeline heals them from there.
  const applyDustSpots = useCallback(() => {
    if (!photo) return;
    const points = dustSpots.apply(editor.edit.retouches);
    if (points.length === 0) return;
    const count = dustSpots.spots.filter((spot) => spot.checked).length;
    handleEditChange({ retouches: [...editor.edit.retouches, ...points] });
    setHighlightRemoval(null);
    dustSpots.dismiss();
    notify(`Repairing ${count} ${count === 1 ? 'spot' : 'spots'} — healing with ${inpaintRepair.method === 'ml-heal' ? 'ML Repair' : 'the current repair method'}.`);
  }, [photo, editor, handleEditChange, dustSpots, inpaintRepair.method]);

  // Face enhance: skin-anchored (or classic-fallback) white balance plus the
  // masked face lift and red-eye discs in one atomic history entry. A fresh
  // scan replaces the stored adjust, so Rescan never stacks lifts.
  const applyFaceEnhance = useCallback(() => {
    if (!photo || faceEnhance.state !== 'ready' || !faceEnhance.result) return;
    const { faces, source, skinWhiteBalance, classicWhiteBalance, faceAdjust } = faceEnhance.result;
    if (faces.length === 0) {
      faceEnhance.dismiss();
      notify('No faces found — nothing to enhance.');
      return;
    }
    const wb = skinWhiteBalance ?? classicWhiteBalance;
    handleEditChange({ temperature: wb.temperature, tint: wb.tint, whiteBalanceEnabled: true, faceAdjust });
    faceEnhance.dismiss();
    const ml = source === 'onnx' ? ' (ML)' : '';
    const parts = [
      `${faces.length} ${faces.length === 1 ? 'face' : 'faces'}`,
      skinWhiteBalance ? 'skin-anchored white balance' : 'white balance',
      ...(faceAdjust && faceAdjust.amount > 0 ? [`lift +${faceAdjust.amount} EV`] : []),
      ...(faceAdjust && faceAdjust.redEye.length > 0 ? [`${faceAdjust.redEye.length} red-eye`] : []),
    ];
    notify(`Face enhance${ml}: ${parts.join(', ')}.`);
  }, [photo, faceEnhance, handleEditChange]);

  // Toggle bypasses/restores the stored masked lift + red-eye discs without
  // deleting them (one undo step either way); the applied white balance
  // stays as plain slider values in both cases.
  const toggleFaceEnhance = useCallback(() => {
    const stored = editor.edit.faceAdjust;
    if (!photo || !isFaceAdjustStored(stored)) return;
    const enabled = stored.enabled === false;
    handleEditChange({ faceAdjust: { ...stored, enabled } });
    notify(enabled ? 'Face enhance on.' : 'Face enhance off — lift and red-eye fixes bypassed.');
  }, [photo, editor.edit.faceAdjust, handleEditChange]);

  // Clear removes the stored masked lift + red-eye discs; the applied white
  // balance stays as plain slider values (undo restores everything at once).
  const clearFaceEnhance = useCallback(() => {
    if (!photo) return;
    handleEditChange({ faceAdjust: null });
    notify('Face lift and red-eye fixes cleared.');
  }, [photo, handleEditChange]);

  // Selective mask: the segmented subject mask lands in the recipe the
  // moment segmentation finishes — no Apply step, so the subject and
  // background sliders preview live from the first drag and persist via the
  // normal recipe save. A rescan swaps the mask but keeps prior slider
  // values, so Rescan never loses work nor stacks masks.
  const selectiveResult = selectiveMask.state === 'ready' ? selectiveMask.result : null;
  useEffect(() => {
    if (!photo || !selectiveResult?.mask) return;
    const { mask, coverage, source } = selectiveResult;
    const prior = normalizeSelectiveAdjust(editor.edit.selectiveAdjust);
    // Idempotent: StrictMode double-effects (and re-renders before the
    // dismiss lands) must not stack duplicate undo entries.
    if (prior && prior.source === source && prior.maskB64 === mask.maskB64 && prior.maskWidth === mask.maskWidth && prior.maskHeight === mask.maskHeight) {
      selectiveMask.dismiss();
      return;
    }
    handleEditChange({
      selectiveAdjust: {
        maskB64: mask.maskB64,
        maskWidth: mask.maskWidth,
        maskHeight: mask.maskHeight,
        subject: prior?.subject ?? { exposure: SELECTIVE_MASK_DEFAULT_EXPOSURE, contrast: 0, saturation: 0 },
        background: prior?.background ?? { exposure: 0, contrast: 0, saturation: 0 },
        source,
      },
    });
    selectiveMask.dismiss();
    const ml = source === 'onnx' ? ' (ML)' : '';
    notify(`Subject segmented${ml}: ${Math.round(coverage * 100)}% of frame — drag either side's sliders.`);
    // Runs once per ready transition; dismiss() flips state back to idle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id, selectiveResult]);

  // Live-tweak one side's stored params; slider drags coalesce into one
  // undo step via the shared merge key. Normalizes legacy single-target
  // recipes on first touch, so old edits self-migrate.
  const adjustSelectiveMask = useCallback((target: SelectiveTarget, patch: Partial<SelectiveAdjustParams>) => {
    if (!photo) return;
    const stored = normalizeSelectiveAdjust(editor.edit.selectiveAdjust);
    if (!stored) return;
    handleEditChange({ selectiveAdjust: { ...stored, [target]: { ...stored[target], ...patch } } }, 'selective-mask');
  }, [photo, editor, handleEditChange]);

  const clearSelectiveMask = useCallback(() => {
    if (!photo) return;
    handleEditChange({ selectiveAdjust: null });
    notify('Selective adjustments cleared.');
  }, [photo, handleEditChange]);

  // Lightweight denoise always runs on the original pixels (photo.src):
  // the Inspector receives the original photo even while the canvas shows
  // the denoised base, so a re-run never denoises twice.
  const previewDenoise = useCallback((strength: number) => {
    if (!photo) return;
    denoise.previewPhoto(photo.src, strength);
  }, [photo, denoise]);

  const applyDenoise = useCallback((strength: number, auto: boolean) => {
    if (!photo) return;
    denoise.applyPhoto(photo.src, strength, auto);
  }, [photo, denoise]);

  const clearDenoise = useCallback(() => {
    if (!photo) return;
    denoise.clearApplied();
    handleEditChange({ denoise: null });
    notify('Denoise cleared — editing from the original.');
  }, [photo, denoise, handleEditChange]);

  // The full-res pass lands pixels in the hook first; this stores the
  // matching recipe strength in one undo step. Guarded on equality so the
  // patch never loops back in (and a restore at the stored strength is a
  // pixels-only no-op for the recipe).
  const denoiseBase = denoise.appliedBase;
  const denoiseRecipe = editor.edit.denoise;
  useEffect(() => {
    if (!photo || !denoiseBase) return;
    if (denoiseRecipe && denoiseRecipe.strength === denoiseBase.strength && denoiseRecipe.auto === denoiseBase.auto && denoiseRecipe.source === denoiseBase.source) return;
    handleEditChange({ denoise: { strength: denoiseBase.strength, auto: denoiseBase.auto, source: denoiseBase.source } });
    notify(`Denoised${denoiseBase.source === 'onnx' ? ' (ML)' : ''}: strength ${denoiseBase.strength}.`);
  }, [photo, denoiseBase, denoiseRecipe, handleEditChange, notify]);

  // The canvas and export edit from the denoised base while applied; every
  // other surface (Inspector runs, thumbnails, presets) keeps the original.
  const viewPhoto = useMemo(() => (
    photo && denoiseBase && isDenoiseActive(denoiseRecipe) ? { ...photo, src: denoiseBase.url } : photo
  ), [photo, denoiseBase, denoiseRecipe]);

  // Rotation turns repairs with the image in one atomic history entry, so
  // undo restores both together and they can never drift apart. The edit is
  // flushed immediately (rotation/retouches keep the preset label, so the
  // snapshot below is exactly what the history entry will hold): the heal
  // overlays for the new geometry are PUT right away, and a restart in the
  // debounce window must not find a stale edit that mismatches them.
  const rotateImage = useCallback((direction: 1 | -1) => {
    // A manual rotate after an ML straighten clears the Auto highlight: the
    // photo was edited after the detection, so the button no longer claims
    // the value. The rotation itself stays undoable as before.
    straighten.dismiss();
    const from = editor.edit.rotation;
    const to = (from + direction * 90) % 360;
    if (!editor.edit.retouches.length) {
      handleEditChange({ rotation: to });
      editor.flushPersist({ ...editor.edit, rotation: to });
      return;
    }
    const retouches = rotateRetouches(editor.edit.retouches, {
      fromRotation: from,
      toRotation: to,
      cropRatio: CROP_RATIOS[editor.edit.cropRatio] ?? null,
      sourceAspect: photo ? photo.width / photo.height : Number.NaN,
    });
    handleEditChange({ rotation: to, retouches });
    editor.flushPersist({ ...editor.edit, rotation: to, retouches });
  // straighten.dismiss is stable (the hook memoizes it); the assist result
  // object itself is recreated each render, so it stays out of the deps.
  }, [editor, handleEditChange, photo, straighten.dismiss]);

  // Straighten turns repairs with the image in one atomic history entry, so
  // free-angle turns keep healing the same features. The merge key passes
  // through untouched, preserving slider-drag undo coalescing. No persist
  // flush: straighten always resamples the content, so the reheal lands
  // seconds after the debounce has resolved.
  const changeStraighten = useCallback((next: number, mergeKey?: string) => {
    if (!Number.isFinite(next)) return;
    const from = editor.edit.straighten;
    if (from === next) return;
    if (!editor.edit.retouches.length) {
      handleEditChange({ straighten: next }, mergeKey);
      return;
    }
    handleEditChange({
      straighten: next,
      retouches: remapRetouchesForStraighten(editor.edit.retouches, {
        fromStraighten: from,
        toStraighten: next,
        rotation: editor.edit.rotation,
        cropRatio: CROP_RATIOS[editor.edit.cropRatio] ?? null,
        sourceAspect: photo ? photo.width / photo.height : Number.NaN,
      }),
    }, mergeKey);
  }, [editor, handleEditChange, photo]);

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
    // Overlapping imports each run to completion; only the latest drives the
    // progress toast, and a stale finish must not clear a live one.
    const run = ++importRun.current;
    const alive = () => importRun.current === run;
    setImportProgress({ done: 0, total: list.length });
    const summary = await library.uploadFiles(list, albumId, (progress) => {
      if (alive()) setImportProgress(progress);
    });
    if (alive()) setImportProgress(null);
    if (summary.firstId) {
      setCollection(albumId);
      setSearch('');
      semantic.search('');
      selectPhoto(summary.firstId);
    }
    notify(formatUploadSummary(summary));
  };

  const importFromPaths = async (paths: string[]) => {
    const albumId = albums.some((album) => album.id === collection) ? collection : 'imports';
    const locating = folderDialog?.mode === 'locate' ? folderDialog.photoId : null;
    setFolderDialog(null);
    const run = ++importRun.current;
    const alive = () => importRun.current === run;
    // Folder scans arrive as one request with no per-file ticks, so the toast
    // stays up with an indeterminate bar until the report lands.
    setImportProgress({ done: 0, total: 0, label: locating ? 'Relinking original…' : 'Importing from disk…' });
    try {
      const report = await library.importPaths(paths, albumId);
      const first = report.imported[0] ?? report.relinked[0] ?? report.duplicates[0];
      if (first) {
        if (!locating) {
          // An explicitly chosen album wins; otherwise the server filed
          // each folder into its own auto-created album, so follow the
          // photo home instead of the 'imports' pseudo-collection.
          const explicit = albums.some((album) => album.id === albumId);
          setCollection(explicit ? albumId : first.albumId);
        }
        setSearch('');
        semantic.search('');
        selectPhoto(first.id);
      }
      if (locating) {
        const healed = [...report.relinked, ...report.duplicates].some((item) => item.id === locating);
        notify(healed ? 'Original relinked. Your edits are back.' : 'That file does not match the missing photo.');
        return;
      }
      const createdAlbums = report.albums ?? [];
      const notes = [
        report.imported.length ? `${report.imported.length} ${report.imported.length === 1 ? 'photo' : 'photos'} imported.` : '',
        createdAlbums.length === 1 ? `New album "${createdAlbums[0]?.name}".` : '',
        createdAlbums.length > 1 ? `${createdAlbums.length} new albums created.` : '',
        report.relinked.length ? `${report.relinked.length} relinked with ${report.relinked.length === 1 ? 'its' : 'their'} edits intact.` : '',
        report.duplicates.length ? `${report.duplicates.length} already in your library.` : '',
        report.suppressedSidecars ? `${report.suppressedSidecars} JPEG sidecar${report.suppressedSidecars === 1 ? ' was' : 's were'} skipped: the RAW original was kept.` : '',
        report.skipped.length ? `${report.skipped.length} skipped.` : '',
        report.truncated ? 'Stopped at the per-import limit; run it again for the rest.' : '',
      ];
      notify(notes.filter(Boolean).join(' ') || 'Nothing to import.');
    } catch (reason) {
      notifyError(reason, 'Could not import from disk.');
    } finally {
      if (alive()) setImportProgress(null);
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
      case 'reset': {
        if (!photo) break;
        const groups = groupRetouchStrokes(editor.edit.retouches);
        const changed = editor.reset();
        denoise.clearApplied();
        // Deterministic overlay purge: the canvas orphan-sweep only runs on
        // the next paint, so a reset-then-close would leak server files.
        for (const group of groups) {
          void createLibraryClient().deleteHealOverlay(photo.id, group.id).catch(() => undefined);
        }
        notify(changed ? 'Adjustments reset. Your original is unchanged.' : 'Already showing the original — nothing to reset.');
        break;
      }
      case 'copy': copyAdjustments(); break;
      case 'paste': pasteAdjustments(); break;
      case 'enhance': editor.autoEnhance(photo?.src); setView('editor'); break;
      case 'enhance-scene': editor.autoEnhanceScene(photo?.src); setView('editor'); break;
      case 'enhance-faces': if (photo) faceEnhance.detect(photo.src); setView('editor'); setTool('adjust'); break;
      case 'rotate': rotateImage(-1); break;
      case 'favorite': toggleFavorite(); break;
      case 'remove': if (photo) requestRemove(photo.id); break;
      case 'sidebar': setSidebarOpen((current) => !current); if (window.innerWidth < 760) setInspectorOpen(false); break;
      case 'inspector': setInspectorOpen((current) => !current); break;
      case 'presets': setPresetsOpen((current) => !current); break;
      case 'filmstrip': setFilmstripOpen((current) => !current); break;
      case 'compare': if (tool === 'crop') break; setCompare((current) => !current); setView('editor'); break;
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
        const shortcut = key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' && !event.shiftKey ? 'redo' : key === 'o' ? event.shiftKey ? 'import-folder' : 'import' : event.shiftKey && key === 'e' ? 'export' : event.shiftKey && key === 'c' ? 'copy' : event.shiftKey && key === 'v' ? 'paste' : null;
        if (shortcut) { event.preventDefault(); actionRef.current(shortcut); }
        return;
      }
      if (event.key === '\\') { event.preventDefault(); setShowOriginal(true); return; }
      if (key === 'delete' || key === 'backspace') { event.preventDefault(); actionRef.current('remove'); return; }
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
      if (key === 'a' && event.shiftKey) { event.preventDefault(); actionRef.current('enhance-scene'); return; }
      if (key === 'e' && event.shiftKey) { event.preventDefault(); actionRef.current('enhance-faces'); return; }
      const actions: Record<string, MenuAction> = { a: 'enhance', f: 'favorite', b: 'compare', g: 'grid', r: 'rotate' };
      const tools: Record<string, Tool> = { v: 'adjust', c: 'crop', j: 'repair' };
      if (actions[key]) actionRef.current(actions[key]);
      if (tools[key]) toolRef.current(tools[key]);
      if (key === 'escape') { setCompare(false); setTool('adjust'); if (shouldEscapeToLibrary(view)) setView('library'); return; }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === '\\') setShowOriginal(false); };
    const onBlur = () => setShowOriginal(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, [dialog, filteredPhotos, selectedId, selectPhoto, view]);

  // ML scene enhance requested from a library-grid or filmstrip context
  // menu: the editor hook is bound to the selected photo, so the request
  // parks until the newly selected photo is open and seeded, then runs once.
  const pendingSceneEnhance = useRef<string | null>(null);
  const requestSceneEnhance = (id: string) => {
    pendingSceneEnhance.current = id;
    selectPhoto(id);
    setView('editor');
  };
  useEffect(() => {
    if (pendingSceneEnhance.current === null || !photo || photo.id !== pendingSceneEnhance.current) return;
    if (view !== 'editor' || !editor.ready) return;
    pendingSceneEnhance.current = null;
    editor.autoEnhanceScene(photo.src);
  });

  // ML 2x export requested from a library-grid or filmstrip context menu:
  // like scene enhance the request parks until the photo is open and seeded
  // (the export dialog reads the editor's recipe), then opens the export
  // dialog with super-resolution pre-checked.
  const pendingExport2x = useRef<string | null>(null);
  const [export2xArmed, setExport2xArmed] = useState(false);
  const requestExport2x = (id: string) => {
    pendingExport2x.current = id;
    selectPhoto(id);
    setView('editor');
  };
  useEffect(() => {
    if (pendingExport2x.current === null || !photo || photo.id !== pendingExport2x.current) return;
    if (view !== 'editor' || !editor.ready) return;
    pendingExport2x.current = null;
    setExport2xArmed(true);
    setDialog('export');
  });

  // Server 2x upscale transport for the export dialog: warmup first (lazy
  // ~64MB weights with progress), then the tiled upscale. Stateless, so one
  // memo serves every dialog open.
  const superresBinding = useMemo(() => ({
    run: async (image: { width: number; height: number; data: Uint8ClampedArray }, options?: { onProgress?: (fraction: number, stage: string) => void; signal?: AbortSignal }) => {
      await warmupRemoteSuperres({ onProgress: options?.onProgress, signal: options?.signal });
      return runRemoteSuperres(image, options);
    },
    health: () => fetchSuperresHealth(),
  }), []);

  // ML face enhance requested from a library-grid or filmstrip context
  // menu: like scene enhance the request parks until the photo is open and
  // seeded, then detection runs and auto-applies once it resolves.
  const pendingFaceEnhance = useRef<string | null>(null);
  const pendingFaceApply = useRef(false);
  const requestFaceEnhance = (id: string) => {
    pendingFaceEnhance.current = id;
    selectPhoto(id);
    setView('editor');
  };
  useEffect(() => {
    if (pendingFaceEnhance.current === null || !photo || photo.id !== pendingFaceEnhance.current) return;
    if (view !== 'editor' || !editor.ready) return;
    pendingFaceEnhance.current = null;
    pendingFaceApply.current = true;
    setTool('adjust');
    faceEnhance.detect(photo.src);
  });
  useEffect(() => {
    if (!pendingFaceApply.current) return;
    if (faceEnhance.state === 'ready') {
      pendingFaceApply.current = false;
      applyFaceEnhance();
    } else if (faceEnhance.state === 'error' || faceEnhance.state === 'idle') {
      pendingFaceApply.current = false;
    }
  });

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
      {importProgress && <ImportProgressToast status={importProgress} />}
    </div>;
  }

  // The adjustments panel edits the open photo, so it only exists in the
  // editor view: in the library no photo is in focus and the same shell
  // class + mount gate keeps the grid full-width. The open/closed
  // preference itself is untouched, so returning to a photo restores it.
  const showInspector = isInspectorVisible(view, inspectorOpen);
  // Below-horizon detection result: nothing was applied, so the outcome is
  // flashed over the photo through the shared tool-hint overlay (same
  // mechanism as the Repair hint). Keyed by runId so every attempt flashes.
  const straightenFlash = straighten.state === 'ready' && !hasStraightenHorizon(straighten.confidence)
    ? { runId: straighten.runId, message: 'No clear horizon found — adjust Straighten manually.' }
    : null;
  return <div className={`app-shell ${sidebarOpen ? 'has-sidebar' : ''} ${showInspector ? 'has-inspector' : ''}`} onDragEnter={(event) => handleDrag(event, true)} onDragLeave={(event) => handleDrag(event, false)} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); dragCount.current = 0; setDragging(false); void importFiles(event.dataTransfer.files); }}>
    <MenuBar onAction={handleAction} canUndo={editor.canUndo} canRedo={editor.canRedo} canPaste={Boolean(clipboard)} compareDisabled={tool === 'crop'} sidebar={sidebarOpen} inspector={inspectorOpen} presets={presetsOpen} filmstrip={filmstripOpen} />
    <Toolbar collectionName={collectionName} count={filteredPhotos.length} tool={tool} enhanced={editor.edit.autoEnhanced} compare={compare} canUndo={editor.canUndo} canRedo={editor.canRedo} libraryView={view === 'library'} presetsOpen={presetsOpen} onTool={selectTool} onAction={handleAction} onDialog={setDialog} onTogglePresets={() => { setPresetsOpen((current) => !current); setView('editor'); }} />
    <div className="workspace">
      {sidebarOpen && <Sidebar photos={photos} albums={albums} collection={collection} search={search} onSearch={(value) => { updateSearch(value); setView('library'); }} onSelect={selectCollection} onImport={() => fileInput.current?.click()} onNewAlbum={() => setDialog('album')} onRemoveAlbum={requestRemoveAlbum} onLabelAlbum={labelAlbumPhotos} onCullAlbum={cullAlbumPhotos} onMoveToAlbum={movePhotosToAlbum} />}
      <main className="editor-column">
        {view === 'library' ? (
          <PhotoBrowser photos={filteredPhotos} title={collectionName} search={search} searchNote={searchNote} edits={liveEdits} album={albums.find((album) => album.id === collection) ?? null} albums={albums} editedFilter={editedFilter} favoriteFilter={favoriteFilter} onEditedFilter={handleEditedFilter} onFavoriteFilter={handleFavoriteFilter} onClearFilters={clearFilters} cullFilter={cullFilter} onCullFilter={handleCullFilter} onSelect={selectPhoto} onFavorite={toggleFavorite} onRemove={requestRemove} onRemoveAlbum={requestRemoveAlbum} onLabelAlbum={labelAlbumPhotos} onCullAlbum={cullAlbumPhotos} onSceneEnhance={requestSceneEnhance} onFaceEnhance={requestFaceEnhance} onExport2x={requestExport2x} selectedIds={selection} onSelectionChange={setSelection} onMoveToAlbum={movePhotosToAlbum} onImport={() => fileInput.current?.click()} scrollKey={`${collection}|${search}|${editedFilter}|${favoriteFilter}|${cullFilter}|${sortKey}|${sortDir}`} sortKey={sortKey} sortDir={sortDir} onSortChange={(key, dir) => { setSortKey(key); setSortDir(dir); }} activeId={photo?.id} />
        ) : (
          <>
            {!editor.ready ? (
              <div className="library-gate" role="status"><span className="loading-spinner" aria-hidden="true" /><p>Developing your photo…</p></div>
            ) : photo.missing ? (
              <div className="missing-original" role="alert">
                <FolderSearch size={40} strokeWidth={1.25} />
                <h2>The original file moved.</h2>
                <p>Your edits are safe. Reimport <strong>{photo.name}</strong> from its new location to relink them.</p>
                {photo.path && <span className="missing-path">Last seen at {photo.path}</span>}
                <button className="primary-button" onClick={() => setFolderDialog({ mode: 'locate', photoId: photo.id })}>Locate original…</button>
              </div>
            ) : (
              <PhotoCanvas
                photo={viewPhoto ?? photo} edit={editor.edit} tool={tool} zoom={zoom}
                compare={compare} showOriginal={showOriginal} originalSrc={photo.src}
                brushSize={brushSize} brushStrength={brushStrength} fineGrid={straightenDragging} straightenFlash={straightenFlash}
                inpaintRepair={canvasRepairBinding}
                highlightStroke={highlightStroke} onHighlightStroke={setHighlightStroke} highlightRegion={removalPreview}
                onZoom={setZoom} onCompare={() => setCompare(!compare)}
                onFavorite={() => toggleFavorite()} onRating={setRating} onRemove={() => requestRemove(photo.id)}
                onInfo={() => setDialog('info')} onChange={editor.change} onEndMerge={editor.endMerge} onHistogram={setHistogram}
              />
            )}
            {presetsOpen && <PresetStrip
              photo={photo} presets={availablePresets} selected={editor.edit.preset}
              onSelect={editor.applyPreset} onAdd={() => setDialog('preset')} onToggle={() => setPresetsOpen(false)}
            />}
            {filmstripOpen && <Filmstrip
              photos={filteredPhotos} selectedId={photo.id} collectionName={collectionName} edits={liveEdits}
              onSelect={selectPhoto} onGrid={() => setView('library')}
              onSort={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')} reversed={sortDir === 'desc'} sortKey={sortKey}
              showPresets={presetsOpen} onShowPresets={() => setPresetsOpen(true)}
              onSceneEnhance={requestSceneEnhance} onFaceEnhance={requestFaceEnhance} onExport2x={requestExport2x} onFavorite={toggleFavorite} onRemove={requestRemove}
            />}
          </>
        )}
      </main>
      {showInspector && <Inspector
        photo={photo} edit={editor.edit} tool={tool} histogram={histogram} denoiseAssist={{ state: denoise.status, preview: denoise.preview, applied: isDenoiseActive(editor.edit.denoise) ? editor.edit.denoise : null, hasBase: Boolean(denoise.appliedBase), progress: denoise.progress, note: denoise.note, message: denoise.message, onPreview: previewDenoise, onApply: applyDenoise, onClear: clearDenoise, onDismiss: denoise.dismiss }}
        brushSize={brushSize} brushStrength={brushStrength} canPaste={Boolean(clipboard)}
        straightenAssist={{ state: straighten.state, angle: straighten.angle, confidence: straighten.confidence, source: straighten.source, runId: straighten.runId, mlProgress: straighten.mlProgress, mlWarming: straighten.mlWarming, mlNote: straighten.mlNote, message: straighten.message, onDetect: () => straighten.detect(photo.src), onDismiss: straighten.dismiss, onCancelMl: straighten.cancelMl }}
        repairAssist={{ method: inpaintRepair.method, quality: inpaintRepair.quality, seamlessLight: inpaintRepair.seamlessLight, featherPx: inpaintRepair.featherPx, status: inpaintRepair.status, mlProgress: inpaintRepair.mlProgress, serverDown: inpaintRepair.serverDown, onCancelHeal: inpaintRepair.cancelHeal, onRetry: () => { void inpaintRepair.warmup().catch(() => { /* Failure is recorded in mlProgress/serverDown. */ }); }, onMethodChange: inpaintRepair.setMethod, onQualityChange: inpaintRepair.setQuality, onSeamlessLightChange: inpaintRepair.setSeamlessLight, onFeatherChange: inpaintRepair.setFeatherPx, removal: { state: objectRemoval.state, detections: objectRemoval.detections, source: objectRemoval.source, progress: objectRemoval.progress, note: objectRemoval.note, message: objectRemoval.message, highlighted: highlightRemoval?.source === 'removal' ? highlightRemoval.index : null, onDetect: () => objectRemoval.detect(photo.src), onToggle: objectRemoval.toggle, onHighlight: (index) => setHighlightRemoval(index === null ? null : { source: 'removal', index }), onApply: applyObjectRemoval, onDismiss: () => { setHighlightRemoval(null); objectRemoval.dismiss(); } }, dustSpots: { state: dustSpots.state, spots: dustSpots.spots, source: dustSpots.source, progress: dustSpots.progress, note: dustSpots.note, message: dustSpots.message, highlighted: highlightRemoval?.source === 'dust' ? highlightRemoval.index : null, onDetect: () => dustSpots.detect(photo.src), onToggle: dustSpots.toggle, onHighlight: (index) => setHighlightRemoval(index === null ? null : { source: 'dust', index }), onApply: applyDustSpots, onDismiss: () => { setHighlightRemoval(null); dustSpots.dismiss(); } }}}
        onStraightenDragging={setStraightenDragging}
        highlightStroke={highlightStroke} onHighlightStroke={setHighlightStroke}
        onChange={handleEditChange} onRotate={rotateImage} onStraighten={changeStraighten} onReset={() => handleAction('reset')}
        onAuto={() => editor.autoEnhance(photo.src)} onAutoScene={() => editor.autoEnhanceScene(photo.src)} faceAssist={{ state: faceEnhance.state, faces: faceEnhance.result?.faces.length ?? 0, source: faceEnhance.result?.source ?? null, whiteBalance: faceEnhance.result ? (faceEnhance.result.skinWhiteBalance ?? faceEnhance.result.classicWhiteBalance) : null, skinAnchored: Boolean(faceEnhance.result?.skinWhiteBalance), liftAmount: faceEnhance.result?.faceAdjust?.amount ?? 0, redEyeCount: faceEnhance.result?.faceAdjust?.redEye.length ?? 0, progress: faceEnhance.progress, note: faceEnhance.note, message: faceEnhance.message, applied: isFaceAdjustStored(editor.edit.faceAdjust) ? { faces: editor.edit.faceAdjust.boxes.length, source: editor.edit.faceAdjust.source, enabled: editor.edit.faceAdjust.enabled !== false, liftAmount: editor.edit.faceAdjust.amount, redEyeCount: editor.edit.faceAdjust.redEye.length } : null, onDetect: () => faceEnhance.detect(photo.src), onApply: applyFaceEnhance, onToggle: toggleFaceEnhance, onClear: clearFaceEnhance, onDismiss: faceEnhance.dismiss }} selectiveAssist={{ state: selectiveMask.state, found: Boolean(selectiveMask.result?.mask), coverage: selectiveMask.result?.coverage ?? 0, source: selectiveMask.result?.source ?? null, progress: selectiveMask.progress, note: selectiveMask.note, message: selectiveMask.message, applied: normalizeSelectiveAdjust(editor.edit.selectiveAdjust), onDetect: () => selectiveMask.detect(photo.src), onAdjust: adjustSelectiveMask, onClear: clearSelectiveMask, onDismiss: selectiveMask.dismiss }} onAutoWhiteBalance={() => editor.autoWhiteBalance(photo.src)} onAutoLightness={() => editor.autoLightness(photo.src)} onAutoColor={() => editor.autoColor(photo.src)} mlApplied={editor.mlApplied} onCopy={copyAdjustments} onPaste={pasteAdjustments}
        onSavePreset={() => setDialog('preset')} onBrushSize={setBrushSize} onBrushStrength={setBrushStrength}
        onClose={() => setInspectorOpen(false)}
      />}
    </div>
    <AppStatus
      count={photos.length}
      vision={{
        status: vision.status,
        version: vision.version,
        selfTest: vision.selfTest,
        onActivate: () => void vision.ensureReady(),
      }}
    />
    <input className="hidden" ref={fileInput} type="file" multiple accept={`image/*,${RAW_ACCEPT}`} aria-label="Import photos" onChange={(event) => { if (event.target.files) void importFiles(event.target.files); event.target.value = ''; }} />
    <EditorDialogs dialog={dialog} photo={dialog === 'remove' ? (photos.find((item) => item.id === removeTargetId) ?? photo) : (viewPhoto ?? photo)} edit={editor.edit} inpaintRepair={canvasRepairBinding} superres={superresBinding} initialSuperres={export2xArmed} onClose={() => { setDialog(null); setRemoveTargetId(null); setRemoveAlbumTargetId(null); setExport2xArmed(false); }} onToast={notify} onCreateAlbum={createAlbum} onSavePreset={savePreset} onRemovePhoto={confirmRemovePhoto} removeAlbum={removeAlbumTarget} onRemoveAlbum={confirmRemoveAlbum} onAddLabel={(photoId, label) => { void library.updateLabels(photoId, { add: [label] }).then(() => notify(`Labeled “${label}”.`), (reason: unknown) => notifyError(reason, 'Could not add the label.')); }} onRemoveLabel={(photoId, label) => { void library.updateLabels(photoId, { remove: [label] }).catch((reason: unknown) => notifyError(reason, 'Could not remove the label.')); }} onSearchLabel={(label) => { setDialog(null); setCollection('all'); clearFilters(); updateSearch(label); setView('library'); }} />
    {folderDialog && <FsBrowser
      title={folderDialog.mode === 'locate' ? 'Locate original' : 'Import from folder'}
      subtitle={folderDialog.mode === 'locate' ? 'Find the file in its new home.' : 'Referenced in place — nothing is copied.'}
      actionLabel={folderDialog.mode === 'locate' ? 'Relink photo' : 'Import selected'}
      onClose={() => setFolderDialog(null)}
      onSelect={(paths) => void importFromPaths(paths)}
    />}
    {toast && <div className="toast" role="status"><span className="toast-check"><Check size={13} /></span><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={13} /></button></div>}
    {importProgress && <ImportProgressToast status={importProgress} />}
    {semantic.labeling && <ImportProgressToast status={{ done: 0, total: 0, label: semantic.labelProgress?.stage ?? 'Labeling album…' }} />}
    {cull.culling && <ImportProgressToast status={{ done: 0, total: 0, label: 'Finding blurry photos…' }} />}
    {dragging && <div className="drop-overlay"><div><ImagePlus size={43} strokeWidth={1.25} /><h2>A new perspective.</h2><p>Drop your photos anywhere to start creating.</p><span>JPEG, PNG, WebP, RAW and more</span></div></div>}
  </div>;
}
