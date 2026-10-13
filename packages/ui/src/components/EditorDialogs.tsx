import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Download, Folder, FolderPlus, Info, Keyboard, MapPin, Save, Share, Tag, Trash2, X } from 'lucide-react';
import { ABOUT_DISCLAIMER, APP_DESCRIPTION, APP_EDITION, APP_NAME, APP_TAGLINE, CULL_LABELS, EXTENSION_POINTS, SEMANTIC_CONCEPT_VOCAB, SEMANTIC_SEARCH_EMPTY_LABELS_NOTE, SEMANTIC_SEARCH_ML_BADGE_HINT, SUPERRES_MAX_INPUT_DIM, SUPERRES_SCALE, createLibraryClient, downloadBlob, encodeExportCanvas, exportPhoto, formatByteSize, getPhotoFilter, isDefaultEdit, isLossyExportFormat, loadStoredHealOverlays, renderExportCanvas, renderExportPreview, superresEngineNote } from '@f8/core';
import type { DialogType, EditState, Photo, RepairInpaintBinding, SuperresExportBinding, SuperresHealthSnapshot } from '@f8/core';

export interface RemoveAlbumTarget {
  id: string;
  name: string;
  /** Photos currently filed in the album; all stay in the library. */
  count: number;
}
import { BrandMark, CheckField, MlBadge, Modal, RangeControl, SelectField } from './EditorUI.js';

interface EditorDialogsProps {
  dialog: DialogType;
  photo: Photo;
  edit: EditState;
  /** Worker inpainting for repair strokes at export; absent means blur repair. */
  inpaintRepair?: RepairInpaintBinding | null;
  /** Server 2x upscale transport; omit to hide the super-resolution option. */
  superres?: SuperresExportBinding | null;
  /** Pre-check super-resolution (the library grid's "Export 2x" arms this). */
  initialSuperres?: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
  onCreateAlbum: (name: string) => void;
  onSavePreset: (name: string) => void;
  onRemovePhoto: (id: string) => void;
  /** Album awaiting delete confirmation; the dialog only renders when set. */
  removeAlbum?: RemoveAlbumTarget | null;
  onRemoveAlbum?: (id: string) => void;
  /** Add a hand-written label; omit to hide label management. */
  onAddLabel?: (photoId: string, label: string) => void;
  /** Remove any label (ML or hand-written). */
  onRemoveLabel?: (photoId: string, label: string) => void;
  /** Search the library for a label (label chips double as smart albums). */
  onSearchLabel?: (label: string) => void;
}

function PhotoLabelsSection({ photo, onAddLabel, onRemoveLabel, onSearchLabel }: Pick<EditorDialogsProps, 'photo' | 'onAddLabel' | 'onRemoveLabel' | 'onSearchLabel'>) {
  const [draft, setDraft] = useState('');
  const labels = photo.labels ?? [];
  const submit = () => {
    if (!draft.trim() || !onAddLabel) return;
    onAddLabel(photo.id, draft.trim());
    setDraft('');
  };
  return <div className="photo-info-section" data-testid="photo-labels"><h4><Tag size={14} />Labels</h4>{labels.length ? <ul className="photo-label-list">{labels.map((entry) => <li key={entry.label} className={`photo-label${entry.source === 'ml' ? ' is-ml' : ''}`}><button type="button" className="photo-label-name" data-tooltip={onSearchLabel ? `Show photos labeled "${entry.label}"` : entry.label} onClick={() => onSearchLabel?.(entry.label)}>{entry.label}</button>{entry.source === 'ml' && <MlBadge hint={SEMANTIC_SEARCH_ML_BADGE_HINT} />}{onRemoveLabel && <button type="button" className="photo-label-remove" aria-label={`Remove label "${entry.label}"`} onClick={() => onRemoveLabel(photo.id, entry.label)}><X size={11} /></button>}</li>)}</ul> : <p className="inspector-note">{SEMANTIC_SEARCH_EMPTY_LABELS_NOTE}</p>}{onAddLabel && <form className="photo-label-add" onSubmit={(event) => { event.preventDefault(); submit(); }}><input value={draft} maxLength={32} placeholder="Add a label" aria-label="Add a label" list="f8-label-vocab" onChange={(event) => setDraft(event.target.value)} /><datalist id="f8-label-vocab">{SEMANTIC_CONCEPT_VOCAB.map((word) => <option key={word} value={word} />)}{CULL_LABELS.filter((flag) => !SEMANTIC_CONCEPT_VOCAB.includes(flag)).map((flag) => <option key={flag} value={flag} />)}</datalist><button type="submit" className="secondary-button" disabled={!draft.trim()}>Add</button></form>}</div>;
}

/**
 * Focus-rect half-size in % of the full-view width — the denoise closeup
 * geometry: a 16× loupe samples 1/16 of the image width, so the rect is
 * 6.25% wide and the center stays a half-rect inside each edge. (The rect
 * is an on-screen square, which is exactly the sampled region: the square
 * zoom box always shows a W/16 × W/16 patch of the preview, whatever the
 * photo aspect.)
 */
const EXPORT_FOCUS_HALF = 100 / 32;

/** Clamp a focus % so the centered focus rect stays inside the full view. */
function clampExportFocus(value: number): number {
  return Math.max(EXPORT_FOCUS_HALF, Math.min(100 - EXPORT_FOCUS_HALF, value));
}

export interface ExportQualityPreviewProps {
  format: string;
  quality: number;
  /** Object URL of the encoded export; null while rendering or on failure. */
  previewUrl: string | null;
  estimating: boolean;
  /** Focus center in % of the full view; clicking the full view moves it. */
  focus: { x: number; y: number };
  onFocus: (focus: { x: number; y: number }) => void;
}

/**
 * Lossy-format quality preview: the full encoded export with a focus box,
 * side by side with a 16× closeup of the focused area (the denoise
 * closeup pattern). The pixels are the actual encode at the selected
 * settings — the same run that feeds the size estimate — so what you see
 * is what the download holds. PNG renders nothing (lossless, nothing to
 * judge); a failed run hides the section like the size line.
 */
export function ExportQualityPreview({ format, quality, previewUrl, estimating, focus, onFocus }: ExportQualityPreviewProps) {
  if (!isLossyExportFormat(format)) return null;
  if (!previewUrl) {
    if (!estimating) return null;
    return <section className="export-quality-preview" data-testid="export-quality-preview"><p className="export-quality-title" data-testid="export-quality-title">Quality preview</p><p className="inspector-note" role="status" data-testid="export-quality-loading">Rendering quality preview…</p></section>;
  }
  const position = `${focus.x}% ${focus.y}%`;
  return <section className="export-quality-preview" data-testid="export-quality-preview">
    <p className="export-quality-title" data-testid="export-quality-title">Quality preview</p>
    <div className="export-quality-views" data-testid="export-quality-views">
      <figure className="export-quality-full" data-testid="export-quality-full" data-tooltip="Click to move the 16× closeup" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = Math.round(((event.clientX - rect.left) / rect.width) * 100);
        const y = Math.round(((event.clientY - rect.top) / rect.height) * 100);
        onFocus({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
      }}><div className="export-quality-full-wrap"><img src={previewUrl} alt="Full export preview" data-testid="export-quality-full-img" /><div className="export-quality-focus" data-testid="export-quality-focus" aria-hidden="true" style={{ left: `${clampExportFocus(focus.x)}%`, top: `${clampExportFocus(focus.y)}%` }} /></div><figcaption>Full export</figcaption></figure>
      <figure><div className="export-quality-zoom" role="img" aria-label="Export closeup at 16x magnification" data-testid="export-quality-zoom" style={{ backgroundImage: `url("${previewUrl}")`, backgroundPosition: position }} /><figcaption>16×</figcaption></figure>
    </div>
    <p className="inspector-note" data-testid="export-quality-note">Actual {format.toUpperCase()} output at {quality}% — click the full view to move the closeup.</p>
  </section>;
}

function ExportDialog({ photo, edit, inpaintRepair, superres, initialSuperres, onClose, onToast }: Pick<EditorDialogsProps, 'photo' | 'edit' | 'inpaintRepair' | 'superres' | 'initialSuperres' | 'onClose' | 'onToast'>) {
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(90);
  const [size, setSize] = useState('1200');
  const [filename, setFilename] = useState(`${photo.name.replace(/\.[^.]+$/, '')}-edited`);
  const [exporting, setExporting] = useState(false);
  const [upscale2x, setUpscale2x] = useState(initialSuperres ?? false);
  const [upscaleProgress, setUpscaleProgress] = useState<{ fraction: number; stage: string } | null>(null);
  const [superresHealth, setSuperresHealth] = useState<SuperresHealthSnapshot | null>(null);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<{ bytes: number; width: number; height: number } | null>(null);
  const [estimating, setEstimating] = useState(true);
  const [previewUrl, setPreviewUrlState] = useState<string | null>(null);
  // Quality-preview focus in % of the full view. Dialog-owned so switching
  // presets (format, size, quality) keeps it — % coordinates stay valid
  // across sizes; only a new photo resets it to the center.
  const [focus, setFocus] = useState({ x: 50, y: 50 });
  useEffect(() => { setFocus({ x: 50, y: 50 }); }, [photo.id]);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  // Every preview URL goes through here so a superseded one revokes
  // instead of leaking; the unmount cleanup revokes the last one.
  const setPreviewUrl = useCallback((url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrlState(url);
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);
  // The engine note follows the checkbox: one health read per arming tells
  // whether the ML engine is ready, still downloading, or failed with a
  // cause. A rejected read keeps its message so the note shows the error.
  useEffect(() => {
    if (!upscale2x || !superres) { setSuperresHealth(null); return; }
    let live = true;
    setSuperresHealth(null);
    superres.health().then(
      (snapshot) => { if (live) setSuperresHealth(snapshot); },
      (reason) => { if (live) setSuperresHealth({ ready: false, source: 'onnx', downloading: false, downloadPct: 0, weightsReady: false, error: reason instanceof Error ? reason.message : 'Photo server unreachable — start it with yarn dev.' }); },
    );
    return () => { live = false; };
  }, [upscale2x, superres]);
  const engineNote = superresHealth ? superresEngineNote(superresHealth) : null;
  // Pre-export size estimate + quality preview: one real render + encode
  // at the selected settings (byte-exact modulo repair pixels — see
  // exportEstimate.ts), debounced so slider drags settle first. Lossy
  // formats also show the encoded blob as the quality preview, so the
  // on-screen pixels are the actual output. 2x upscales have no accurate
  // pre-export pixels (they only exist after the ML run), so the line
  // yields to an "unavailable" note and the preview hides instead of a
  // misleading figure; a failed run hides both rather than showing stale
  // numbers or pixels.
  useEffect(() => {
    if (upscale2x) { setEstimate(null); setEstimating(false); setPreviewUrl(null); return; }
    let live = true;
    setEstimating(true);
    setEstimate(null);
    setPreviewUrl(null);
    const timer = window.setTimeout(() => {
      renderExportPreview(photo.src, edit, format, quality, Number(size)).then(
        (result) => {
          if (!live) return;
          setEstimate({ bytes: result.bytes, width: result.width, height: result.height });
          setPreviewUrl(isLossyExportFormat(format) ? URL.createObjectURL(result.blob) : null);
          setEstimating(false);
        },
        () => { if (live) { setEstimate(null); setPreviewUrl(null); setEstimating(false); } },
      );
    }, 400);
    return () => { live = false; window.clearTimeout(timer); };
  }, [photo.src, edit, format, quality, size, upscale2x, setPreviewUrl]);
  // Expected long edge before the 2x (crop/rotation shift it a little; the
  // server enforces the real cap, this only drives the hint and the guard).
  const sourceLongEdge = Math.max(photo.width || 0, photo.height || 0);
  const expectedLongEdge = sourceLongEdge > 0 ? Math.min(sourceLongEdge, Number(size)) : Number(size);
  const overUpscaleCap = upscale2x && expectedLongEdge > SUPERRES_MAX_INPUT_DIM;
  const resolveRepair = async () => {
    // Reuse persisted per-group overlays so export matches the preview
    // without rehealing saved work (rescaled when sizes differ); missing
    // groups heal during export as before.
    const healOverlays = inpaintRepair && (inpaintRepair.method === 'ml-heal' || inpaintRepair.method === 'heal') && edit.retouches.some((point) => point.kind === 'repair')
      ? await loadStoredHealOverlays(createLibraryClient(), photo.id)
      : undefined;
    return inpaintRepair ? { method: inpaintRepair.method, runInpaint: inpaintRepair.run, quality: inpaintRepair.quality, seamlessLight: inpaintRepair.seamlessLight, featherPx: inpaintRepair.featherPx, ...(healOverlays?.length ? { healOverlays } : {}) } : undefined;
  };
  const handleExport = async () => {
    if (!filename.trim()) { setError('Give your photo a filename first.'); return; }
    setExporting(true);
    setError('');
    try {
      const repair = await resolveRepair();
      const outName = `${filename.trim().replace(/[\\/:*?"<>|]/g, '-')}.${format === 'jpeg' ? 'jpg' : format}`;
      if (upscale2x && superres) {
        const aborter = new AbortController();
        abortRef.current = aborter;
        const report = (fraction: number, stage: string) => setUpscaleProgress({ fraction, stage });
        try {
          const canvas = await renderExportCanvas(photo.src, edit, Number(size), repair);
          if (Math.max(canvas.width, canvas.height) > SUPERRES_MAX_INPUT_DIM) {
            setError(`This export is ${Math.max(canvas.width, canvas.height)}px — 2x upscales cap at ${SUPERRES_MAX_INPUT_DIM}px input. Pick Large or smaller.`);
            return;
          }
          let pixels: { width: number; height: number; data: Uint8ClampedArray };
          try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            const found = ctx.getImageData(0, 0, canvas.width, canvas.height);
            pixels = { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(found.data) };
          } catch {
            setError("This photo's pixels can't be read here. Imported photos always work.");
            return;
          }
          const upscaled = await superres.run(pixels, { onProgress: report, signal: aborter.signal });
          const out = document.createElement('canvas');
          out.width = upscaled.width;
          out.height = upscaled.height;
          out.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(upscaled.data), upscaled.width, upscaled.height), 0, 0);
          const blob = await encodeExportCanvas(out, format, quality);
          downloadBlob(blob, outName);
          onToast(`Your photo was exported 2x as ${format.toUpperCase()} (Real-ESRGAN · ML).`);
          onClose();
        } finally {
          abortRef.current = null;
          if (!aborter.signal.aborted) setUpscaleProgress(null);
        }
        return;
      }
      const blob = await exportPhoto(photo.src, edit, format, quality, Number(size), repair);
      downloadBlob(blob, outName);
      onToast(`Your photo was exported as ${format.toUpperCase()}.`);
      onClose();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') setError('Upscale cancelled.');
      else setError(reason instanceof Error ? reason.message : 'Export failed. Please try again.');
    } finally { setExporting(false); setUpscaleProgress(null); }
  };
  const cancelUpscale = () => abortRef.current?.abort();
  return <Modal title="Export Photo" subtitle="The finishing touch. Ready to share." onClose={onClose} className="export-modal"><div className="export-preview"><img src={photo.src} alt={photo.title} style={{ filter: getPhotoFilter(edit) }} /><div><span>{photo.name}</span><small>{isDefaultEdit(edit) ? 'Original photo' : 'All adjustments applied'}</small></div><Check size={16} /></div><form onSubmit={(event) => { event.preventDefault(); void handleExport(); }}><label className="text-field"><span>Save As</span><div className="filename-field"><input value={filename} onChange={(event) => setFilename(event.target.value)} aria-label="Export filename" /><span>.{format === 'jpeg' ? 'jpg' : format}</span></div></label><SelectField label="Format" value={format} options={[{ value: 'jpeg', label: 'JPEG - Best for sharing' }, { value: 'png', label: 'PNG - Lossless quality' }, { value: 'webp', label: 'WebP - Smaller file size' }]} onChange={setFormat} /><SelectField label="Image Size" value={size} options={[{ value: '10000', label: 'Original source size' }, { value: '2048', label: 'Large - Up to 2048 px' }, { value: '1200', label: 'Medium - Up to 1200 px' }, { value: '800', label: 'Small - Up to 800 px' }]} onChange={setSize} />{format !== 'png' && <RangeControl label="Quality" value={quality} min={10} max={100} suffix="%" onChange={setQuality} />}{!upscale2x && estimating && <p className="inspector-note" data-testid="export-size-estimate">Estimating file size…</p>}{!upscale2x && !estimating && estimate && <p className="inspector-note" data-testid="export-size-estimate">Estimated file size ≈ {formatByteSize(estimate.bytes)} ({estimate.width} × {estimate.height})</p>}{upscale2x && <p className="inspector-note" data-testid="export-size-estimate">File size estimate unavailable for 2x upscales.</p>}{!upscale2x && <ExportQualityPreview format={format} quality={quality} previewUrl={previewUrl} estimating={estimating} focus={focus} onFocus={setFocus} />}{superres && <div className="superres-field" data-testid="export-superres"><CheckField checked={upscale2x} disabled={exporting} onChange={(event) => setUpscale2x(event.target.checked)} label="Super-resolution 2x">Super-resolution 2x <MlBadge hint="Doubled by a machine-learning model on the photo server" /></CheckField>{upscale2x && <p className="inspector-note" data-testid="export-superres-hint">Doubles export dimensions — about {expectedLongEdge * SUPERRES_SCALE}px on the long edge. Large frames take a minute or two.</p>}{upscale2x && !engineNote && <p className="inspector-note">Checking the ML upscale…</p>}{upscale2x && engineNote && engineNote.tone !== 'error' && <p className="inspector-note">{engineNote.text}</p>}{upscale2x && engineNote && engineNote.tone === 'error' && <p className="form-error" role="alert">{engineNote.text}</p>}{upscaleProgress && <div className="ml-progress" role="status"><div className="ml-progress-bar"><span style={{ width: `${Math.round(upscaleProgress.fraction * 100)}%` }} /></div><p className="inspector-note">{upscaleProgress.stage}</p></div>}</div>}{overUpscaleCap && <p className="form-error" role="alert">2x upscales cap at {SUPERRES_MAX_INPUT_DIM}px input — pick Large or smaller.</p>}<p className="dialog-note"><Info size={14} /><span>Your original stays untouched. Sample photos export at their available web resolution.</span></p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="text-button export-settings" onClick={() => { downloadBlob(new Blob([JSON.stringify({ photo: photo.name, adjustments: edit, version: 1 }, null, 2)], { type: 'application/json' }), `${filename || 'photo'}-adjustments.json`); onToast('Adjustment settings downloaded.'); }}><Download size={13} />Settings</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button>{upscaleProgress && <button type="button" className="secondary-button" onClick={cancelUpscale}>Cancel upscale</button>}<button className="primary-button" type="submit" disabled={exporting || overUpscaleCap}>{exporting ? <span className="loading-spinner small" /> : <Share size={14} />}{exporting ? (upscale2x ? 'Upscaling...' : 'Exporting...') : 'Export Photo'}</button></div></form></Modal>;
}

function AlbumDialog({ onClose, onCreateAlbum }: Pick<EditorDialogsProps, 'onClose' | 'onCreateAlbum'>) {
  const [name, setName] = useState('');
  return <Modal title="New Album" subtitle="A home for the moments that belong together." onClose={onClose} className="small-modal"><div className="dialog-feature-icon"><FolderPlus size={30} strokeWidth={1.3} /></div><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onCreateAlbum(name.trim()); }}><label className="text-field"><span>Album Name</span><input autoFocus placeholder="e.g. A summer in Italy" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required /></label><div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim()} type="submit">Create Album</button></div></form></Modal>;
}

function PresetDialog({ onClose, onSavePreset }: Pick<EditorDialogsProps, 'onClose' | 'onSavePreset'>) {
  const [name, setName] = useState('');
  return <Modal title="Save Preset" subtitle="Your signature look, just a click away." onClose={onClose} className="small-modal"><div className="dialog-feature-icon"><Save size={28} strokeWidth={1.3} /></div><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSavePreset(name.trim()); }}><label className="text-field"><span>Preset Name</span><input autoFocus placeholder="e.g. Alpine Morning" value={name} maxLength={35} onChange={(event) => setName(event.target.value)} required /></label><p className="dialog-note">Your color adjustments will be saved in My Presets. Crops and retouching are not included.</p><div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim()} type="submit">Save Preset</button></div></form></Modal>;
}

const shortcuts = [
  ['Navigation', [['Photo browser', 'G'], ['Back to album', 'Esc'], ['Previous / next photo', 'Left / Right'], ['Search library', '/'], ['Photo information', 'I'], ['Remove from library', 'Del'], ['Focus mode', 'Shift F']]],
  ['Editing', [['Auto Enhance', 'A'], ['Scene Enhance (ML)', 'Shift A'], ['Enhance Faces (ML)', 'Shift E'], ['Color adjustments', 'V'], ['Crop & straighten', 'C'], ['Repair tool', 'J'], ['Rotate left', 'R'], ['Favorite photo', 'F']]],
  ['Preview', [['Compare before & after', 'B'], ['Hold to show original', '\\'], ['Zoom in / out', '+ / -'], ['Zoom to fit', '0']]],
  ['Your workflow', [['Undo', 'Ctrl / Cmd Z'], ['Redo', 'Ctrl / Cmd Shift Z or Ctrl / Cmd Y'], ['Import photos', 'Ctrl / Cmd O'], ['Export photo', 'Ctrl / Cmd Shift E'], ['Copy adjustments', 'Ctrl / Cmd Shift C'], ['Paste adjustments', 'Ctrl / Cmd Shift V']]],
] as const;

function RemoveDialog({ photo, onClose, onRemovePhoto }: Pick<EditorDialogsProps, 'photo' | 'onClose' | 'onRemovePhoto'>) {
  return <Modal title="Remove from Library" subtitle={photo.name} onClose={onClose} className="small-modal"><div className="dialog-feature-icon"><Trash2 size={28} strokeWidth={1.3} /></div><p className="dialog-note"><Info size={14} /><span>This removes the photo and its edits from your library. The original file on disk is never deleted — you can import it again any time.</span></p><div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Keep photo</button><button className="danger-button" type="button" onClick={() => onRemovePhoto(photo.id)}>Remove</button></div></Modal>;
}

function RemoveAlbumDialog({ removeAlbum, onClose, onRemoveAlbum }: Pick<EditorDialogsProps, 'removeAlbum' | 'onClose' | 'onRemoveAlbum'>) {
  if (!removeAlbum || !onRemoveAlbum) return null;
  const target = removeAlbum;
  const photos = target.count === 1 ? '1 photo' : `${target.count} photos`;
  return <Modal title="Delete Album" subtitle={target.name} onClose={onClose} className="small-modal"><div className="dialog-feature-icon"><Trash2 size={28} strokeWidth={1.3} /></div><p className="dialog-note"><Info size={14} /><span>This deletes the album only. {target.count ? `Its ${photos} stay${target.count === 1 ? 's' : ''} in your library under All Photos.` : 'It holds no photos.'} Nothing is removed from disk.</span></p><div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Keep album</button><button className="danger-button" type="button" onClick={() => onRemoveAlbum(target.id)}>Delete album</button></div></Modal>;
}

export function EditorDialogs(props: EditorDialogsProps) {
  const { dialog, photo, onClose } = props;
  if (!dialog) return null;
  if (dialog === 'remove') return <RemoveDialog {...props} />;
  if (dialog === 'remove-album') return <RemoveAlbumDialog {...props} />;
  if (dialog === 'export') return <ExportDialog {...props} />;
  if (dialog === 'album') return <AlbumDialog {...props} />;
  if (dialog === 'preset') return <PresetDialog {...props} />;
  if (dialog === 'info') return <Modal title="Photo Information" subtitle={photo.title} onClose={onClose} className="info-modal"><div className="info-filename"><h3>{photo.name}</h3><span className="file-type">{photo.raw ? 'RAW' : 'IMAGE'}</span></div><div className="photo-info-section"><h4><Camera size={14} />Camera</h4><strong>{photo.camera}</strong><p>{photo.lens}</p><div className="photo-info-grid"><div><small>ISO</small><span>{photo.iso || 'Not available'}</span></div><div><small>Aperture</small><span>{photo.aperture}</span></div><div><small>Shutter Speed</small><span>{photo.shutter}</span></div><div><small>Focal Length</small><span>{photo.focalLength}</span></div><div><small>Dimensions</small><span>{photo.width.toLocaleString()} x {photo.height.toLocaleString()}</span></div><div><small>Date Taken</small><span>{new Date(photo.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div></div></div><PhotoLabelsSection photo={photo} onAddLabel={props.onAddLabel} onRemoveLabel={props.onRemoveLabel} onSearchLabel={props.onSearchLabel} />{photo.location && <div className="photo-info-location"><MapPin size={15} />{photo.location}</div>}{photo.path && <div className="photo-info-location" data-tooltip={photo.path}><Folder size={15} /><span className="photo-info-path">{photo.path}</span></div>}{photo.missing && <p className="form-error" role="alert">The original file is missing. Reimport it from its new location to relink your edits.</p>}{photo.photographer && <p className="photo-credit">Photo by {photo.photographer} / Pexels<br /><span>Camera details are illustrative sample data.</span></p>}</Modal>;
  if (dialog === 'shortcuts') return <Modal title="A faster way to create." subtitle="Keep your hands on the keyboard, and your eyes on the photo." onClose={onClose} className="shortcuts-modal"><div className="shortcuts-symbol"><Keyboard size={27} strokeWidth={1.4} /></div><div className="shortcuts-grid">{shortcuts.map(([name, items]) => <section key={name}><h3>{name}</h3>{items.map(([label, key]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</section>)}</div></Modal>;
  return <Modal title={`About ${APP_NAME}`} onClose={onClose} className="about-modal"><div className="about-brand"><BrandMark size={64} /><h2>{APP_NAME}</h2><span>{APP_EDITION}</span><p>{APP_TAGLINE}</p></div><p className="about-copy">{APP_DESCRIPTION}</p><div className="extension-points"><h3>Built to be extended.</h3>{EXTENSION_POINTS.map((entry) => <p key={entry.path}><code>{entry.path}</code><span>{entry.label}</span></p>)}</div><p className="about-disclaimer">{ABOUT_DISCLAIMER}</p><button className="primary-button full-width" onClick={onClose}>Back to creating</button></Modal>;
}