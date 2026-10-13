import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Check, ChevronDown, ChevronUp, Grid2X2, Heart, MoreHorizontal, Plus, SwatchBook, Trash2 } from 'lucide-react';
import { ALBUM_SORT_KEYS, ALBUM_SORT_LABELS, DEFAULT_ALBUM_SORT_DIR, DEFAULT_ALBUM_SORT_KEY, DEFAULT_EDIT } from '@f8/core';
import { MOVE_PHOTOS_MIME, SEMANTIC_SEARCH_NOTE_HINT, anchorMenuAtCursor, computeGridWindow, encodeMovePayload, extendPhotoRange, filmstripArrowIndex, filmstripCenteredScrollOffset, filmstripOverflows, filmstripWheelShift, getPhotoFilter, isBuiltInCollection, isPortraitPhoto, marqueeSelectedIds, resolveMoveTargets, thumbnailFilterForPhoto, togglePhotoSelection } from '@f8/core';
import type { Rect } from '@f8/core';
import type { Album, AlbumSortDir, AlbumSortKey, EditState, Photo, Preset } from '@f8/core';

/** A grid/filmstrip photo with its edit recipe attached when known (library photos carry `edit`). */
export type PhotoWithEdit = Photo & { edit?: EditState | null };
import { IconButton, MenuItem, MenuSeparator, MlBadge } from './EditorUI.js';
import { useIsomorphicLayoutEffect } from '../hooks/useIsomorphicLayoutEffect.js';
import { useMenuDismiss } from '../hooks/useMenuDismiss.js';

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
  // Cursor anchor for the open menu: the measure pass flips the menu above
  // or left of this point when opening below/right would clip. Null for the
  // seeded test seam, which keeps its pinned coordinates untouched.
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  useMenuDismiss(menuRef, () => { anchorRef.current = null; setMenu(null); }, { enabled: menu !== null });
  // Measure-then-anchor: the open estimate assumes a fixed menu size, so once
  // the real menu mounts its measured size re-anchors it into the viewport —
  // flipping above the cursor near the bottom edge (the filmstrip case). The
  // guard skips unmeasurable renders and re-runs settle on the same coords.
  useIsomorphicLayoutEffect(() => {
    const anchor = anchorRef.current;
    const el = menuRef.current;
    if (!menu || !anchor || !el || typeof window === 'undefined') return;
    const size = el.getBoundingClientRect();
    if (!(size.width > 0 && size.height > 0)) return;
    const pos = anchorMenuAtCursor(anchor, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight });
    if (pos.x !== menu.x || pos.y !== menu.y) setMenu({ ...menu, x: pos.x, y: pos.y });
  }, [menu]);
  const open = (photoId: string) => (event: { preventDefault(): void; clientX: number; clientY: number }) => {
    event.preventDefault();
    anchorRef.current = { x: event.clientX, y: event.clientY };
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    setMenu({ photoId, x: Math.max(0, Math.min(event.clientX, viewportWidth - 240)), y: Math.max(0, Math.min(event.clientY, viewportHeight - 160)) });
  };
  const close = () => { anchorRef.current = null; setMenu(null); };
  return { menu, menuRef, open, close };
}

function PhotoContextMenu({ state, photoName, favorite, showRemove, menuRef, onSceneEnhance, onFaceEnhance, onExport2x, onFavorite, onRemove, moveCount, moveAlbums, onMoveToAlbum, onClose }: {
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
  /** Photos the move section acts on; the section renders only with albums to move to. */
  moveCount?: number;
  moveAlbums?: Album[];
  onMoveToAlbum?: (albumId: string) => void;
  onClose: () => void;
}) {
  return <div className="dropdown-menu photo-context-menu" role="menu" aria-label={`Actions for ${photoName}`} ref={menuRef} style={{ left: state.x, top: state.y }} data-testid="photo-context-menu">
    {onSceneEnhance && <MenuItem onClick={() => { onClose(); onSceneEnhance(); }}><span>Scene Enhance <MlBadge hint="The scene is classified by a machine-learning model on your device" /></span></MenuItem>}
    {onFaceEnhance && <MenuItem onClick={() => { onClose(); onFaceEnhance(); }}><span>Enhance Faces <MlBadge hint="Faces are detected by a machine-learning model on the photo server" /></span></MenuItem>}
    {onExport2x && <MenuItem onClick={() => { onClose(); onExport2x(); }}><span>Export 2x <MlBadge hint="Doubled by a machine-learning model on the photo server" /></span></MenuItem>}
    <MenuItem onClick={() => { onClose(); onFavorite(); }}>{favorite ? 'Remove Favorite' : 'Add Favorite'}</MenuItem>
    {onMoveToAlbum && moveAlbums && moveAlbums.length > 0 && <><MenuSeparator /><div className="menu-section-label" role="presentation">Move {moveCount === 1 ? '1 photo' : `${moveCount ?? 0} photos`} to…</div><div className="move-album-list" role="group" aria-label="Move to album">{moveAlbums.map((album) => <MenuItem key={album.id} onClick={() => { onClose(); onMoveToAlbum(album.id); }}>{album.name}</MenuItem>)}</div></>}
    {showRemove && onRemove && <><MenuSeparator /><MenuItem danger onClick={() => { onClose(); onRemove(); }}>Remove from Library…</MenuItem></>}
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
  return <section className="presets-panel" aria-label="Photo presets"><div className="presets-heading"><div className="presets-title"><SwatchBook size={13} /><h2>Presets</h2></div><nav className="preset-tabs" aria-label="Preset categories">{categories.map((name) => <button key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>{name}</button>)}</nav><div className="presets-actions"><IconButton label="Save current adjustments as a preset" onClick={onAdd}><Plus size={15} /></IconButton><IconButton label="Hide presets" onClick={onToggle}><ChevronDown size={14} /></IconButton></div></div><div className={`presets-list${portrait ? ' is-portrait' : ''}`}>{presets.filter((preset) => preset.category === category).map((preset) => {
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

// The filmstrip toggle flips the direction of the shared album sort, so its
// label names the active key: "A to Z" for filenames, oldest/newest for the
// two timestamps.
function filmstripSortLabel(sortKey: AlbumSortKey, reversed: boolean): string {
  if (sortKey === 'filename') return reversed ? 'Sort filenames Z to A' : 'Sort filenames A to Z';
  if (sortKey === 'imported') return reversed ? 'Sort by import, oldest first' : 'Sort by import, newest first';
  return reversed ? 'Sort photos oldest first' : 'Sort photos newest first';
}

export function Filmstrip({ photos, selectedId, collectionName, edits, onSelect, onGrid, onSort, reversed, sortKey = DEFAULT_ALBUM_SORT_KEY, showPresets, onShowPresets, onFavorite, onRemove, initialContextMenu }: { photos: PhotoWithEdit[]; selectedId: string; collectionName: string; edits?: Record<string, EditState>; onSelect: (id: string) => void; onGrid: () => void; onSort: () => void; reversed: boolean; sortKey?: AlbumSortKey; showPresets: boolean; onShowPresets: () => void; /** Right-click menu (favorite + remove); omit to disable the menu. (ML actions live in the inspector, the library grid menu, and the export dialog.) */ onFavorite?: (id: string) => void; /** Confirmed remove from the right-click menu; omit to hide the entry. */ onRemove?: (id: string) => void; /** Seeds an open context menu (a test seam for the open markup). */ initialContextMenu?: PhotoContextMenuState | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  const contextMenu = usePhotoContextMenu(initialContextMenu);
  const menuPhoto = contextMenu.menu ? photos.find((photo) => photo.id === contextMenu.menu!.photoId) ?? null : null;
  const contextMenuEnabled = Boolean(onFavorite);
  // Opening a photo centers it in the single row (clamped at both ends)
  // so older and newer neighbors stay visible on both sides. The strip
  // never overflows vertically, so only the horizontal axis moves. Rects
  // (not offsetLeft) measure the item so the math holds whatever the
  // offsetParent is.
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
  // The strip is a single horizontal row, so a plain mouse wheel
  // (vertical delta only) would do nothing over it — vertical-dominant
  // wheels translate into horizontal scroll instead. Horizontal gestures
  // and zoom chords stay native. A non-passive listener is required to
  // preventDefault the wheel.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      const shift = filmstripWheelShift({
        deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
        zoomChord: event.ctrlKey || event.metaKey,
        canScrollX: filmstripOverflows(list.scrollWidth, list.clientWidth),
        clientWidth: list.clientWidth,
      });
      if (shift !== 0) { event.preventDefault(); list.scrollLeft += shift; }
    };
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => { list.removeEventListener('wheel', onWheel); };
  }, []);
  // Arrow keys walk focus along the single row (focusing an item scrolls
  // it into view), so keyboard users can reach photos past the visible edge.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-photo-id]'));
    const next = filmstripArrowIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length);
    if (next === -1) return;
    event.preventDefault();
    items[next]?.focus();
    items[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  return <section className="filmstrip" aria-label="Photos in this collection"><div className="filmstrip-heading"><div><h2>{collectionName}</h2><span>{photos.length} photos</span></div><div className="filmstrip-actions">{!showPresets && <button className="show-presets" onClick={onShowPresets}>Presets<ChevronUp size={12} /></button>}<IconButton label={filmstripSortLabel(sortKey, reversed)} active={reversed} onClick={onSort}><ArrowDownWideNarrow size={14} /></IconButton><IconButton label="Show photo browser (G)" onClick={onGrid}><Grid2X2 size={13} /></IconButton></div></div><div className="filmstrip-list" ref={listRef} onKeyDown={onListKeyDown}>{photos.map((photo) => {
    const filter = thumbnailFilterForPhoto(photo, edits?.[photo.id]);
    return <button data-photo-id={photo.id} className={`filmstrip-item ${selectedId === photo.id ? 'is-selected' : ''} ${photo.missing ? 'is-missing' : ''}${isPortraitPhoto(photo) ? ' is-portrait' : ''}`} key={photo.id} onClick={() => onSelect(photo.id)} {...(contextMenuEnabled ? { onContextMenu: contextMenu.open(photo.id) } : {})} title={`${photo.name} - ${photo.title}`} aria-label={`Open ${photo.title}`} aria-pressed={selectedId === photo.id}><span className="filmstrip-image"><img src={photo.thumbnail} alt={photo.title} loading="lazy" style={filter ? { filter } : undefined} />{photo.raw && <span className="thumb-raw">RAW</span>}{photo.missing && <span className="thumb-missing">Missing</span>}{photo.favorite && <Heart className="thumb-heart" size={10} fill="currentColor" />}</span><span className="filmstrip-filename">{photo.name.split('.')[0]}</span></button>;
  })}</div>{contextMenu.menu && menuPhoto && contextMenuEnabled && <PhotoContextMenu state={contextMenu.menu} photoName={menuPhoto.name} favorite={menuPhoto.favorite} showRemove={Boolean(onRemove)} menuRef={contextMenu.menuRef} onFavorite={() => onFavorite?.(menuPhoto.id)} onRemove={onRemove ? () => onRemove(menuPhoto.id) : undefined} onClose={contextMenu.close} />}</section>;
}

export type EditedFilter = 'all' | 'edited' | 'unedited';
export type FavoriteFilter = 'all' | 'favorited' | 'not';
/** ML cull-assist flags: blurry rejects and near-duplicates. No positive state. */
export type CullFilter = 'all' | 'blurry';

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

export function PhotoBrowser({ photos, title, search, searchNote, edits, album, albums, editedFilter, favoriteFilter, onEditedFilter, onFavoriteFilter, onClearFilters, cullFilter, onCullFilter, onSelect, onFavorite, onRemove, onRemoveAlbum, onImport, scrollKey, sortKey = DEFAULT_ALBUM_SORT_KEY, sortDir = DEFAULT_ALBUM_SORT_DIR, onSortChange, activeId, onSceneEnhance, onFaceEnhance, onExport2x, selectedIds, onSelectionChange, onMoveToAlbum, initialContextMenu, initialMarquee }: {
  photos: PhotoWithEdit[]; title: string; search: string;
  /** Result note under a search heading (match mode, ML badge text). */
  searchNote?: string | null;
  edits?: Record<string, EditState>;
  /** The open album, when the grid shows one; built-ins never carry a menu. */
  album?: Album | null;
  /** User albums offered by the "Move to album" menu; omit to disable moving. */
  albums?: Album[];
  /** Controlled multi-selection (Ctrl/Cmd-click, Shift-click, marquee). */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Move photos into an album (context menu + sidebar drop target). */
  onMoveToAlbum?: (photoIds: string[], albumId: string) => void;
  onSelect: (id: string) => void; onFavorite: (id: string) => void; onRemove?: (id: string) => void;
  /** Request album deletion (confirmed by the caller). */
  onRemoveAlbum?: (id: string) => void;
  onImport: () => void;
  /** ML scene enhance from the right-click menu; omit to disable the menu. */
  onSceneEnhance?: (id: string) => void;
  /** ML face enhance from the right-click menu. */
  onFaceEnhance?: (id: string) => void;
  /** ML 2x export from the right-click menu. */
  onExport2x?: (id: string) => void;
  /** Seeds an open context menu (a test seam for the open markup). */
  initialContextMenu?: PhotoContextMenuState | null;
  /** Seeds a visible marquee (a test seam for the rubber-band markup). */
  initialMarquee?: Rect | null;
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
  // Multi-selection is controlled (the caller clears it on list changes and
  // moves); without a change handler the grid keeps single-click behavior.
  const selection = selectedIds ?? [];
  const anchorRef = useRef<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(initialMarquee ?? null);
  const moveSupported = Boolean(onMoveToAlbum && albums && albums.length > 0);
  const contextMenuEnabled = Boolean(onSceneEnhance || onFaceEnhance || onExport2x || moveSupported);
  // The menu acts on the whole selection when the target belongs to it, else
  // the target alone; the open album is never a move destination (a no-op).
  const moveTargets = menuPhoto ? resolveMoveTargets(selection, menuPhoto.id) : [];
  const moveAlbums = moveSupported ? (albums ?? []).filter((entry) => entry.id !== album?.id) : [];
  const openContextMenu = (photoId: string) => (event: { preventDefault(): void; clientX: number; clientY: number }) => {
    if (onSelectionChange && !selection.includes(photoId)) {
      anchorRef.current = photoId;
      onSelectionChange([photoId]);
    }
    contextMenu.open(photoId)(event);
  };
  // Plain click opens; Ctrl/Cmd toggles one photo, Shift extends from the
  // anchor. Plain clicks still move the anchor, so a later Shift-click after
  // a trip to the editor ranges from the last opened photo.
  const onCardClick = (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, id: string) => {
    if (!onSelectionChange) { onSelect(id); return; }
    if (event.ctrlKey || event.metaKey) {
      anchorRef.current = id;
      onSelectionChange(togglePhotoSelection(selection, id));
      return;
    }
    if (event.shiftKey) {
      const next = extendPhotoRange(photos.map((photo) => photo.id), selection, anchorRef.current, id);
      anchorRef.current = next.anchor;
      onSelectionChange(next.selected);
      return;
    }
    anchorRef.current = id;
    onSelect(id);
  };
  const onCardDragStart = (event: React.DragEvent, id: string) => {
    if (!onMoveToAlbum) return;
    event.dataTransfer.setData(MOVE_PHOTOS_MIME, encodeMovePayload(resolveMoveTargets(selection, id)));
    event.dataTransfer.effectAllowed = 'move';
  };
  // Rubber-band marquee: a mouse press on the grid background (not on a
  // photo) sweeps a band that selects every intersecting card live; the
  // band is fixed-positioned in client coords, so no scroll math is needed.
  // Touch stays on native scroll (mouse only). Ctrl adds to the selection,
  // a plain sweep replaces it, and a click with no sweep clears it.
  const onGridPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onSelectionChange || event.button !== 0 || event.pointerType !== 'mouse') return;
    if ((event.target as HTMLElement).closest('.browser-photo')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = event.ctrlKey || event.metaKey ? selection : [];
    const commit = (clientX: number, clientY: number) => {
      const rect: Rect = { x: Math.min(startX, clientX), y: Math.min(startY, clientY), width: Math.abs(clientX - startX), height: Math.abs(clientY - startY) };
      setMarquee(rect);
      const gridEl = gridRef.current;
      if (!gridEl) return;
      const entries = Array.from(gridEl.querySelectorAll<HTMLElement>('.browser-photo[data-photo-id]')).map((el) => {
        const bounds = el.getBoundingClientRect();
        return { id: el.dataset.photoId ?? '', rect: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } };
      }).filter((entry) => entry.id !== '');
      const hits = marqueeSelectedIds(entries, rect);
      onSelectionChange([...base.filter((id) => !hits.includes(id)), ...hits]);
    };
    const onMove = (moveEvent: PointerEvent) => commit(moveEvent.clientX, moveEvent.clientY);
    const onUp = (upEvent: PointerEvent) => {
      commit(upEvent.clientX, upEvent.clientY);
      window.removeEventListener('pointermove', onMove);
      setMarquee(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };
  // The header menu only exists on a real user album: built-in collections
  // (All Photos, Favorites, Recently Edited) have no album row to act on, so
  // the trigger never renders there.
  const showAlbumMenu = Boolean(album && onRemoveAlbum && !isBuiltInCollection(album.id));
  useMenuDismiss(albumMenuRef, () => setAlbumMenu(false), { enabled: albumMenu });
  useMenuDismiss(sortMenuRef, () => setSortMenu(false), { enabled: sortMenu });
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
  return <section className="photo-browser" ref={scrollRef}><div className="browser-heading"><div><span className="browser-eyebrow">YOUR LIBRARY</span><h1>{search ? `Results for "${search}"` : title}</h1><p>{photos.length} {photos.length === 1 ? 'photo' : 'photos'}<span />A little inspiration, ready to develop.</p>{search && searchNote && <p className="browser-search-note" role="status" title={SEMANTIC_SEARCH_NOTE_HINT}>{searchNote}</p>}</div><div className="browser-heading-actions">{onSortChange && <div className="browser-sort-menu" ref={sortMenuRef}><IconButton label={`Sort album: ${ALBUM_SORT_LABELS[sortKey]}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`} aria-haspopup="menu" aria-expanded={sortMenu} onClick={() => setSortMenu((current) => !current)}><ArrowDownWideNarrow size={16} /></IconButton>{sortMenu && <div className="dropdown-menu album-menu" role="menu" aria-label="Sort album">{ALBUM_SORT_KEYS.map((key) => <MenuItem key={key} checked={sortKey === key} onClick={() => { setSortMenu(false); onSortChange(key, sortDir); }}>{ALBUM_SORT_LABELS[key]}</MenuItem>)}<MenuSeparator /><MenuItem checked={sortDir === 'asc'} onClick={() => { setSortMenu(false); onSortChange(sortKey, 'asc'); }}>Ascending</MenuItem><MenuItem checked={sortDir === 'desc'} onClick={() => { setSortMenu(false); onSortChange(sortKey, 'desc'); }}>Descending</MenuItem></div>}</div>}<div className="browser-view-control"><Grid2X2 size={14} /><input type="range" aria-label="Photo grid size" min={2} max={5} value={size} onChange={(event) => setSize(Number(event.target.value))} /></div>{showAlbumMenu && <div className="browser-album-menu" ref={albumMenuRef}><IconButton label={`Album actions for ${album?.name ?? title}`} aria-haspopup="menu" aria-expanded={albumMenu} onClick={() => setAlbumMenu((current) => !current)}><MoreHorizontal size={16} /></IconButton>{albumMenu && <div className="dropdown-menu album-menu" role="menu" aria-label={`Album actions for ${album?.name ?? title}`}>{onRemoveAlbum && <MenuItem danger onClick={() => { setAlbumMenu(false); onRemoveAlbum?.(album!.id); }}>Delete album…</MenuItem>}</div>}</div>}</div></div>{showFilters && <div className="browser-filters" role="group" aria-label="Filter photos"><div className="filter-group" role="group" aria-label="Edited status">{chip(editedFilter === 'all', 'All', 'Show edited and unedited photos', () => onEditedFilter?.('all'))}{chip(editedFilter === 'edited', 'Edited', 'Show only photos you have edited', () => onEditedFilter?.('edited'))}{chip(editedFilter === 'unedited', 'Unedited', 'Show only photos with no edits', () => onEditedFilter?.('unedited'))}</div><div className="filter-group" role="group" aria-label="Favorite status">{chip(favoriteFilter === 'all', 'All', 'Show favorited and other photos', () => onFavoriteFilter?.('all'))}{chip(favoriteFilter === 'favorited', 'Favorited', 'Show only favorited photos', () => onFavoriteFilter?.('favorited'))}{chip(favoriteFilter === 'not', 'Not favorited', 'Show only photos that are not favorited', () => onFavoriteFilter?.('not'))}</div>{showCullFilters && <div className="filter-group" role="group" aria-label="Cull status">{chip(cullFilter === 'all', 'All', 'Show every photo regardless of cull flags', () => onCullFilter?.('all'))}{chip(cullFilter === 'blurry', 'Blurry', 'Show only photos flagged blurry by ML cull assist', () => onCullFilter?.('blurry'))}</div>}{filtersActive && <button type="button" className="filter-clear" onClick={onClearFilters}>Clear</button>}</div>}{photos.length ? <div className="photo-grid" ref={gridRef} style={{ '--grid-columns': size } as React.CSSProperties} onPointerDown={onGridPointerDown}>{gridWindow && gridWindow.topSpacerHeight > 0 && <div className="grid-spacer" aria-hidden="true" style={{ height: gridWindow.topSpacerHeight }} />}{visible.map((photo) => {
  const filter = thumbnailFilterForPhoto(photo, edits?.[photo.id]);
  const isSelected = selection.includes(photo.id);
  return <div className={`browser-photo ${photo.missing ? 'is-missing' : ''}${isSelected ? ' is-selected' : ''}`} key={photo.id} data-photo-id={photo.id} aria-selected={onSelectionChange ? isSelected : undefined} {...(contextMenuEnabled ? { onContextMenu: openContextMenu(photo.id) } : {})}><div className="browser-photo-frame" {...(onMoveToAlbum ? { draggable: true, onDragStart: (event: React.DragEvent) => onCardDragStart(event, photo.id) } : {})}><button className="browser-photo-open" onClick={(event) => onCardClick(event, photo.id)} aria-label={`Edit ${photo.title}`}>{isSelected && <span className="browser-selected-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}<div className={`browser-photo-image${isPortraitPhoto(photo) ? ' is-portrait' : ''}`}><img src={photo.thumbnail} alt={photo.title} loading="lazy" decoding="async" style={filter ? { filter } : undefined} />{photo.raw && <span className="thumb-raw">RAW</span>}{photo.missing && <span className="thumb-missing">Missing</span>}{(hasCullLabel(photo, 'blurry') || hasCullLabel(photo, 'duplicate')) && <span className="thumb-cull-badges">{hasCullLabel(photo, 'blurry') && <span className="thumb-cull is-blurry" title="Flagged blurry by ML cull assist">Blurry · ML</span>}{hasCullLabel(photo, 'duplicate') && <span className="thumb-cull is-duplicate" title="Flagged as a near-duplicate by ML cull assist">Duplicate · ML</span>}</span>}<span className="browser-edit-label">Open in editor</span></div></button><IconButton label={photo.favorite ? 'Remove favorite' : 'Add favorite'} className="browser-favorite" active={photo.favorite} onClick={() => onFavorite(photo.id)}><Heart size={15} fill={photo.favorite ? 'currentColor' : 'none'} /></IconButton>{onRemove && <IconButton label={`Remove ${photo.name} from library`} className="browser-remove" onClick={() => onRemove(photo.id)}><Trash2 size={15} /></IconButton>}</div><div className="browser-photo-caption"><span>{photo.name}</span>{photo.location && <small>{photo.location}</small>}</div></div>;})}{gridWindow && gridWindow.bottomSpacerHeight > 0 && <div className="grid-spacer" aria-hidden="true" style={{ height: gridWindow.bottomSpacerHeight }} />}</div> : <div className="empty-library"><Grid2X2 size={32} /><h2>{search ? 'No matching photos' : filtersActive ? 'No photos match these filters' : 'A fresh perspective starts here.'}</h2><p>{search ? 'Try a filename, location, or another search.' : filtersActive ? 'Try a different combination, or clear the filters.' : 'Import a few photos to make this space your own.'}</p>{filtersActive && !search ? <button className="secondary-button" onClick={onClearFilters}>Clear filters</button> : <button className="primary-button" onClick={onImport}>Import Photos</button>}</div>}{contextMenu.menu && menuPhoto && contextMenuEnabled && <PhotoContextMenu state={contextMenu.menu} photoName={menuPhoto.name} favorite={menuPhoto.favorite} showRemove={Boolean(onRemove)} menuRef={contextMenu.menuRef} onSceneEnhance={onSceneEnhance ? () => onSceneEnhance(menuPhoto.id) : undefined} onFaceEnhance={onFaceEnhance ? () => onFaceEnhance(menuPhoto.id) : undefined} onExport2x={onExport2x ? () => onExport2x(menuPhoto.id) : undefined} onFavorite={() => onFavorite(menuPhoto.id)} onRemove={onRemove ? () => onRemove(menuPhoto.id) : undefined} moveCount={moveTargets.length} moveAlbums={moveAlbums} onMoveToAlbum={onMoveToAlbum ? (albumId) => onMoveToAlbum(moveTargets, albumId) : undefined} onClose={contextMenu.close} />}{marquee && <div className="selection-marquee" aria-hidden="true" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}</section>;
}