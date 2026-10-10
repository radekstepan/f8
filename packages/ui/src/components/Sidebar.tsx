import { Clock3, CloudCheck, Download, Folder, Heart, Images, Import, MountainSnow, Plus, Search, SlidersHorizontal } from 'lucide-react';
import type { Album, Photo } from '@photomator/core';
import { IconButton } from './EditorUI.js';

interface SidebarProps {
  photos: Photo[];
  albums: Album[];
  collection: string;
  search: string;
  editedCount: number;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onImport: () => void;
  onNewAlbum: () => void;
}

export function Sidebar({ photos, albums, collection, search, editedCount, onSearch, onSelect, onImport, onNewAlbum }: SidebarProps) {
  const libraryItems = [
    { id: 'all', label: 'All Photos', icon: Images, count: photos.length },
    { id: 'favorites', label: 'Favorites', icon: Heart, count: photos.filter((photo) => photo.favorite).length },
    { id: 'edited', label: 'Recently Edited', icon: Clock3, count: editedCount },
    { id: 'imports', label: 'Imports', icon: Download, count: photos.filter((photo) => photo.id.startsWith('import-')).length },
  ];
  return (
    <aside className="library-sidebar" aria-label="Photo library">
      <div className="sidebar-search"><Search size={14} /><input id="photo-search" aria-label="Search photos" placeholder="Search photos" value={search} onChange={(event) => onSearch(event.target.value)} /><kbd>/</kbd></div>
      <div className="sidebar-scroll">
        <section className="sidebar-section"><h2>Library</h2><nav>{libraryItems.map(({ id, label, icon: Icon, count }) => <button key={id} className={`sidebar-item ${collection === id ? 'is-selected' : ''}`} onClick={() => onSelect(id)}><Icon size={17} strokeWidth={1.6} /><span>{label}</span><span className="item-count">{count}</span></button>)}</nav></section>
        <section className="sidebar-section albums-section"><div className="sidebar-section-heading"><h2>Albums</h2><IconButton label="Create album" onClick={onNewAlbum}><Plus size={14} /></IconButton></div><nav>{albums.map((album) => <button key={album.id} className={`sidebar-item album-item ${collection === album.id ? 'is-selected' : ''}`} onClick={() => onSelect(album.id)}>{album.cover ? <img src={album.cover} alt="" loading="lazy" /> : <Folder size={19} />}<span>{album.name}</span><span className="item-count">{photos.filter((photo) => photo.albumId === album.id).length}</span></button>)}</nav></section>
        <section className="sidebar-section smart-albums"><h2>Smart Albums</h2><nav><button className={`sidebar-item ${collection === 'landscapes' ? 'is-selected' : ''}`} onClick={() => onSelect('landscapes')}><MountainSnow size={17} strokeWidth={1.6} /><span>Landscapes</span></button><button className={`sidebar-item ${collection === 'raw' ? 'is-selected' : ''}`} onClick={() => onSelect('raw')}><span className="raw-icon">RAW</span><span>RAW Photos</span><span className="item-count">{photos.filter((photo) => photo.raw).length}</span></button></nav></section>
      </div>
      <div className="sidebar-bottom"><button className="import-button" onClick={onImport}><Import size={16} />Import Photos<span>+</span></button><div className="sync-status"><CloudCheck size={19} /><div><span>Local Library</span><small>All changes saved on this device</small></div><span className="status-dot" /></div><div className="workspace-label"><SlidersHorizontal size={12} /><span>Your personal darkroom.</span></div></div>
    </aside>
  );
}