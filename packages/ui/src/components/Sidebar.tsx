import { useRef, useState } from 'react';
import { Clock3, MoreHorizontal, Folder, Heart, Images, Import, Plus, Search } from 'lucide-react';
import type { Album, Photo } from '@f8/core';
import { MOVE_PHOTOS_MIME, anchorMenuBelowTrigger, decodeMovePayload, isRecentlyEdited } from '@f8/core';
import { IconButton, MenuItem } from './EditorUI.js';
import { useIsomorphicLayoutEffect } from '../hooks/useIsomorphicLayoutEffect.js';
import { useMenuDismiss } from '../hooks/useMenuDismiss.js';

interface SidebarProps {
  photos: Photo[];
  albums: Album[];
  collection: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onImport: () => void;
  onNewAlbum: () => void;
  /** Request album deletion (confirmed by the caller). Omit to hide the delete item. */
  onRemoveAlbum?: (id: string) => void;
  /** Move grid photos dropped onto an album row. Omit to disable photo drops. */
  onMoveToAlbum?: (photoIds: string[], albumId: string) => void;
  /** Seeds a highlighted drop row (a test seam for the drop-target markup). */
  initialDropTarget?: string | null;
}

function AlbumRow({ album, count, selected, onSelect, onRemoveAlbum, isDropTarget, onMoveToAlbum, onDropHighlight }: {
  album: Album;
  count: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemoveAlbum?: (id: string) => void;
  isDropTarget: boolean;
  onMoveToAlbum?: (photoIds: string[], albumId: string) => void;
  onDropHighlight: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // Viewport coordinates for the fixed-positioned menu (null until measured
  // after opening). The menu floats above the UI instead of clipping inside
  // the sidebar's scroll container.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The menu floats at measured coordinates, so a scroll or resize would
  // strand it away from its row: dismiss instead of letting it drift.
  useMenuDismiss(ref, () => setOpen(false), { enabled: open, dismissOnViewportChange: true });
  // Measure the open menu and pin it into the viewport: below the trigger
  // and right-aligned, flipping above near the bottom edge. The menu stays
  // in the row's React subtree, so outside-click dismissal is unchanged.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    setMenuPos(anchorMenuBelowTrigger(rect, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [open ]);
  const showMenu = Boolean(onRemoveAlbum);
  // Photo drops only: file drags from the OS pass through to the app-shell
  // import overlay (no highlight, no preventDefault), and the drop stops
  // there so the shell never tries to import photo ids as files.
  const dropProps = onMoveToAlbum ? {
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(MOVE_PHOTOS_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      onDropHighlight(album.id);
    },
    onDragLeave: () => onDropHighlight(null),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onDropHighlight(null);
      const ids = decodeMovePayload(event.dataTransfer.getData(MOVE_PHOTOS_MIME));
      if (ids.length) onMoveToAlbum(ids, album.id);
    },
  } : {};
  return (
    <div className={`album-row${open ? ' is-menu-open' : ''}${isDropTarget ? ' is-drop-target' : ''}`} ref={ref} {...dropProps}>
      <button className={`sidebar-item album-item ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(album.id)}>
        {album.cover ? <img src={album.cover} alt="" loading="lazy" /> : <Folder size={19} />}
        <span>{album.name}</span>
        <span className="item-count">{count}</span>
      </button>
      {showMenu && (
        <IconButton
          label={`Album actions for ${album.name}`}
          className="album-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          ref={triggerRef}
          onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}
        >
          <MoreHorizontal size={15} />
        </IconButton>
      )}
      {showMenu && open && (
        <div className="dropdown-menu album-menu sidebar-album-menu" role="menu" aria-label={`Album actions for ${album.name}`} ref={menuRef} style={menuPos ? { left: menuPos.x, top: menuPos.y } : undefined}>
          {onRemoveAlbum && <MenuItem danger onClick={() => { setOpen(false); onRemoveAlbum(album.id); }}>Delete album…</MenuItem>}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ photos, albums, collection, search, onSearch, onSelect, onImport, onNewAlbum, onRemoveAlbum, onMoveToAlbum, initialDropTarget }: SidebarProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(initialDropTarget ?? null);
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
        <section className="sidebar-section albums-section"><div className="sidebar-section-heading"><h2>Albums</h2><IconButton label="Create album" onClick={onNewAlbum}><Plus size={14} /></IconButton></div><nav>{albums.map((album) => <AlbumRow key={album.id} album={album} count={photos.filter((photo) => photo.albumId === album.id).length} selected={collection === album.id} onSelect={onSelect} onRemoveAlbum={onRemoveAlbum} isDropTarget={dropTarget === album.id} onMoveToAlbum={onMoveToAlbum} onDropHighlight={setDropTarget} />)}</nav></section>
      </div>
      <div className="sidebar-bottom"><button className="import-button" onClick={onImport}><Import size={16} />Import Photos<span>+</span></button></div>
    </aside>
  );
}
