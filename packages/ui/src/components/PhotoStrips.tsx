import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Check, ChevronDown, ChevronUp, Grid2X2, Heart, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { DEFAULT_EDIT } from '@f8/core';
import { computeGridWindow, filmstripArrowIndex, filmstripWheelShift, getPhotoFilter, isPortraitPhoto, thumbnailFilterForPhoto } from '@f8/core';
import type { EditState, Photo, Preset } from '@f8/core';

/** A grid/filmstrip photo with its edit recipe attached when known (library photos carry `edit`). */
export type PhotoWithEdit = Photo & { edit?: EditState | null };
import { IconButton } from './EditorUI.js';

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

export function Filmstrip({ photos, selectedId, collectionName, edits, onSelect, onGrid, onSort, reversed, showPresets, onShowPresets }: { photos: PhotoWithEdit[]; selectedId: string; collectionName: string; edits?: Record<string, EditState>; onSelect: (id: string) => void; onGrid: () => void; onSort: () => void; reversed: boolean; showPresets: boolean; onShowPresets: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    listRef.current?.querySelector<HTMLElement>(`[data-photo-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [selectedId]);
  // The strip hides its scrollbar, so a plain mouse wheel (vertical delta
  // only) would do nothing over it. Translate vertical-dominant wheels into
  // horizontal scroll; horizontal gestures and zoom chords stay native.
  // A non-passive listener is required to preventDefault the wheel.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      const shift = filmstripWheelShift({
        deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
        zoomChord: event.ctrlKey || event.metaKey,
        canScrollX: list.scrollWidth > list.clientWidth + 1, clientWidth: list.clientWidth,
      });
      if (shift !== 0) { event.preventDefault(); list.scrollLeft += shift; }
    };
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => { list.removeEventListener('wheel', onWheel); };
  }, []);
  // Arrow keys walk focus through the row (focusing an item scrolls it into
  // view), so keyboard users can reach photos past the visible edge.
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
  return <section className="filmstrip" aria-label="Photos in this collection"><div className="filmstrip-heading"><div><h2>{collectionName}</h2><span>{photos.length} photos</span></div><div className="filmstrip-actions">{!showPresets && <button className="show-presets" onClick={onShowPresets}>Presets<ChevronUp size={12} /></button>}<IconButton label={reversed ? 'Sort photos oldest first' : 'Sort photos newest first'} active={reversed} onClick={onSort}><ArrowDownWideNarrow size={14} /></IconButton><IconButton label="Show photo browser (G)" onClick={onGrid}><Grid2X2 size={13} /></IconButton></div></div><div className="filmstrip-list" ref={listRef} onKeyDown={onListKeyDown}>{photos.map((photo) => {
    const filter = thumbnailFilterForPhoto(photo, edits?.[photo.id]);
    return <button data-photo-id={photo.id} className={`filmstrip-item ${selectedId === photo.id ? 'is-selected' : ''} ${photo.missing ? 'is-missing' : ''}${isPortraitPhoto(photo) ? ' is-portrait' : ''}`} key={photo.id} onClick={() => onSelect(photo.id)} title={`${photo.name} - ${photo.title}`} aria-label={`Open ${photo.title}`} aria-pressed={selectedId === photo.id}><span className="filmstrip-image"><img src={photo.thumbnail} alt={photo.title} loading="lazy" style={filter ? { filter } : undefined} />{photo.raw && <span className="thumb-raw">RAW</span>}{photo.missing && <span className="thumb-missing">Missing</span>}{photo.favorite && <Heart className="thumb-heart" size={10} fill="currentColor" />}</span><span className="filmstrip-filename">{photo.name.split('.')[0]}</span></button>;
  })}</div></section>;
}

export type EditedFilter = 'all' | 'edited' | 'unedited';
export type FavoriteFilter = 'all' | 'favorited' | 'not';

export interface PhotoBrowserFilters {
  editedFilter: EditedFilter;
  favoriteFilter: FavoriteFilter;
  onEditedFilter: (value: EditedFilter) => void;
  onFavoriteFilter: (value: FavoriteFilter) => void;
  onClearFilters: () => void;
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

export function PhotoBrowser({ photos, title, search, edits, editedFilter, favoriteFilter, onEditedFilter, onFavoriteFilter, onClearFilters, onSelect, onFavorite, onRemove, onImport, scrollKey, activeId }: {
  photos: PhotoWithEdit[]; title: string; search: string; edits?: Record<string, EditState>; onSelect: (id: string) => void; onFavorite: (id: string) => void; onRemove?: (id: string) => void; onImport: () => void;
  /** List identity for scroll memory (collection + filters + search). */
  scrollKey?: string;
  /** Photo to reveal when no saved position exists (back-nav from the editor). */
  activeId?: string;
} & Partial<PhotoBrowserFilters>) {
  const [size, setSize] = useState(3);
  const scrollRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<GridMetrics | null>(null);
  const keyRef = useRef(scrollKey);
  const filtersActive = (editedFilter && editedFilter !== 'all') || (favoriteFilter && favoriteFilter !== 'all');
  const showFilters = Boolean(onEditedFilter && onFavoriteFilter);
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
  return <section className="photo-browser" ref={scrollRef}><div className="browser-heading"><div><span className="browser-eyebrow">YOUR LIBRARY</span><h1>{search ? `Results for "${search}"` : title}</h1><p>{photos.length} {photos.length === 1 ? 'photo' : 'photos'}<span />A little inspiration, ready to develop.</p></div><div className="browser-view-control"><Grid2X2 size={14} /><input type="range" aria-label="Photo grid size" min={2} max={5} value={size} onChange={(event) => setSize(Number(event.target.value))} /></div></div>{showFilters && <div className="browser-filters" role="group" aria-label="Filter photos"><div className="filter-group" role="group" aria-label="Edited status">{chip(editedFilter === 'all', 'All', 'Show edited and unedited photos', () => onEditedFilter?.('all'))}{chip(editedFilter === 'edited', 'Edited', 'Show only photos you have edited', () => onEditedFilter?.('edited'))}{chip(editedFilter === 'unedited', 'Unedited', 'Show only photos with no edits', () => onEditedFilter?.('unedited'))}</div><div className="filter-group" role="group" aria-label="Favorite status">{chip(favoriteFilter === 'all', 'All', 'Show favorited and other photos', () => onFavoriteFilter?.('all'))}{chip(favoriteFilter === 'favorited', 'Favorited', 'Show only favorited photos', () => onFavoriteFilter?.('favorited'))}{chip(favoriteFilter === 'not', 'Not favorited', 'Show only photos that are not favorited', () => onFavoriteFilter?.('not'))}</div>{filtersActive && <button type="button" className="filter-clear" onClick={onClearFilters}>Clear</button>}</div>}{photos.length ? <div className="photo-grid" ref={gridRef} style={{ '--grid-columns': size } as React.CSSProperties}>{gridWindow && gridWindow.topSpacerHeight > 0 && <div className="grid-spacer" aria-hidden="true" style={{ height: gridWindow.topSpacerHeight }} />}{visible.map((photo) => {
  const filter = thumbnailFilterForPhoto(photo, edits?.[photo.id]);
  return <div className={`browser-photo ${photo.missing ? 'is-missing' : ''}`} key={photo.id} data-photo-id={photo.id}><button className="browser-photo-open" onClick={() => onSelect(photo.id)} aria-label={`Edit ${photo.title}`}><div className={`browser-photo-image${isPortraitPhoto(photo) ? ' is-portrait' : ''}`}><img src={photo.thumbnail} alt={photo.title} loading="lazy" decoding="async" style={filter ? { filter } : undefined} />{photo.raw && <span className="thumb-raw">RAW</span>}{photo.missing && <span className="thumb-missing">Missing</span>}<span className="browser-edit-label">Open in editor</span></div><div className="browser-photo-caption"><span>{photo.name}</span>{photo.location && <small>{photo.location}</small>}</div></button><IconButton label={photo.favorite ? 'Remove favorite' : 'Add favorite'} className="browser-favorite" active={photo.favorite} onClick={() => onFavorite(photo.id)}><Heart size={15} fill={photo.favorite ? 'currentColor' : 'none'} /></IconButton>{onRemove && <IconButton label={`Remove ${photo.name} from library`} className="browser-remove" onClick={() => onRemove(photo.id)}><Trash2 size={15} /></IconButton>}</div>;})}{gridWindow && gridWindow.bottomSpacerHeight > 0 && <div className="grid-spacer" aria-hidden="true" style={{ height: gridWindow.bottomSpacerHeight }} />}</div> : <div className="empty-library"><Grid2X2 size={32} /><h2>{search ? 'No matching photos' : filtersActive ? 'No photos match these filters' : 'A fresh perspective starts here.'}</h2><p>{search ? 'Try a filename, location, or another search.' : filtersActive ? 'Try a different combination, or clear the filters.' : 'Import a few photos to make this space your own.'}</p>{filtersActive && !search ? <button className="secondary-button" onClick={onClearFilters}>Clear filters</button> : <button className="primary-button" onClick={onImport}>Import Photos</button>}</div>}</section>;
}