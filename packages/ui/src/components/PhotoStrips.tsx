import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Check, ChevronDown, ChevronUp, Grid2X2, Heart, Plus, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_EDIT } from '@photomator/core';
import { getPhotoFilter } from '@photomator/core';
import type { Photo, Preset } from '@photomator/core';
import { IconButton } from './EditorUI.js';

export function PresetStrip({ photo, presets, selected, onSelect, onAdd, onToggle }: { photo: Photo; presets: Preset[]; selected: string; onSelect: (preset: Preset) => void; onAdd: () => void; onToggle: () => void }) {
  const [category, setCategory] = useState('Essentials');
  useEffect(() => {
    const preset = presets.find((item) => item.name === selected);
    if (preset) setCategory(preset.category);
  }, [selected, presets]);
  const categories = ['Essentials', 'Cinematic', 'Black & White', ...(presets.some((preset) => preset.category === 'My Presets') ? ['My Presets'] : [])];
  const original = presets.find((preset) => preset.id === 'original') ?? presets.find((preset) => preset.name === 'Original');
  return <section className="presets-panel" aria-label="Photo presets"><div className="presets-heading"><div className="presets-title"><SlidersHorizontal size={13} /><h2>Presets</h2></div><nav className="preset-tabs" aria-label="Preset categories">{categories.map((name) => <button key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>{name}</button>)}</nav><div className="presets-actions"><IconButton label="Save current adjustments as a preset" onClick={onAdd}><Plus size={15} /></IconButton><IconButton label="Hide presets" onClick={onToggle}><ChevronDown size={14} /></IconButton></div></div><div className="presets-list">{presets.filter((preset) => preset.category === category).map((preset) => {
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

export function Filmstrip({ photos, selectedId, collectionName, onSelect, onGrid, onSort, reversed, showPresets, onShowPresets }: { photos: Photo[]; selectedId: string; collectionName: string; onSelect: (id: string) => void; onGrid: () => void; onSort: () => void; reversed: boolean; showPresets: boolean; onShowPresets: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-photo-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }, [selectedId]);
  return <section className="filmstrip" aria-label="Photos in this collection"><div className="filmstrip-heading"><div><h2>{collectionName}</h2><span>{photos.length} photos</span></div><div className="filmstrip-actions">{!showPresets && <button className="show-presets" onClick={onShowPresets}>Presets<ChevronUp size={12} /></button>}<IconButton label={reversed ? 'Sort photos oldest first' : 'Sort photos newest first'} active={reversed} onClick={onSort}><ArrowDownWideNarrow size={14} /></IconButton><IconButton label="Show photo browser (G)" onClick={onGrid}><Grid2X2 size={13} /></IconButton></div></div><div className="filmstrip-list" ref={listRef}>{photos.map((photo) => <button data-photo-id={photo.id} className={`filmstrip-item ${selectedId === photo.id ? 'is-selected' : ''} ${photo.missing ? 'is-missing' : ''}`} key={photo.id} onClick={() => onSelect(photo.id)} title={`${photo.name} - ${photo.title}`} aria-label={`Open ${photo.title}`} aria-pressed={selectedId === photo.id}><span className="filmstrip-image"><img src={photo.thumbnail} alt={photo.title} loading="lazy" />{photo.raw && <span className="thumb-raw">RAW</span>}{photo.missing && <span className="thumb-missing">Missing</span>}{photo.favorite && <Heart className="thumb-heart" size={10} fill="currentColor" />}</span><span className="filmstrip-filename">{photo.name.split('.')[0]}</span></button>)}</div></section>;
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

export function PhotoBrowser({ photos, title, search, editedFilter, favoriteFilter, onEditedFilter, onFavoriteFilter, onClearFilters, onSelect, onFavorite, onImport }: {
  photos: Photo[]; title: string; search: string; onSelect: (id: string) => void; onFavorite: (id: string) => void; onImport: () => void;
} & Partial<PhotoBrowserFilters>) {
  const [size, setSize] = useState(3);
  const filtersActive = (editedFilter && editedFilter !== 'all') || (favoriteFilter && favoriteFilter !== 'all');
  const showFilters = Boolean(onEditedFilter && onFavoriteFilter);
  const chip = (active: boolean, label: string, title: string, onClick: () => void) => (
    <button type="button" className={`filter-chip ${active ? 'is-active' : ''}`} aria-pressed={active} title={title} onClick={onClick}>{label}</button>
  );
  return <section className="photo-browser"><div className="browser-heading"><div><span className="browser-eyebrow">YOUR LIBRARY</span><h1>{search ? `Results for "${search}"` : title}</h1><p>{photos.length} {photos.length === 1 ? 'photo' : 'photos'}<span />A little inspiration, ready to develop.</p></div><div className="browser-view-control"><Grid2X2 size={14} /><input type="range" aria-label="Photo grid size" min={2} max={5} value={size} onChange={(event) => setSize(Number(event.target.value))} /></div></div>{showFilters && <div className="browser-filters" role="group" aria-label="Filter photos"><div className="filter-group" role="group" aria-label="Edited status">{chip(editedFilter === 'all', 'All', 'Show edited and unedited photos', () => onEditedFilter?.('all'))}{chip(editedFilter === 'edited', 'Edited', 'Show only photos you have edited', () => onEditedFilter?.('edited'))}{chip(editedFilter === 'unedited', 'Unedited', 'Show only photos with no edits', () => onEditedFilter?.('unedited'))}</div><div className="filter-group" role="group" aria-label="Favorite status">{chip(favoriteFilter === 'all', 'All', 'Show favorited and other photos', () => onFavoriteFilter?.('all'))}{chip(favoriteFilter === 'favorited', 'Favorited', 'Show only favorited photos', () => onFavoriteFilter?.('favorited'))}{chip(favoriteFilter === 'not', 'Not favorited', 'Show only photos that are not favorited', () => onFavoriteFilter?.('not'))}</div>{filtersActive && <button type="button" className="filter-clear" onClick={onClearFilters}>Clear</button>}</div>}{photos.length ? <div className="photo-grid" style={{ '--grid-columns': size } as React.CSSProperties}>{photos.map((photo) => <div className={`browser-photo ${photo.missing ? 'is-missing' : ''}`} key={photo.id}><button className="browser-photo-open" onClick={() => onSelect(photo.id)} aria-label={`Edit ${photo.title}`}><div className="browser-photo-image"><img src={photo.src} alt={photo.title} loading="lazy" />{photo.raw && <span className="thumb-raw">RAW</span>}{photo.missing && <span className="thumb-missing">Missing</span>}<span className="browser-edit-label">Open in editor</span></div><div className="browser-photo-caption"><span>{photo.name}</span><small>{photo.location}</small></div></button><IconButton label={photo.favorite ? 'Remove favorite' : 'Add favorite'} className="browser-favorite" active={photo.favorite} onClick={() => onFavorite(photo.id)}><Heart size={15} fill={photo.favorite ? 'currentColor' : 'none'} /></IconButton></div>)}</div> : <div className="empty-library"><Grid2X2 size={32} /><h2>{search ? 'No matching photos' : filtersActive ? 'No photos match these filters' : 'A fresh perspective starts here.'}</h2><p>{search ? 'Try a filename, location, or another search.' : filtersActive ? 'Try a different combination, or clear the filters.' : 'Import a few photos to make this space your own.'}</p>{filtersActive && !search ? <button className="secondary-button" onClick={onClearFilters}>Clear filters</button> : <button className="primary-button" onClick={onImport}>Import Photos</button>}</div>}</section>;
}