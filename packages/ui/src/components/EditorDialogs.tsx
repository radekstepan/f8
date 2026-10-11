import { useState } from 'react';
import { Camera, Check, Download, Folder, FolderPlus, Info, Keyboard, MapPin, Save, Share } from 'lucide-react';
import { downloadBlob, exportPhoto, getPhotoFilter } from '@photomator/core';
import type { DialogType, EditState, Photo, RepairInpaintBinding } from '@photomator/core';
import { BrandMark, Modal, RangeControl, SelectField } from './EditorUI.js';

interface EditorDialogsProps {
  dialog: DialogType;
  photo: Photo;
  edit: EditState;
  /** Worker inpainting for repair strokes at export; absent means blur repair. */
  inpaintRepair?: RepairInpaintBinding | null;
  onClose: () => void;
  onToast: (message: string) => void;
  onCreateAlbum: (name: string, includePhoto: boolean) => void;
  onSavePreset: (name: string) => void;
}

function ExportDialog({ photo, edit, inpaintRepair, onClose, onToast }: Pick<EditorDialogsProps, 'photo' | 'edit' | 'inpaintRepair' | 'onClose' | 'onToast'>) {
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(90);
  const [size, setSize] = useState('1200');
  const [filename, setFilename] = useState(`${photo.name.replace(/\.[^.]+$/, '')}-edited`);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const handleExport = async () => {
    if (!filename.trim()) { setError('Give your photo a filename first.'); return; }
    setExporting(true);
    setError('');
    try {
      const blob = await exportPhoto(photo.src, edit, format, quality, Number(size), inpaintRepair ? { method: inpaintRepair.method, runInpaint: inpaintRepair.run } : undefined);
      downloadBlob(blob, `${filename.trim().replace(/[\\/:*?"<>|]/g, '-')}.${format === 'jpeg' ? 'jpg' : format}`);
      onToast(`Your photo was exported as ${format.toUpperCase()}.`);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Export failed. Please try again.');
    } finally { setExporting(false); }
  };
  return <Modal title="Export Photo" subtitle="The finishing touch. Ready to share." onClose={onClose} className="export-modal"><div className="export-preview"><img src={photo.src} alt={photo.title} style={{ filter: getPhotoFilter(edit) }} /><div><span>{photo.name}</span><small>{edit.preset === 'Original' ? 'Original photo' : 'All adjustments applied'}</small></div><Check size={16} /></div><form onSubmit={(event) => { event.preventDefault(); void handleExport(); }}><label className="text-field"><span>Save As</span><div className="filename-field"><input value={filename} onChange={(event) => setFilename(event.target.value)} aria-label="Export filename" /><span>.{format === 'jpeg' ? 'jpg' : format}</span></div></label><SelectField label="Format" value={format} options={[{ value: 'jpeg', label: 'JPEG - Best for sharing' }, { value: 'png', label: 'PNG - Lossless quality' }, { value: 'webp', label: 'WebP - Smaller file size' }]} onChange={setFormat} /><SelectField label="Image Size" value={size} options={[{ value: '10000', label: 'Original source size' }, { value: '2048', label: 'Large - Up to 2048 px' }, { value: '1200', label: 'Medium - Up to 1200 px' }, { value: '800', label: 'Small - Up to 800 px' }]} onChange={setSize} />{format !== 'png' && <RangeControl label="Quality" value={quality} min={10} max={100} suffix="%" onChange={setQuality} />}<p className="dialog-note"><Info size={14} /><span>Your original stays untouched. Sample photos export at their available web resolution.</span></p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="text-button export-settings" onClick={() => { downloadBlob(new Blob([JSON.stringify({ photo: photo.name, adjustments: edit, version: 1 }, null, 2)], { type: 'application/json' }), `${filename || 'photo'}-adjustments.json`); onToast('Adjustment settings downloaded.'); }}><Download size={13} />Settings</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={exporting}>{exporting ? <span className="loading-spinner small" /> : <Share size={14} />}{exporting ? 'Exporting...' : 'Export Photo'}</button></div></form></Modal>;
}

function AlbumDialog({ onClose, onCreateAlbum }: Pick<EditorDialogsProps, 'onClose' | 'onCreateAlbum'>) {
  const [name, setName] = useState('');
  const [includePhoto, setIncludePhoto] = useState(false);
  return <Modal title="New Album" subtitle="A home for the moments that belong together." onClose={onClose} className="small-modal"><div className="dialog-feature-icon"><FolderPlus size={30} strokeWidth={1.3} /></div><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onCreateAlbum(name.trim(), includePhoto); }}><label className="text-field"><span>Album Name</span><input autoFocus placeholder="e.g. A summer in Italy" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required /></label><label className="checkbox-field"><input type="checkbox" checked={includePhoto} onChange={(event) => setIncludePhoto(event.target.checked)} /><span>Move the current photo into this album</span></label><div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim()} type="submit">Create Album</button></div></form></Modal>;
}

function PresetDialog({ onClose, onSavePreset }: Pick<EditorDialogsProps, 'onClose' | 'onSavePreset'>) {
  const [name, setName] = useState('');
  return <Modal title="Save Preset" subtitle="Your signature look, just a click away." onClose={onClose} className="small-modal"><div className="dialog-feature-icon"><Save size={28} strokeWidth={1.3} /></div><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSavePreset(name.trim()); }}><label className="text-field"><span>Preset Name</span><input autoFocus placeholder="e.g. Alpine Morning" value={name} maxLength={35} onChange={(event) => setName(event.target.value)} required /></label><p className="dialog-note">Your color adjustments will be saved in My Presets. Crops and retouching are not included.</p><div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim()} type="submit">Save Preset</button></div></form></Modal>;
}

const shortcuts = [
  ['Navigation', [['Photo browser', 'G'], ['Previous / next photo', 'Left / Right'], ['Search library', '/'], ['Photo information', 'I'], ['Focus mode', 'Shift F']]],
  ['Editing', [['Auto Enhance', 'A'], ['Color adjustments', 'V'], ['Crop & straighten', 'C'], ['Repair tool', 'J'], ['Rotate left', 'R'], ['Favorite photo', 'F']]],
  ['Preview', [['Compare before & after', 'B'], ['Hold to show original', '\\'], ['Zoom in / out', '+ / -'], ['Zoom to fit', '0']]],
  ['Your workflow', [['Undo', 'Ctrl / Cmd Z'], ['Redo', 'Ctrl / Cmd Shift Z'], ['Import photos', 'Ctrl / Cmd O'], ['Export photo', 'Ctrl / Cmd Shift E'], ['Copy adjustments', 'Ctrl / Cmd Shift C'], ['Paste adjustments', 'Ctrl / Cmd Shift V']]],
] as const;

export function EditorDialogs(props: EditorDialogsProps) {
  const { dialog, photo, onClose } = props;
  if (!dialog) return null;
  if (dialog === 'export') return <ExportDialog {...props} />;
  if (dialog === 'album') return <AlbumDialog {...props} />;
  if (dialog === 'preset') return <PresetDialog {...props} />;
  if (dialog === 'info') return <Modal title="Photo Information" subtitle={photo.title} onClose={onClose} className="info-modal"><img className="info-photo" src={photo.src} alt={photo.title} /><div className="info-filename"><h3>{photo.name}</h3><span className="file-type">{photo.raw ? 'RAW' : 'IMAGE'}</span></div><div className="photo-info-section"><h4><Camera size={14} />Camera</h4><strong>{photo.camera}</strong><p>{photo.lens}</p><div className="photo-info-grid"><div><small>ISO</small><span>{photo.iso || 'Not available'}</span></div><div><small>Aperture</small><span>{photo.aperture}</span></div><div><small>Shutter Speed</small><span>{photo.shutter}</span></div><div><small>Focal Length</small><span>{photo.focalLength}</span></div><div><small>Dimensions</small><span>{photo.width.toLocaleString()} x {photo.height.toLocaleString()}</span></div><div><small>Date Taken</small><span>{new Date(photo.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div></div></div><div className="photo-info-location"><MapPin size={15} />{photo.location}</div>{photo.path && <div className="photo-info-location" title={photo.path}><Folder size={15} /><span className="photo-info-path">{photo.path}</span></div>}{photo.missing && <p className="form-error" role="alert">The original file is missing. Reimport it from its new location to relink your edits.</p>}{photo.photographer && <p className="photo-credit">Photo by {photo.photographer} / Pexels<br /><span>Camera details are illustrative sample data.</span></p>}</Modal>;
  if (dialog === 'shortcuts') return <Modal title="A faster way to create." subtitle="Keep your hands on the keyboard, and your eyes on the photo." onClose={onClose} className="shortcuts-modal"><div className="shortcuts-symbol"><Keyboard size={27} strokeWidth={1.4} /></div><div className="shortcuts-grid">{shortcuts.map(([name, items]) => <section key={name}><h3>{name}</h3>{items.map(([label, key]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</section>)}</div></Modal>;
  return <Modal title="About This Workspace" onClose={onClose} className="about-modal"><div className="about-brand"><BrandMark size={64} /><h2>Photomator</h2><span>THE KITCHEN SINK EDITION</span><p>A little darkroom. A lot of possibilities.</p></div><p className="about-copy">An independent, interactive interface study inspired by Photomator. Import a photo, find your look, and make this workspace your own.</p><div className="extension-points"><h3>Built to be extended.</h3><p><code>editor/data.ts</code><span>Photos, albums & presets</span></p><p><code>editor/image.ts</code><span>Preview & export pipeline</span></p><p><code>components/</code><span>Reusable editor controls</span></p></div><p className="about-disclaimer">Not affiliated with Apple or Pixelmator. All processing happens in your browser. Automatic adjustments are histogram-based; RAW development, AI processing, and machine-learning models are not included.</p><button className="primary-button full-width" onClick={onClose}>Back to creating</button></Modal>;
}