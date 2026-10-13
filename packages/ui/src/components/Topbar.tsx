import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, Bandage, Columns2, Crop, Info, Maximize2, PanelLeft, Redo2, Share, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-react';
import type { DialogType, Tool, VisionWorkerStatus } from '@f8/core';
import { APP_EDITION_SHORT, APP_NAME } from '@f8/core';
import { BrandMark, IconButton, MenuItem, MenuSeparator, MlBadge } from './EditorUI.js';
import { useMenuDismiss } from '../hooks/useMenuDismiss.js';

export type MenuAction = 'import' | 'import-local-folder' | 'import-folder' | 'export' | 'album' | 'undo' | 'redo' | 'reset' | 'copy' | 'paste' | 'enhance' | 'enhance-scene' | 'enhance-faces' | 'rotate' | 'favorite' | 'remove' | 'sidebar' | 'inspector' | 'presets' | 'filmstrip' | 'compare' | 'grid' | 'fit' | 'fullscreen' | 'shortcuts' | 'about';

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
}

export function MenuBar({ onAction, canUndo, canRedo, canPaste, compareDisabled, sidebar, inspector, presets, filmstrip }: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(ref, () => setOpen(null));
  const action = (value: MenuAction) => { onAction(value); setOpen(null); };
  const item = (name: string, value: MenuAction, shortcut?: string, disabled?: boolean, checked?: boolean, danger?: boolean) => <MenuItem key={value} onClick={() => action(value)} shortcut={shortcut} disabled={disabled} checked={checked} danger={danger}>{name}</MenuItem>;
  const menus: Record<string, ReactNode> = {
    [APP_NAME]: <>{item(`About ${APP_NAME}`, 'about')}<MenuSeparator />{item('Keyboard Shortcuts', 'shortcuts', '?')}</>,
    File: <>{item('Import Photos...', 'import', 'Ctrl O')}{item('Import Folder as Album...', 'import-local-folder')}{item('Import from Folder...', 'import-folder', 'Ctrl Shift O')}{item('New Album...', 'album')}<MenuSeparator />{item('Export Photo...', 'export', 'Ctrl Shift E')}</>,
    Edit: <>{item('Undo', 'undo', 'Ctrl Z', !canUndo)}{item('Redo', 'redo', 'Ctrl Shift Z', !canRedo)}<MenuSeparator />{item('Copy Adjustments', 'copy', 'Ctrl Shift C')}{item('Paste Adjustments', 'paste', 'Ctrl Shift V', !canPaste)}<MenuSeparator />{item('Reset All Adjustments', 'reset')}</>,
    Image: <>{item('Auto Enhance', 'enhance', 'A')}<MenuItem key="enhance-scene" onClick={() => action('enhance-scene')} shortcut="Shift A"><span>Scene Enhance <MlBadge hint="The scene is classified by a machine-learning model on your device" /></span></MenuItem><MenuItem key="enhance-faces" onClick={() => action('enhance-faces')} shortcut="Shift E"><span>Enhance Faces <MlBadge hint="Faces are detected by a machine-learning model on the photo server" /></span></MenuItem>{item('Rotate Left', 'rotate', 'R')}{item('Toggle Favorite', 'favorite', 'F')}<MenuSeparator />{item('Compare with Original', 'compare', 'B', compareDisabled)}<MenuSeparator />{item('Remove from Library…', 'remove', 'Del', false, undefined, true)}</>,
    View: <>{item('Show Library', 'sidebar', undefined, false, sidebar)}{item('Show Adjustments', 'inspector', undefined, false, inspector)}{item('Show Presets', 'presets', undefined, false, presets)}{item('Show Filmstrip', 'filmstrip', undefined, false, filmstrip)}<MenuSeparator />{item('Photo Browser', 'grid', 'G')}{item('Zoom to Fit', 'fit', '0')}</>,
    Window: <>{item('Focus Mode', 'fullscreen', 'Shift F')}{item('Photo Browser', 'grid')}</>,
    Help: <>{item('Keyboard Shortcuts', 'shortcuts', '?')}{item(`About ${APP_NAME}`, 'about')}</>,
  };
  const focusFirstItem = () => window.requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[role="menu"] button:not([disabled])')?.focus());
  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' && (event.target as HTMLElement).classList.contains('menu-trigger')) {
        event.preventDefault();
        event.stopPropagation();
        setOpen((event.target as HTMLElement).textContent);
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
      const names = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('.menu-trigger') || []).filter((button) => button.offsetParent !== null).map((button) => button.textContent || '');
      setOpen(names[(names.indexOf(open) + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length] ?? null);
      focusFirstItem();
    } else if (event.key === 'Escape') {
      ref.current?.querySelector<HTMLButtonElement>('.menu-trigger.is-open')?.focus();
      setOpen(null);
    }
  };

  return (
    <div className="menu-bar" ref={ref} onKeyDown={handleMenuKey}>
      <BrandMark size={19} />
      <nav aria-label="Application menu">
        {Object.entries(menus).map(([name, content]) => (
          <div className="menu-anchor" key={name}>
            <button
              className={`menu-trigger ${name === APP_NAME ? 'brand-name' : ''} ${open === name ? 'is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open === name}
              onClick={() => setOpen(open === name ? null : name)}
              onMouseEnter={() => { if (open) setOpen(name); }}
            >{name}</button>
            {open === name && <div className="dropdown-menu" role="menu">{content}</div>}
          </div>
        ))}
      </nav>
      <div className="demo-indicator"><span />{APP_EDITION_SHORT}</div>
    </div>
  );
}

interface ToolbarProps {
  collectionName: string;
  count: number;
  tool: Tool;
  enhanced: boolean;
  compare: boolean;
  canUndo: boolean;
  canRedo: boolean;
  libraryView: boolean;
  presetsOpen?: boolean;
  onTool: (tool: Tool) => void;
  onAction: (action: MenuAction) => void;
  onDialog: (dialog: DialogType) => void;
  onTogglePresets?: () => void;
}

export function Toolbar({ collectionName, count, tool, enhanced, compare, canUndo, canRedo, libraryView, presetsOpen, onTool, onAction, onDialog, onTogglePresets }: ToolbarProps) {
  const tools = [
    { id: 'adjust', label: 'Adjust', icon: SlidersHorizontal, active: tool === 'adjust' },
    { id: 'repair', label: 'Repair', icon: Bandage, active: tool === 'repair' },
    { id: 'crop', label: 'Crop', icon: Crop, active: tool === 'crop' },
    { id: 'enhance', label: 'Enhance', icon: Sparkles, active: enhanced },
  ];
  return (
    <header className="toolbar">
      <div className="window-toolbar">
        <IconButton label="Toggle library sidebar" onClick={() => onAction('sidebar')}><PanelLeft size={18} strokeWidth={1.6} /></IconButton>
      </div>
      <div className="main-toolbar">
        <div className="collection-breadcrumb">
          <IconButton label={libraryView ? 'Open selected photo' : 'Back to photo browser'} onClick={() => onAction('grid')}><ArrowLeft size={19} /></IconButton>
          <div>
            <button onClick={() => onAction('grid')} title={libraryView ? 'Return to editor' : 'Browse collection'}>{collectionName}</button>
            <small>{count} photos</small>
          </div>
        </div>
        <div className="editing-tools" role="toolbar" aria-label="Editing tools">
          {tools.map(({ id, label, icon: Icon, active }) => (
            <button
              key={id}
              className={`tool-button ${active ? 'is-active' : ''} ${id === 'enhance' ? 'enhance-tool' : ''}`}
              aria-label={label}
              aria-pressed={active}
              title={id === 'enhance' ? 'Auto Enhance (A) — one-shot, not a tool' : label}
              onClick={() => id === 'enhance' ? onAction('enhance') : onTool(id as Tool)}
            ><Icon size={20} strokeWidth={1.55} /><span>{label}</span></button>
          ))}
        </div>
        <div className="history-buttons">
          <IconButton label="Undo (Ctrl Z)" disabled={!canUndo} onClick={() => onAction('undo')}><Undo2 size={18} /></IconButton>
          <IconButton label="Redo (Ctrl Shift Z, Ctrl Y)" disabled={!canRedo} onClick={() => onAction('redo')}><Redo2 size={18} /></IconButton>
        </div>
      </div>
      <div className="toolbar-actions">
        {onTogglePresets && <IconButton label={presetsOpen ? 'Hide presets' : 'Show presets'} active={presetsOpen} onClick={onTogglePresets}><SlidersHorizontal size={18} strokeWidth={1.6} /></IconButton>}
        <IconButton label={tool === 'crop' ? 'Compare with original (unavailable while cropping)' : 'Compare with original (B)'} active={compare} disabled={tool === 'crop'} onClick={() => onAction('compare')}><Columns2 size={18} strokeWidth={1.6} /></IconButton>
        <IconButton label="Photo information (I)" onClick={() => onDialog('info')}><Info size={18} strokeWidth={1.6} /></IconButton>
        <button className="export-button" onClick={() => onDialog('export')}><Share size={15} /><span>Export</span></button>
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
      return <button type="button" className="vision-activate" onClick={vision.onActivate} title="Start the vision engine (lazy OpenCV download)">Vision engine: idle</button>;
    case 'loading':
      return <span role="status">Vision engine: downloading…</span>;
    case 'ready':
      return vision.selfTest === false
        ? <span role="status" title="OpenCV loaded but the grayscale self-test failed">Vision engine: self-test failed</span>
        : <span>Vision engine ready{vision.version ? ` (OpenCV ${vision.version})` : ''}</span>;
    case 'failed':
      return <button type="button" className="vision-activate" onClick={vision.onActivate} title="The vision engine failed to load. Retry the download.">Vision engine unavailable — retry</button>;
  }
}

export function AppStatus({ count, vision }: { count: number; vision?: VisionIndicator }) {
  return <footer className="app-status"><span>{count} photos in your library</span><span className="status-center">Non-destructive editing<span className="status-divider" />Your originals stay original.{vision && <><span className="status-divider" />{renderVision(vision)}</>}</span></footer>;
}