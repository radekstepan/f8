import { useEffect, useRef, useState } from 'react';
import { Clock3, MoreHorizontal, Folder, Heart, Images, Import, Plus, Search } from 'lucide-react';
import type { Album, Photo } from '@f8/core';
import { isRecentlyEdited } from '@f8/core';
import { IconButton, MenuItem } from './EditorUI.js';

interface SidebarProps {
  photos: Photo[];
  albums: Album[];
  collection: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onImport: () => void;
  onNewAlbum: () => void;
  /** Request album deletion (confirmed by the caller). Omit to hide the row menus. */
  onRemoveAlbum?: (id: string) => void;
}

function AlbumRow({ album, count, selected, onSelect, onRemoveAlbum }: {
  album: Album;
  count: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemoveAlbum?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open ]);
  return (
    <div className={`album-row ${open ? 'is-menu-open' : ''}`} ref={ref}>
      <button className={`sidebar-item album-item ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(album.id)}>
        {album.cover ? <img src={album.cover} alt="" loading="lazy" /> : <Folder size={19} />}
        <span>{album.name}</span>
        <span className="item-count">{count}</span>
      </button>
      {onRemoveAlbum && (
        <IconButton
          label={`Album actions for ${album.name}`}
          className="album-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}
        >
          <MoreHorizontal size={15} />
        </IconButton>
      )}
      {onRemoveAlbum && open && (
        <div className="dropdown-menu album-menu" role="menu" aria-label={`Album actions for ${album.name}`}>
          <MenuItem danger onClick={() => { setOpen(false); onRemoveAlbum(album.id); }}>Delete album…</MenuItem>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ photos, albums, collection, search, onSearch, onSelect, onImport, onNewAlbum, onRemoveAlbum }: SidebarProps) {
  const libraryItems = [
    { id: 'all', label: 'All Photos', icon: Images, count: photos.length },
    { id: 'favorites', label: 'Favorites', icon: Heart, count: photos.filter((photo) => photo.favorite).length },
    { id: 'edited', label: 'Recently Edited', icon: Clock3, count: photos.filter((photo) => isRecentlyEdited(photo)).length },
  ];
  return (
    <aside className="library-sidebar" aria-label="Photo library">
      <div className="sidebar-search"><Search size={14} /><input id="photo-search" aria-label="Search photos" placeholder="Search photos" value={search} onChange={(event) => onSearch(event.target.value)} /><kbd>/</kbd></div>
      <div className="sidebar-scroll">
        <section className="sidebar-section"><h2>Library</h2><nav>{libraryItems.map(({ id, label, icon: Icon, count }) => <button key={id} className={`sidebar-item ${collection === id ? 'is-selected' : ''}`} onClick={() => onSelect(id)}><Icon size={17} strokeWidth={1.6} /><span>{label}</span><span className="item-count">{count}</span></button>)}</nav></section>
        <section className="sidebar-section albums-section"><div className="sidebar-section-heading"><h2>Albums</h2><IconButton label="Create album" onClick={onNewAlbum}><Plus size={14} /></IconButton></div><nav>{albums.map((album) => <AlbumRow key={album.id} album={album} count={photos.filter((photo) => photo.albumId === album.id).length} selected={collection === album.id} onSelect={onSelect} onRemoveAlbum={onRemoveAlbum} />)}</nav></section>
      </div>
      <div className="sidebar-bottom"><button className="import-button" onClick={onImport}><Import size={16} />Import Photos<span>+</span></button></div>
    </aside>
  );
}
