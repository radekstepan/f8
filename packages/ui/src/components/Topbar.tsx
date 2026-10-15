import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bandage, Check, ChevronLeft, ChevronRight, Columns2, Crop, Info, Maximize2, PanelLeft, Redo2, RotateCcw, Share, SlidersHorizontal, SwatchBook, Trash2, Undo2 } from 'lucide-react';
import type { DialogType, Tool, VisionWorkerStatus, ZoomLensMagnification } from '@f8/core';
import { APP_NAME, APP_VERSION, ZOOM_LENS_MAGNIFICATIONS } from '@f8/core';
import { BrandMark, IconButton, MenuItem, MenuSeparator, MlBadge } from './EditorUI.js';
import { useCompareHold } from '../hooks/useCompareHold.js';
import { useMenuDismiss } from '../hooks/useMenuDismiss.js';

export type MenuAction = 'import' | 'import-local-folder' | 'import-folder' | 'export' | 'album' | 'undo' | 'redo' | 'reset' | 'copy' | 'paste' | 'enhance' | 'enhance-scene' | 'enhance-faces' | 'rotate' | 'favorite' | 'remove' | 'sidebar' | 'inspector' | 'presets' | 'filmstrip' | 'compare' | 'grid' | 'back' | 'fit' | 'zoom-lens-4' | 'zoom-lens-8' | 'zoom-lens-16' | 'fullscreen' | 'shortcuts' | 'about';

const zoomLensActions: Record<ZoomLensMagnification, MenuAction> = { 4: 'zoom-lens-4', 8: 'zoom-lens-8', 16: 'zoom-lens-16' };

interface MenuBarProps {
  onAction: (action: MenuAction) => void;
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  compareDisabled?: boolean;
  sidebar: boolean;
  inspector: boolean;
  presets: boolean;
  filmstrip: boolean;
  /** True while the zoom-in-view preview is toggled on (photo view only). Defaults to false. */
  zoomLens?: boolean;
  /** Active zoom-in-view magnification; the submenu checks it. Defaults to 8. */
  zoomLensMagnification?: ZoomLensMagnification;
}

export function MenuBar({ onAction, canUndo, canRedo, canPaste, compareDisabled, sidebar, inspector, presets, filmstrip, zoomLens = false, zoomLensMagnification = 8 }: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [submenu, setSubmenu] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const openMenu = (name: string | null) => { setOpen(name); setSubmenu(null); };
  useMenuDismiss(ref, () => openMenu(null));
  const action = (value: MenuAction) => { onAction(value); openMenu(null); };
  const item = (name: string, value: MenuAction, shortcut?: string, disabled?: boolean, checked?: boolean, danger?: boolean) => <MenuItem key={value} onClick={() => action(value)} shortcut={shortcut} disabled={disabled} checked={checked} danger={danger}>{name}</MenuItem>;
  // Zoom-in-view sits in its own section under the Show toggles (not
  // at the dropdown's bottom): a checked parent with a 4x/8x/16x flyout. Hover opens it;
  // clicking the parent itself while the preview is on clears it (re-picks
  // the active factor, which the App toggle rule turns off) and dismisses
  // the menu like any other item; while off, click toggles the flyout for
  // touch. Only the 8x default carries the Z shortcut.
  const zoomLensSubmenu = <div className="menu-submenu-anchor" onMouseEnter={() => setSubmenu('zoom-lens')} onMouseLeave={() => setSubmenu(null)}>
    <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu === 'zoom-lens'} className="menu-item has-submenu" onClick={() => zoomLens ? action(zoomLensActions[zoomLensMagnification]) : setSubmenu(submenu === 'zoom-lens' ? null : 'zoom-lens')}><span className="menu-check">{zoomLens && <Check size={13} />}</span><span>Zoom in View</span><ChevronRight size={13} className="menu-chevron" /></button>
    {submenu === 'zoom-lens' && <div className="dropdown-menu dropdown-submenu" role="menu">{ZOOM_LENS_MAGNIFICATIONS.map((mag) => <MenuItem key={mag} onClick={() => action(zoomLensActions[mag])} shortcut={mag === 8 ? 'Z' : undefined} checked={zoomLens && zoomLensMagnification === mag}>{`${mag}×`}</MenuItem>)}</div>}
  </div>;
  const menus: Record<string, ReactNode> = {
    File: <>{item('Import Photos...', 'import', 'Ctrl O')}{item('Import Folder as Album...', 'import-local-folder')}{item('Import from Folder...', 'import-folder', 'Ctrl Shift O')}{item('New Album...', 'album')}<MenuSeparator />{item('Export Photo...', 'export', 'Ctrl Shift E')}</>,
    Edit: <>{item('Undo', 'undo', 'Ctrl Z', !canUndo)}{item('Redo', 'redo', 'Ctrl Shift Z', !canRedo)}<MenuSeparator />{item('Copy Adjustments', 'copy', 'Ctrl Shift C')}{item('Paste Adjustments', 'paste', 'Ctrl Shift V', !canPaste)}<MenuSeparator />{item('Reset All Adjustments', 'reset')}</>,
    Image: <>{item('Auto Enhance', 'enhance', 'A')}<MenuItem key="enhance-scene" onClick={() => action('enhance-scene')} shortcut="Shift A">Scene Enhance</MenuItem><MenuItem key="enhance-faces" onClick={() => action('enhance-faces')} shortcut="Shift E"><span>Enhance Faces <MlBadge hint="Faces are detected by a machine-learning model on the photo server" /></span></MenuItem>{item('Rotate Left', 'rotate', 'R')}{item('Toggle Favorite', 'favorite', 'F')}<MenuSeparator />{item('Compare with Original', 'compare', 'B', compareDisabled)}<MenuSeparator />{item('Remove from Library…', 'remove', 'Del', false, undefined, true)}</>,
    View: <>{item('Focus Mode', 'fullscreen', 'Shift F')}<MenuSeparator />{item('Show Library', 'sidebar', undefined, false, sidebar)}{item('Show Adjustments', 'inspector', undefined, false, inspector)}{item('Show Presets', 'presets', undefined, false, presets)}{item('Show Filmstrip', 'filmstrip', undefined, false, filmstrip)}<MenuSeparator />{zoomLensSubmenu}<MenuSeparator />{item('Photo Browser', 'grid', 'G')}{item('Zoom to Fit', 'fit', '0')}</>,
    Help: <>{item('Keyboard Shortcuts', 'shortcuts', '?')}{item(`About ${APP_NAME}`, 'about')}</>,
  };
  const focusFirstItem = () => window.requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[role="menu"] button:not([disabled])')?.focus());
  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' && (event.target as HTMLElement).classList.contains('menu-trigger')) {
        event.preventDefault();
        event.stopPropagation();
        openMenu((event.target as HTMLElement).textContent);
        focusFirstItem();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not([disabled])') || []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      const focused = document.activeElement as HTMLElement | null;
      // Into/out of the flyout: ArrowRight on a closed submenu parent
      // opens it, ArrowLeft inside a flyout closes back to the parent.
      if (event.key === 'ArrowRight' && focused?.getAttribute('aria-haspopup') === 'menu' && focused?.getAttribute('aria-expanded') === 'false') {
        // Submenu parents open the flyout directly: clicking one would fire
        // its clear action instead. Triggers still open via click.
        if (focused.classList.contains('has-submenu')) setSubmenu('zoom-lens');
        else (focused as HTMLButtonElement).click();
        window.requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('.dropdown-submenu button:not([disabled])')?.focus());
        return;
      }
      if (event.key === 'ArrowLeft' && focused?.closest('.dropdown-submenu')) {
        setSubmenu(null);
        ref.current?.querySelector<HTMLButtonElement>('.menu-item.has-submenu')?.focus();
        return;
      }
      const names = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('.menu-trigger') || []).filter((button) => button.offsetParent !== null).map((button) => button.textContent || '');
      openMenu(names[(names.indexOf(open) + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length] ?? null);
      focusFirstItem();
    } else if (event.key === 'Escape') {
      ref.current?.querySelector<HTMLButtonElement>('.menu-trigger.is-open')?.focus();
      openMenu(null);
    }
  };

  return (
    <div className="menu-bar" ref={ref} onKeyDown={handleMenuKey}>
      <BrandMark size={19} />
      <nav aria-label="Application menu">
        {Object.entries(menus).map(([name, content]) => (
          <div className="menu-anchor" key={name}>
            <button
              className={`menu-trigger ${open === name ? 'is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open === name}
              onClick={() => openMenu(open === name ? null : name)}
              onMouseEnter={() => { if (open) openMenu(name); }}
            >{name}</button>
            {open === name && <div className="dropdown-menu" role="menu">{content}</div>}
          </div>
        ))}
      </nav>
      <div className="version-indicator"><span />{`v${APP_VERSION}`}</div>
    </div>
  );
}

interface ToolbarProps {
  /** Null while the photo's collection is not yet known: the backlink renders nothing rather than a wrong name, then fades in once known. Never null in the library grid. */
  collectionName: string | null;
  count: number;
  tool: Tool;
  compare: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showBacklink: boolean;
  /** False in the library grid: the photo-only controls are omitted. Defaults to true. */
  showPhotoTools?: boolean;
  presetsOpen?: boolean;
  /** False when the recipe already matches the factory default (nothing to reset). Defaults to true. */
  canReset?: boolean;
  /** False when the photo has no edits, so there is nothing to compare. Defaults to true. */
  canCompare?: boolean;
  /** Fires while the Compare button is held down: App shows the full original until release. */
  onHoldOriginal?: (holding: boolean) => void;
  onTool: (tool: Tool) => void;
  onAction: (action: MenuAction) => void;
  onDialog: (dialog: DialogType) => void;
  onTogglePresets?: () => void;
}

export function Toolbar({ collectionName, count, tool, compare, canUndo, canRedo, showBacklink, showPhotoTools = true, presetsOpen, canReset = true, canCompare = true, onHoldOriginal, onTool, onAction, onDialog, onTogglePresets }: ToolbarProps) {
  const compareHold = useCompareHold(onHoldOriginal);
  // Tools only: the one-shot Auto Enhance lives in the Adjust sidebar
  // (Image menu + A shortcut still reach it from anywhere).
  const tools = [
    { id: 'adjust', label: 'Adjust', icon: SlidersHorizontal, active: tool === 'adjust' },
    { id: 'repair', label: 'Repair', icon: Bandage, active: tool === 'repair' },
    { id: 'crop', label: 'Crop', icon: Crop, active: tool === 'crop' },
  ];
  return (
    <header className="toolbar">
      <div className="window-toolbar">
        <IconButton label="Toggle library sidebar" onClick={() => onAction('sidebar')}><PanelLeft size={18} strokeWidth={1.6} /></IconButton>
      </div>
      <div className="main-toolbar">
        <div className="collection-breadcrumb">
          {showBacklink ? (
            collectionName ? (
              <button className="photo-backlink" aria-label={`Back to ${collectionName}`} data-tooltip={`Back to ${collectionName} (G)`} onClick={() => onAction('back')}><ChevronLeft size={14} className="backlink-chevron" aria-hidden="true" /><span className="backlink-name">{collectionName}</span></button>
            ) : null
          ) : (
            <div className="collection-title"><span className="collection-name">{collectionName}</span><span className="collection-count">{count} photos</span></div>
          )}
        </div>
        {showPhotoTools && <div className="editing-tools" role="toolbar" aria-label="Editing tools">
          {tools.map(({ id, label, icon: Icon, active }) => (
            <button
              key={id}
              className={`tool-button ${active ? 'is-active' : ''}`}
              aria-label={label}
              aria-pressed={active}
              data-tooltip={label}
              onClick={() => onTool(id as Tool)}
            ><Icon size={20} strokeWidth={1.55} /><span>{label}</span></button>
          ))}
        </div>}
        {showPhotoTools && <div className="history-buttons">
          <IconButton label="Undo (Ctrl Z)" disabled={!canUndo} onClick={() => onAction('undo')}><Undo2 size={18} /></IconButton>
          <IconButton label="Redo (Ctrl Shift Z, Ctrl Y)" disabled={!canRedo} onClick={() => onAction('redo')}><Redo2 size={18} /></IconButton>
        </div>}
      </div>
      <div className="toolbar-actions">
        {showPhotoTools && <IconButton label="Reset to original" className="toolbar-reset" active={canReset} disabled={!canReset} onClick={() => onAction('reset')}><RotateCcw size={18} strokeWidth={1.6} /></IconButton>}
        {showPhotoTools && <IconButton label={tool === 'crop' ? 'Compare with original (unavailable while cropping)' : !canCompare ? 'Compare with original (no edits yet)' : 'Compare with original (B)'} data-tooltip={tool === 'crop' ? 'Compare with original (unavailable while cropping)' : !canCompare ? 'Compare with original (no edits yet)' : 'Compare with original (B) — hold to peek at the original'} active={compare} disabled={tool === 'crop' || !canCompare} onClick={compareHold.filterClick(() => onAction('compare'))} {...compareHold.holdProps}><Columns2 size={18} strokeWidth={1.6} /></IconButton>}
        {showPhotoTools && onTogglePresets && <IconButton label={presetsOpen ? 'Hide presets' : 'Show presets'} active={presetsOpen} onClick={onTogglePresets}><SwatchBook size={18} strokeWidth={1.6} /></IconButton>}
        {showPhotoTools && <IconButton label="Remove from library (Del)" className="toolbar-remove" onClick={() => onAction('remove')}><Trash2 size={18} strokeWidth={1.6} /></IconButton>}
        {showPhotoTools && <IconButton label="Photo information (I)" onClick={() => onDialog('info')}><Info size={18} strokeWidth={1.6} /></IconButton>}
        {showPhotoTools && <button className="export-button" onClick={() => onDialog('export')}><Share size={15} /><span>Export</span></button>}
        <IconButton label="Focus mode (Shift F)" className="mobile-focus" onClick={() => onAction('fullscreen')}><Maximize2 size={17} /></IconButton>
      </div>
    </header>
  );
}

export interface VisionIndicator {
  status: VisionWorkerStatus;
  version: string | null;
  selfTest: boolean | null;
  onActivate: () => void;
}

function renderVision(vision: VisionIndicator) {
  switch (vision.status) {
    case 'idle':
      return <button type="button" className="vision-activate" onClick={vision.onActivate} data-tooltip="Start the vision engine (lazy OpenCV download)">Vision engine: idle</button>;
    case 'loading':
      return <span role="status">Vision engine: downloading…</span>;
    case 'ready':
      return vision.selfTest === false
        ? <span role="status" data-tooltip="OpenCV loaded but the grayscale self-test failed">Vision engine: self-test failed</span>
        : <span>Vision engine ready{vision.version ? ` (OpenCV ${vision.version})` : ''}</span>;
    case 'failed':
      return <button type="button" className="vision-activate" onClick={vision.onActivate} data-tooltip="The vision engine failed to load. Retry the download.">Vision engine unavailable — retry</button>;
  }
}

export function AppStatus({ count, vision }: { count: number; vision?: VisionIndicator }) {
  return <footer className="app-status"><span>{count} photos in your library</span><span className="status-center">Non-destructive editing<span className="status-divider" />Your originals stay original.{vision && <><span className="status-divider" />{renderVision(vision)}</>}</span></footer>;
}