import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Check, ChevronDown, ChevronUp, Grid2X2, Heart, MoreHorizontal, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { ALBUM_SORT_KEYS, ALBUM_SORT_LABELS, DEFAULT_ALBUM_SORT_DIR, DEFAULT_ALBUM_SORT_KEY, DEFAULT_EDIT } from '@f8/core';
import { computeGridWindow, filmstripCenteredScrollOffset, filmstripGridArrowIndex, filmstripOverflows, filmstripWheelShift, getPhotoFilter, isBuiltInCollection, isPortraitPhoto, thumbnailFilterForPhoto } from '@f8/core';
import type { Album, AlbumSortDir, AlbumSortKey, EditState, Photo, Preset } from '@f8/core';

/** A grid/filmstrip photo with its edit recipe attached when known (library photos carry `edit`). */
export type PhotoWithEdit = Photo & { edit?: EditState | null };
import { IconButton, MenuItem } from './EditorUI.js';

/** An open photo context menu: the target photo plus its viewport position. */
export interface PhotoContextMenuState {
  photoId: string;
  x: number;
  y: number;
}

// Right-click menu state shared by the library grid and the filmstrip.
// Dismisses on outside pointer-down and Escape, like the album menus.
// `initial` only seeds the first render (a test seam for the open markup).
function usePhotoContextMenu(initial?: PhotoContextMenuState | null) {
  const [menu, setMenu] = useState<PhotoContextMenuState | null>(initial ?? null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [menu]);
  const open = (photoId: string) => (event: { preventDefault(): void; clientX: number; clientY: number }) => {
    event.preventDefault();
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    setMenu({ photoId, x: Math.max(0, Math.min(event.clientX, viewportWidth - 240)), y: Math.max(0, Math.min(event.clientY, viewportHeight - 160)) });
  };
  return { menu, menuRef, open, close: () => setMenu(null) };
}

function PhotoContextMenu({ state, photoName, favorite, showRemove, menuRef, onSceneEnhance, onFaceEnhance, onExport2x, onFavorite, onRemove, onClose }: {
  state: PhotoContextMenuState;
  photoName: string;
  favorite: boolean;
  showRemove: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onSceneEnhance?: () => void;
  onFaceEnhance?: () => void;
  onExport2x?: () => void;
  onFavorite: () => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  return <div className="dropdown-menu photo-context-menu" role="menu" aria-label={`Actions for ${photoName}`} ref={menuRef} style={{ left: state.x, top: state.y }} data-testid="photo-context-menu">
    {onSceneEnhance && <MenuItem onClick={() => { onClose(); onSceneEnhance(); }}><span>Scene Enhance <span className="ml-badge" title="The scene is classified by a machine-learning model on your device">ML</span></span></MenuItem>}
    {onFaceEnhance && <MenuItem onClick={() => { onClose(); onFaceEnhance(); }}><span>Enhance Faces <span className="ml-badge" title="Faces are detected by a machine-learning model on the photo server">ML</span></span></MenuItem>}
    {onExport2x && <MenuItem onClick={() => { onClose(); onExport2x(); }}><span>Export 2x <span className="ml-badge" title="Doubled by a machine-learning model on the photo server">ML</span></span></MenuItem>}
    <MenuItem onClick={() => { onClose(); onFavorite(); }}>{favorite ? 'Remove Favorite' : 'Add Favorite'}</MenuItem>
    {showRemove && onRemove && <><div className="menu-separator" role="separator" /><MenuItem danger onClick={() => { onClose(); onRemove(); }}>Remove from Library…</MenuItem></>}
  </div>;
}

export function PresetStrip({ photo, presets, selected, onSelect, onAdd, onToggle }: { photo: Photo; presets: Preset[]; selected: string; onSelect: (preset: Preset) => void; onAdd: () => void; onToggle: () => void }) {
  const [category, setCategory] = useState('Essentials');
  useEffect(() => {
    const preset = presets.find((item) => item.name === selected);
    if (preset) setCategory(preset.category);
  }, [selected, presets]);
  const categories = ['Essentials', 'Cinematic', 'Black & White', ...(presets.some((preset) => preset.category === 'My Presets') ? ['My Presets'] : [])];
  const original = presets.find((preset) => preset.id === 'original') ?? presets.find((preset) => preset.name === 'Original');
  // Every preset thumb shows the same photo, so one strip-level class flips
  // them all between landscape crop and portrait letterbox.
  const portrait = isPortraitPhoto(photo);
  return <section className="presets-panel" aria-label="Photo presets"><div className="presets-heading"><div className="presets-title"><SlidersHorizontal size={13} /><h2>Presets</h2></div><nav className="preset-tabs" aria-label="Preset categories">{categories.map((name) => <button key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>{name}</button>)}</nav><div className="presets-actions"><IconButton label="Save current adjustments as a preset" onClick={onAdd}><Plus size={15} /></IconButton><IconButton label="Hide presets" onClick={onToggle}><ChevronDown size={14} /></IconButton></div></div><div className={`presets-list${portrait ? ' is-portrait' : ''}`}>{presets.filter((preset) => preset.category === category).map((preset) => {
    const isSelected = selected === preset.name;
    const isOriginal = preset.id === 'original';
    return <button className={`preset-item ${isSelected ? 'is-selected' : ''}`} key={preset.id} onClick={() => {
      if (!isSelected) { onSelect(preset); return; }
      // Clicking the active preset toggles it off by reverting to Original.
      // Re-clicking Original itself is a no-op, not an empty undo step.
      if (!isOriginal && original) onSelect(original);
    }} title={isSelected && !isOriginal ? 'Click again to revert to Original' : `Apply ${preset.name}`}><span className="preset-thumbnail">{photo.missing ? <span className="preset-missing-thumb" aria-hidden="true" /> : <img src={photo.thumbnail} alt="" style={{ filter: getPhotoFilter({ ...DEFAULT_EDIT, ...preset.values }) }} />}{isSelected && <span className="preset-check"><Check size={9} strokeWidth={2.8} /></span>}</span><span>{preset.name}</span></button>;
  })}</div></section>;
}

// Live column count for Up/Down focus math: the items sharing the first
// item's row (offsetTop within a pixel, for sub-pixel layout). Zero when
// unmeasurable — the grid helper then holds Up/Down rather than guessing.
function firstRowCount(items: HTMLButtonElement[]): number {
  if (items.length === 0) return 0;
  const top = items[0]?.offsetTop ?? 0;
  let count = 0;
  for (const item of items) {
    if (Math.abs(item.offsetTop - top) > 1) break;
    count += 1;
  }
  return count;
}

// The filmstrip toggle flips the direction of the shared album sort, so its
// label names the active key: "A to Z" for filenames, oldest/newest for the
// two timestamps.
function filmstripSortLabel(sortKey: AlbumSortKey, reversed: boolean): string {
  if (sortKey === 'filename') return reversed ? 'Sort filenames Z to A' : 'Sort filenames A to Z';
  if (sortKey === 'imported') return reversed ? 'Sort by import, oldest first' : 'Sort by import, newest first';
  return reversed ? 'Sort photos oldest first' : 'Sort photos newest first';
}

export function Filmstrip({ photos, selectedId, collectionName, edits, onSelect, onGrid, onSort, reversed, sortKey = DEFAULT_ALBUM_SORT_KEY, showPresets, onShowPresets, onSceneEnhance, onFaceEnhance, onExport2x, onFavorite, initialContextMenu }: { photos: PhotoWithEdit[]; selectedId: string; collectionName: string; edits?: Record<string, EditState>; onSelect: (id: string) => void; onGrid: () => void; onSort: () => void; reversed: boolean; sortKey?: AlbumSortKey; showPresets: boolean; onShowPresets: () => void; /** ML scene enhance from the right-click menu; omit to disable the menu. */ onSceneEnhance?: (id: string) => void; /** ML face enhance from the right-click menu. */ onFaceEnhance?: (id: string) => void; /** ML 2x export from the right-click menu. */ onExport2x?: (id: string) => void; onFavorite?: (id: string) => void; /** Seeds an open context menu (a test seam for the open markup). */ initialContextMenu?: PhotoContextMenuState | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  const contextMenu = usePhotoContextMenu(initialContextMenu);
  const menuPhoto = contextMenu.menu ? photos.find((photo) => photo.id === contextMenu.menu!.photoId) ?? null : null;
  // Opening a photo centers it horizontally (clamped at both ends) so
  // neighbors stay visible on both sides; vertically the row reveals with
  // nearest semantics. One computed scrollTo replaces scrollIntoView so
  // both axes settle together. Rects (not offsetLeft) measure the item so
  // the math holds whatever the offsetParent is.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-photo-id="${selectedId}"]`);
    if (!list || !item) return;
    const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const offset = filmstripCenteredScrollOffset({
      scrollLeft: list.scrollLeft, scrollTop: list.scrollTop,
      clientWidth: list.clientWidth, clientHeight: list.clientHeight,
      scrollWidth: list.scrollWidth, scrollHeight: list.scrollHeight,
      itemLeft: itemRect.left - listRect.left - list.clientLeft + list.scrollLeft,
      itemTop: itemRect.top - listRect.top - list.clientTop + list.scrollTop,
      itemWidth: itemRect.width, itemHeight: itemRect.height,
    });
    list.scrollTo({ left: offset.scrollLeft, top: offset.scrollTop, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [selectedId]);
  // With a single row a plain mouse wheel (vertical delta only) would do
  // nothing over the strip, so vertical-dominant wheels translate into
  // horizontal scroll; once rows overflow vertically the wheel scrolls them
  // natively instead. Horizontal gestures and zoom chords stay native.
  // A non-passive listener is required to preventDefault the wheel.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      const shift = filmstripWheelShift({
        deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
        zoomChord: event.ctrlKey || event.metaKey,
        canScrollX: filmstripOverflows(list.scrollWidth, list.clientWidth),
        canScrollY: filmstripOverflows(list.scrollHeight, list.clientHeight),
        clientWidth: list.clientWidth,
      });
      if (shift !== 0) { event.preventDefault(); list.scrollLeft += shift; }
    };
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => { list.removeEventListener('wheel', onWheel); };
  }, []);
  // Arrow keys walk focus through the rows (focusing an item scrolls it into
  // view), so keyboard users can reach photos past the visible edge.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-photo-id]'));
    const next = filmstripGridArrowIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length, firstRowCount(items));
    if (next === -1) return;
    event.preventDefault();
    items[next]?.focus();
    items[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  return <section className="filmstrip" aria-label="Photos in this collection"><div className="filmstrip-heading"><div><h2>{collectionName}</h2><span>{photos.length} photos</span></div><div className="filmstrip-actions">{!showPresets && <button className="show-presets" onClick={onShowPresets}>Presets<ChevronUp size={12} /></button>}<IconButton label={filmstripSortLabel(sortKey, reversed)} active={reversed} onClick={onSort}><ArrowDownWideNarrow size={14} /></IconButton><IconButton label="Show photo browser (G)" onClick={onGrid}><Grid2X2 size={13} /></IconButton></div></div><div className="filmstrip-list" ref={listRef} onKeyDown={onListKeyDown}>{photos.map((photo) => {
    const filter = thumbnailFilterForPhoto(photo, edits?.[photo.id]);
    return <button data-photo-id={photo.id} className={`filmstrip-item ${selectedId === photo.id ? 'is-selected' : ''} ${photo.missing ? 'is-missing' : ''}${isPortraitPhoto(photo) ? ' is-portrait' : ''}`} key={photo.id} onClick={() => onSelect(photo.id)} {...((onSceneEnhance || onFaceEnhance || onExport2x) ? { onContextMenu: contextMenu.open(photo.id) } : {})} title={`${photo.name} - ${photo.title}`} aria-label={`Open ${photo.title}`} aria-pressed={selectedId === photo.id}><span className="filmstrip-image"><img src={photo.thumbnail} alt={photo.title} loading="lazy" style={filter ? { filter } : undefined} />{photo.raw && <span className="thumb-raw">RAW</span>}{photo.missing && <span className="thumb-missing">Missing</span>}{photo.favorite && <Heart className="thumb-heart" size={10} fill="currentColor" />}</span><span className="filmstrip-filename">{photo.name.split('.')[0]}</span></button>;
  })}</div>{contextMenu.menu && menuPhoto && (onSceneEnhance || onFaceEnhance || onExport2x) && <PhotoContextMenu state={contextMenu.menu} photoName={menuPhoto.name} favorite={menuPhoto.favorite} showRemove={false} menuRef={contextMenu.menuRef} onSceneEnhance={onSceneEnhance ? () => onSceneEnhance(menuPhoto.id) : undefined} onFaceEnhance={onFaceEnhance ? () => onFaceEnhance(menuPhoto.id) : undefined} onExport2x={onExport2x ? () => onExport2x(menuPhoto.id) : undefined} onFavorite={() => onFavorite?.(menuPhoto.id)} onClose={contextMenu.close} />}</section>;
}

export type EditedFilter = 'all' | 'edited' | 'unedited';
export type FavoriteFilter = 'all' | 'favorited' | 'not';
/** ML cull-assist flags: blurry rejects vs flagged keepers. */
export type CullFilter = 'all' | 'blurry' | 'keepers';

export interface PhotoBrowserFilters {
  editedFilter: EditedFilter;
  favoriteFilter: FavoriteFilter;
  onEditedFilter: (value: EditedFilter) => void;
  onFavoriteFilter: (value: FavoriteFilter) => void;
  onClearFilters: () => void;
}

export interface PhotoBrowserCullFilter {
  cullFilter: CullFilter;
  onCullFilter: (value: CullFilter) => void;
}

/** True when a photo carries a cull flag (ML-assigned or hand-added). */
function hasCullLabel(photo: PhotoWithEdit, label: string): boolean {
  return (photo.labels ?? []).some((entry) => entry.label === label);
}

// Remembered grid scroll offsets per list identity (collection + filters).
// Module-level so the position survives the library → editor → library
// remount; sessionStorage mirrors it so a reload restores too.
const gridScrollMemory = new Map<string, number>();
const GRID_SCROLL_STORAGE_PREFIX = 'f8-grid-scroll:';

function readSavedScroll(key: string): number | null {
  const live = gridScrollMemory.get(key);
  if (typeof live === 'number' && Number.isFinite(live) && live >= 0) return live;
  try {
    const stored = sessionStorage.getItem(GRID_SCROLL_STORAGE_PREFIX + key);
    if (stored === null) return null;
    const value = Number(stored);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function saveScroll(key: string, top: number): void {
  if (!Number.isFinite(top) || top < 0) return;
  gridScrollMemory.set(key, top);
  try {
    sessionStorage.setItem(GRID_SCROLL_STORAGE_PREFIX + key, String(Math.round(top)));
  } catch {
    // Private mode / quota — the in-memory position still works.
  }
}

// Extra grid rows rendered above and below the viewport: scrolling stays
// seamless (no blank flash) without rendering the whole album.
const GRID_OVERSCAN_ROWS = 3;

interface GridMetrics {
  columns: number;
  rowHeight: number;
  rowGap: number;
  viewportHeight: number;
  scrollTop: number;
}

// Measure the live grid: the column count comes from the computed track
// list (so responsive overrides are honored, not just the size slider),
// and the row height from the first rendered item. Null until an item
// with a real layout exists — the grid renders fully until then.
function measureGrid(scrollEl: HTMLElement, gridEl: HTMLElement): GridMetrics | null {
  const item = gridEl.querySelector<HTMLElement>('.browser-photo');
  if (!item) return null;
  const gridStyle = getComputedStyle(gridEl);
  const columns = gridStyle.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  const rowHeight = item.offsetHeight;
  if (!(rowHeight > 0)) return null;
  return {
    columns,
    rowHeight,
    rowGap: Number.parseFloat(gridStyle.rowGap) || 0,
    viewportHeight: scrollEl.clientHeight,
    scrollTop: scrollEl.scrollTop,
  };
}

function sameMetrics(a: GridMetrics | null, b: GridMetrics | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.columns === b.columns && a.rowHeight === b.rowHeight && a.rowGap === b.rowGap &&
    a.viewportHeight === b.viewportHeight && a.scrollTop === b.scrollTop;
}

export function PhotoBrowser({ photos, title, search, searchNote, edits, album, editedFilter, favoriteFilter, onEditedFilter, onFavoriteFilter, onClearFilters, cullFilter, onCullFilter, onSelect, onFavorite, onRemove, onRemoveAlbum, onLabelAlbum, onCullAlbum, onImport, scrollKey, sortKey = DEFAULT_ALBUM_SORT_KEY, sortDir = DEFAULT_ALBUM_SORT_DIR, onSortChange, activeId, onSceneEnhance, onFaceEnhance, onExport2x, initialContextMenu }: {
  photos: PhotoWithEdit[]; title: string; search: string;
  /** Result note under a search heading (match mode, ML badge text). */
  searchNote?: string | null;
  edits?: Record<string, EditState>;
  /** The open album, when the grid shows one; built-ins never carry a menu. */
  album?: Album | null;
  onSelect: (id: string) => void; onFavorite: (id: string) => void; onRemove?: (id: string) => void;
  /** Request album deletion (confirmed by the caller). */
  onRemoveAlbum?: (id: string) => void;
  /** Label the album's unlabeled photos with ML. */
  onLabelAlbum?: (id: string) => void;
  /** Find the album's blurry photos with ML cull assist. */
  onCullAlbum?: (id: string) => void;
  onImport: () => void;
  /** ML scene enhance from the right-click menu; omit to disable the menu. */
  onSceneEnhance?: (id: string) => void;
  /** ML face enhance from the right-click menu. */
  onFaceEnhance?: (id: string) => void;
  /** ML 2x export from the right-click menu. */
  onExport2x?: (id: string) => void;
  /** Seeds an open context menu (a test seam for the open markup). */
  initialContextMenu?: PhotoContextMenuState | null;
  /** List identity for scroll memory (collection + filters + search). */
  scrollKey?: string;
  /** Album sort; the control renders only when onSortChange is provided. */
  sortKey?: AlbumSortKey;
  sortDir?: AlbumSortDir;
  onSortChange?: (key: AlbumSortKey, dir: AlbumSortDir) => void;
  /** Photo to reveal when no saved position exists (back-nav from the editor). */
  activeId?: string;
} & Partial<PhotoBrowserFilters> & Partial<PhotoBrowserCullFilter>) {
  const [size, setSize] = useState(3);
  const scrollRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<GridMetrics | null>(null);
  const keyRef = useRef(scrollKey);
  const [albumMenu, setAlbumMenu] = useState(false);
  const albumMenuRef = useRef<HTMLDivElement>(null);
  const [sortMenu, setSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const contextMenu = usePhotoContextMenu(initialContextMenu);
  const menuPhoto = contextMenu.menu ? photos.find((photo) => photo.id === contextMenu.menu!.photoId) ?? null : null;
  // The header menu only exists on a real user album: built-in collections
  // (All Photos, Favorites, Recently Edited) have no album row to act on, so
  // the trigger never renders there.
  const showAlbumMenu = Boolean(album && (onRemoveAlbum || onLabelAlbum || onCullAlbum) && !isBuiltInCollection(album.id));
  useEffect(() => {
    if (!albumMenu && !sortMenu) return;
    const onPointer = (event: PointerEvent) => {
      if (!albumMenuRef.current?.contains(event.target as Node)) setAlbumMenu(false);
      if (!sortMenuRef.current?.contains(event.target as Node)) setSortMenu(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setAlbumMenu(false); setSortMenu(false); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [albumMenu, sortMenu]);
  const filtersActive = (editedFilter && editedFilter !== 'all') || (favoriteFilter && favoriteFilter !== 'all') || (cullFilter && cullFilter !== 'all');
  const showFilters = Boolean(onEditedFilter && onFavoriteFilter);
  const showCullFilters = showFilters && cullFilter !== undefined && onCullFilter;
  const chip = (active: boolean, label: string, title: string, onClick: () => void) => (
    <button type="button" className={`filter-chip ${active ? 'is-active' : ''}`} aria-pressed={active} title={title} onClick={onClick}>{label}</button>
  );
  // Restore the remembered position for this list (back-nav from the editor
  // remounts the grid, so without this the user always lands at the top).
  // A list change without a saved position starts at the top; a first visit
  // with an open photo reveals that photo instead. Metrics reset so the one
  // frame before re-measurement renders fully, never a stale blank window.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const keyChanged = keyRef.current !== scrollKey;
    keyRef.current = scrollKey;
    setMetrics(null);
    if (!scrollKey) {
      scrollEl.scrollTop = 0;
      return;
    }
    const saved = readSavedScroll(scrollKey);
    if (saved !== null) {
      scrollEl.scrollTop = saved;
      return;
    }
    if (!keyChanged && activeId) {
      scrollEl.querySelector(`[data-photo-id="${activeId}"]`)?.scrollIntoView({ block: 'nearest' });
    } else {
      scrollEl.scrollTop = 0;
    }
    // Narrow deps by design: restoring must run on list identity only, never
    // on photo-array churn (uploads, favorite toggles) mid-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);
  // Track scroll + layout (rAF-throttled) so the row window follows the
  // viewport and every position is remembered for the way back.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const gridEl = gridRef.current;
    if (!scrollEl || !gridEl || photos.length === 0) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (scrollKey !== undefined) saveScroll(scrollKey, scrollEl.scrollTop);
        const next = measureGrid(scrollEl, gridEl);
        setMetrics((current) => (sameMetrics(current, next) ? current : next));
      });
    };
    schedule();
    scrollEl.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(scrollEl);
    observer?.observe(gridEl);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scrollEl.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [photos, size, scrollKey]);
  const gridWindow = metrics && photos.length > 0
    ? computeGridWindow({
      itemCount: photos.length, columns: metrics.columns, scrollTop: metrics.scrollTop,
      viewportHeight: metrics.viewportHeight, rowHeight: metrics.rowHeight, rowGap: metrics.rowGap,
      overscanRows: GRID_OVERSCAN_ROWS,
    })
    : null;
  const visible = gridWindow ? photos.slice(gridWindow.startIndex, gridWindow.endIndex) : photos;
  return <section className="photo-browser" ref={scrollRef}><div className="browser-heading"><div><span className="browser-eyebrow">YOUR LIBRARY</span><h1>{search ? `Results for "${search}"` : title}</h1><p>{photos.length} {photos.length === 1 ? 'photo' : 'photos'}<span />A little inspiration, ready to develop.</p>{search && searchNote && <p className="browser-search-note" role="status">{searchNote}</p>}</div><div className="browser-heading-actions">{onSortChange && <div className="browser-sort-menu" ref={sortMenuRef}><IconButton label={`Sort album: ${ALBUM_SORT_LABELS[sortKey]}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`} aria-haspopup="menu" aria-expanded={sortMenu} onClick={() => setSortMenu((current) => !current)}><ArrowDownWideNarrow size={16} /></IconButton>{sortMenu && <div className="dropdown-menu album-menu" role="menu" aria-label="Sort album">{ALBUM_SORT_KEYS.map((key) => <MenuItem key={key} checked={sortKey === key} onClick={() => { setSortMenu(false); onSortChange(key, sortDir); }}>{ALBUM_SORT_LABELS[key]}</MenuItem>)}<div className="menu-separator" role="separator" /><MenuItem checked={sortDir === 'asc'} onClick={() => { setSortMenu(false); onSortChange(sortKey, 'asc'); }}>Ascending</MenuItem><MenuItem checked={sortDir === 'desc'} onClick={() => { setSortMenu(false); onSortChange(sortKey, 'desc'); }}>Descending</MenuItem></div>}</div>}<div className="browser-view-control"><Grid2X2 size={14} /><input type="range" aria-label="Photo grid size" min={2} max={5} value={size} onChange={(event) => setSize(Number(event.target.value))} /></div>{showAlbumMenu && <div className="browser-album-menu" ref={albumMenuRef}><IconButton label={`Album actions for ${album?.name ?? title}`} aria-haspopup="menu" aria-expanded={albumMenu} onClick={() => setAlbumMenu((current) => !current)}><MoreHorizontal size={16} /></IconButton>{albumMenu && <div className="dropdown-menu album-menu" role="menu" aria-label={`Album actions for ${album?.name ?? title}`}>{onLabelAlbum && <MenuItem onClick={() => { setAlbumMenu(false); onLabelAlbum?.(album!.id); }}><span>Label unlabeled photos <span className="ml-badge" title="Photos are labeled by a machine-learning model on the photo server">ML</span></span></MenuItem>}{onCullAlbum && <MenuItem onClick={() => { setAlbumMenu(false); onCullAlbum?.(album!.id); }}><span>Find blurry photos <span className="ml-badge" title="Blurry photos, near-duplicates, and keepers are flagged by ML cull assist on the photo server">ML</span></span></MenuItem>}{(onLabelAlbum || onCullAlbum) && onRemoveAlbum && <div className="menu-separator" role="separator" />}{onRemoveAlbum && <MenuItem danger onClick={() => { setAlbumMenu(false); onRemoveAlbum?.(album!.id); }}>Delete album…</MenuItem>}</div>}</div>}</div></div>{showFilters && <div className="browser-filters" role="group" aria-label="Filter photos"><div className="filter-group" role="group" aria-label="Edited status">{chip(editedFilter === 'all', 'All', 'Show edited and unedited photos', () => onEditedFilter?.('all'))}{chip(editedFilter === 'edited', 'Edited', 'Show only photos you have edited', () => onEditedFilter?.('edited'))}{chip(editedFilter === 'unedited', 'Unedited', 'Show only photos with no edits', () => onEditedFilter?.('unedited'))}</div><div className="filter-group" role="group" aria-label="Favorite status">{chip(favoriteFilter === 'all', 'All', 'Show favorited and other photos', () => onFavoriteFilter?.('all'))}{chip(favoriteFilter === 'favorited', 'Favorited', 'Show only favorited photos', () => onFavoriteFilter?.('favorited'))}{chip(favoriteFilter === 'not', 'Not favorited', 'Show only photos that are not favorited', () => onFavoriteFilter?.('not'))}</div>{showCullFilters && <div className="filter-group" role="group" aria-label="Cull status">{chip(cullFilter === 'all', 'All', 'Show every photo regardless of cull flags', () => onCullFilter?.('all'))}{chip(cullFilter === 'blurry', 'Blurry', 'Show only photos flagged blurry by ML cull assist', () => onCullFilter?.('blurry'))}{chip(cullFilter === 'keepers', 'Keepers', 'Show only photos flagged as keepers by ML cull assist', () => onCullFilter?.('keepers'))}</div>}{filtersActive && <button type="button" className="filter-clear" onClick={onClearFilters}>Clear</button>}</div>}{photos.length ? <div className="photo-grid" ref={gridRef} style={{ '--grid-columns': size } as React.CSSProperties}>{gridWindow && gridWindow.topSpacerHeight > 0 && <div className="grid-spacer" aria-hidden="true" style={{ height: gridWindow.topSpacerHeight }} />}{visible.map((photo) => {
  const filter = thumbnailFilterForPhoto(photo, edits?.[photo.id]);
  return <div className={`browser-photo ${photo.missing ? 'is-missing' : ''}`} key={photo.id} data-photo-id={photo.id} {...((onSceneEnhance || onFaceEnhance || onExport2x) ? { onContextMenu: contextMenu.open(photo.id) } : {})}><button className="browser-photo-open" onClick={() => onSelect(photo.id)} aria-label={`Edit ${photo.title}`}><div className={`browser-photo-image${isPortraitPhoto(photo) ? ' is-portrait' : ''}`}><img src={photo.thumbnail} alt={photo.title} loading="lazy" decoding="async" style={filter ? { filter } : undefined} />{photo.raw && <span className="thumb-raw">RAW</span>}{photo.missing && <span className="thumb-missing">Missing</span>}{(hasCullLabel(photo, 'blurry') || hasCullLabel(photo, 'duplicate') || hasCullLabel(photo, 'keeper')) && <span className="thumb-cull-badges">{hasCullLabel(photo, 'blurry') && <span className="thumb-cull is-blurry" title="Flagged blurry by ML cull assist">Blurry · ML</span>}{hasCullLabel(photo, 'duplicate') && <span className="thumb-cull is-duplicate" title="Flagged as a near-duplicate by ML cull assist">Duplicate · ML</span>}{hasCullLabel(photo, 'keeper') && <span className="thumb-cull is-keeper" title="Flagged as a keeper by ML cull assist">Keeper · ML</span>}</span>}<span className="browser-edit-label">Open in editor</span></div><div className="browser-photo-caption"><span>{photo.name}</span>{photo.location && <small>{photo.location}</small>}</div></button><IconButton label={photo.favorite ? 'Remove favorite' : 'Add favorite'} className="browser-favorite" active={photo.favorite} onClick={() => onFavorite(photo.id)}><Heart size={15} fill={photo.favorite ? 'currentColor' : 'none'} /></IconButton>{onRemove && <IconButton label={`Remove ${photo.name} from library`} className="browser-remove" onClick={() => onRemove(photo.id)}><Trash2 size={15} /></IconButton>}</div>;})}{gridWindow && gridWindow.bottomSpacerHeight > 0 && <div className="grid-spacer" aria-hidden="true" style={{ height: gridWindow.bottomSpacerHeight }} />}</div> : <div className="empty-library"><Grid2X2 size={32} /><h2>{search ? 'No matching photos' : filtersActive ? 'No photos match these filters' : 'A fresh perspective starts here.'}</h2><p>{search ? 'Try a filename, location, or another search.' : filtersActive ? 'Try a different combination, or clear the filters.' : 'Import a few photos to make this space your own.'}</p>{filtersActive && !search ? <button className="secondary-button" onClick={onClearFilters}>Clear filters</button> : <button className="primary-button" onClick={onImport}>Import Photos</button>}</div>}{contextMenu.menu && menuPhoto && (onSceneEnhance || onFaceEnhance || onExport2x) && <PhotoContextMenu state={contextMenu.menu} photoName={menuPhoto.name} favorite={menuPhoto.favorite} showRemove={Boolean(onRemove)} menuRef={contextMenu.menuRef} onSceneEnhance={onSceneEnhance ? () => onSceneEnhance(menuPhoto.id) : undefined} onFaceEnhance={onFaceEnhance ? () => onFaceEnhance(menuPhoto.id) : undefined} onExport2x={onExport2x ? () => onExport2x(menuPhoto.id) : undefined} onFavorite={() => onFavorite(menuPhoto.id)} onRemove={onRemove ? () => onRemove(menuPhoto.id) : undefined} onClose={contextMenu.close} />}</section>;
}