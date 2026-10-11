import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bandage, ChevronDown, ChevronRight, Circle, CircleDashed, Contrast, Crop, FlipHorizontal2, FlipVertical2, Focus, MoreHorizontal, Palette, Plus, RotateCcw, RotateCw, SlidersHorizontal, Sparkles, Spline, Stamp, Sun, Thermometer, Trash2, X } from 'lucide-react';
import { CROP_RATIOS, STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD } from '@photomator/core';
import type { ChangeEdit, EditState, InpaintMethod, NumericAdjustment, Photo, Tool, VisionWorkerStatus } from '@photomator/core';
import type { HistogramData } from './PhotoCanvas.js';
import { IconButton, MenuItem, RangeControl, SelectField, Toggle } from './EditorUI.js';

interface AdjustmentSectionProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
  enabled?: boolean;
  onToggle?: () => void;
  onAuto?: () => void;
  onReset?: () => void;
}

function AdjustmentSection({ title, icon, children, initiallyOpen = true, enabled, onToggle, onAuto, onReset }: AdjustmentSectionProps) {
  const [open, setOpen] = useState(initiallyOpen);
  return <section className={`adjustment-section ${!open ? 'is-collapsed' : ''}`}><div className="adjustment-heading"><button className="section-disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="adjustment-section-icon">{icon}</span><h3>{title}</h3></button><div className="section-actions">{onAuto && open && <button className="auto-small" title={`Automatically adjust ${title.toLowerCase()}`} onClick={onAuto}>Auto</button>}{onReset && <IconButton className="section-reset" label={`Reset ${title.toLowerCase()}`} onClick={onReset}><RotateCcw size={11} /></IconButton>}{onToggle && <Toggle checked={Boolean(enabled)} onChange={onToggle} label={`Enable ${title.toLowerCase()}`} />}</div></div>{open && <div className="adjustment-content">{children}</div>}</section>;
}

function Histogram({ data, photo }: { data: HistogramData | null; photo: Photo }) {
  const [channel, setChannel] = useState('RGB');
  const defaultData: number[] = Array(64).fill(0);
  const channels = [
    { key: 'red' as const, color: '#df7a72', label: 'Red' },
    { key: 'green' as const, color: '#93b67b', label: 'Green' },
    { key: 'blue' as const, color: '#779db9', label: 'Blue' },
  ];
  const max = Math.max(1, ...channels.flatMap(({ key }) => data?.[key] || defaultData));
  const path = (values: number[]) => `M0,78 ${values.map((value, i) => `L${(i / 63 * 264).toFixed(1)},${(78 - Math.sqrt(value / max) * 71).toFixed(1)}`).join(' ')} L264,78Z`;
  return <section className="histogram-section" aria-label="Live photo histogram"><div className="histogram-heading"><span>Histogram</span><select aria-label="Histogram color channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option>RGB</option><option>Red</option><option>Green</option><option>Blue</option></select></div><div className="histogram-graph"><svg viewBox="0 0 264 83" preserveAspectRatio="none" role="img" aria-label={`${channel} color distribution`}><g className="histogram-grid">{[66, 132, 198].map((x) => <path key={x} d={`M${x} 3V78`} />)}{[26, 52, 78].map((y) => <path key={y} d={`M0 ${y}H264`} />)}</g>{channels.filter(({ label }) => channel === 'RGB' || label === channel).map(({ key, color }) => <path key={key} d={path(data?.[key] || defaultData)} fill={color} fillOpacity=".55" stroke={color} strokeWidth=".7" style={{ mixBlendMode: 'screen' }} />)}<path d="M1 8L5 1L9 8Z" fill="#818185" /><path d="M255 8L259 1L263 8Z" fill="#818185" /></svg><div className="histogram-axis"><span>0</span><span>64</span><span>128</span><span>192</span><span>255</span></div></div><div className="camera-settings"><span>ISO {photo.iso}</span><span>{photo.focalLength}</span><span>{photo.aperture}</span><span>{photo.shutter}</span></div></section>;
}

export type StraightenAssistState = 'idle' | 'loading' | 'detecting' | 'ready' | 'error';

/** View model for auto-straighten detection, driven by the app's vision hook. */
export interface StraightenAssist {
  state: StraightenAssistState;
  /** Suggested straighten value in degrees; set only when state is ready. */
  angle: number | null;
  /** Confidence 0..1; set only when state is ready. */
  confidence: number | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  onDetect: () => void;
  onDismiss: () => void;
}

function StraightenControl({ value, assist, onChange }: { value: number; assist: StraightenAssist; onChange: ChangeEdit }) {
  const working = assist.state === 'loading' || assist.state === 'detecting';
  const suggestion = assist.state === 'ready' && assist.angle !== null && assist.confidence !== null
    ? { angle: assist.angle, confidence: assist.confidence }
    : null;
  const formatAngle = (angle: number) => `${angle > 0 ? '+' : ''}${angle.toFixed(1)}°`;
  return <div className="straighten-assist">
    <RangeControl label="Straighten" value={value} min={-15} max={15} step={0.1} suffix="deg" signed onChange={(next) => { assist.onDismiss(); onChange({ straighten: next }, 'straighten'); }} />
    <div className="straighten-auto-row">
      <button className="secondary-button straighten-auto" disabled={working} title="Detect the horizon tilt automatically" onClick={assist.onDetect}>{working ? (assist.state === 'loading' ? 'Loading…' : 'Detecting…') : 'Auto'}</button>
      {working && <span className="straighten-status" role="status">{assist.state === 'loading' ? 'Loading vision engine…' : 'Detecting horizon tilt…'}</span>}
      {assist.state === 'error' && assist.message && <span className="straighten-status is-error" role="alert">{assist.message}</span>}
    </div>
    {suggestion && <div className="straighten-suggestion" role="status">
      <div className="suggestion-text"><span>Suggested <strong>{formatAngle(suggestion.angle)}</strong></span><span className="suggestion-confidence">{Math.round(suggestion.confidence * 100)}% confidence</span></div>
      {suggestion.confidence < STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD && <p className="inspector-note">Low confidence — no clear horizon found. You can still apply it or dismiss.</p>}
      <div className="suggestion-actions">
        <button className="primary-button" onClick={() => { onChange({ straighten: suggestion.angle }); assist.onDismiss(); }}>Apply</button>
        <button className="secondary-button" onClick={assist.onDismiss}>Dismiss</button>
      </div>
    </div>}
  </div>;
}

/** View model for repair inpainting, driven by the app's vision hook. */
export interface RepairAssist {
  method: InpaintMethod;
  status: VisionWorkerStatus;
  onMethodChange: (method: InpaintMethod) => void;
}

function RepairMethodControl({ assist }: { assist: RepairAssist }) {
  return <>
    <h4>Reconstruction</h4>
    <div className="segmented-control" role="group" aria-label="Repair reconstruction method">
      <button className={assist.method === 'heal' ? 'is-active' : ''} title="Heal: transplant matching texture from nearby, adapted to local light" onClick={() => assist.onMethodChange('heal')}>Heal</button>
      <button className={assist.method === 'telea' ? 'is-active' : ''} title="Telea's fast marching method: quick and smooth" onClick={() => assist.onMethodChange('telea')}>Telea</button>
      <button className={assist.method === 'ns' ? 'is-active' : ''} title="Navier-Stokes fluid dynamics: slower, sometimes crisper" onClick={() => assist.onMethodChange('ns')}>Navier–Stokes</button>
    </div>
    {assist.status === 'loading' && <p className="inspector-note" role="status">Loading enhanced repair…</p>}
    {assist.status === 'failed' && <p className="inspector-note" role="alert">Enhanced repair is unavailable — using soft retouch instead.</p>}
  </>;
}

interface InspectorProps {
  photo: Photo;
  edit: EditState;
  tool: Tool;
  histogram: HistogramData | null;
  brushSize: number;
  brushStrength: number;
  canPaste: boolean;
  straightenAssist?: StraightenAssist;
  repairAssist?: RepairAssist;
  onChange: ChangeEdit;
  onTool: (tool: Tool) => void;
  onReset: () => void;
  onAuto: () => void;
  onAutoWhiteBalance: () => void;
  onAutoLightness: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSavePreset: () => void;
  onBrushSize: (value: number) => void;
  onBrushStrength: (value: number) => void;
  onApplyCrop: () => void;
  onClose: () => void;
}

export function Inspector({ photo, edit, tool, histogram, brushSize, brushStrength, canPaste, straightenAssist, repairAssist, onChange, onTool, onReset, onAuto, onAutoWhiteBalance, onAutoLightness, onCopy, onPaste, onSavePreset, onBrushSize, onBrushStrength, onApplyCrop, onClose }: InspectorProps) {
  const [menu, setMenu] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [extraSections, setExtraSections] = useState<string[]>([]);
  const [openedExtra, setOpenedExtra] = useState('');
  const [extraRevision, setExtraRevision] = useState(0);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest('.inspector-menu-anchor')) setMenu(false);
      if (!target.closest('.inspector-footer')) setAddMenu(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); setAddMenu(false); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, []);

  const range = (key: NumericAdjustment, label: string, options: Partial<React.ComponentProps<typeof RangeControl>> = {}) => <RangeControl key={key} label={label} value={edit[key]} signed onChange={(value) => onChange({ [key]: value }, key)} {...options} />;
  const title = tool === 'crop' ? 'Crop & Straighten' : tool === 'repair' ? 'Repair' : tool === 'clone' ? 'Clone' : 'Color Adjustments';
  const TitleIcon = tool === 'crop' ? Crop : tool === 'repair' ? Bandage : tool === 'clone' ? Stamp : SlidersHorizontal;
  const closeAction = (callback: () => void) => { callback(); setMenu(false); };
  const addSection = (name: string) => {
    setExtraSections((current) => current.includes(name) ? current : [...current, name]);
    setOpenedExtra(name);
    setExtraRevision((value) => value + 1);
    setAddMenu(false);
    if (name === 'Black & White') onChange({ blackAndWhite: true });
    window.setTimeout(() => ref.current?.querySelector('.inspector-scroll')?.scrollTo({ top: 2000, behavior: 'smooth' }), 50);
  };

  return <aside className="adjustments-sidebar" ref={ref} aria-label="Editing inspector">
    <div className="inspector-title">
      <TitleIcon size={15} strokeWidth={1.7} /><h2>{title}</h2>
      <div className="inspector-menu-anchor">
        <IconButton label="Adjustment options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></IconButton>
        {menu && <div className="dropdown-menu inspector-options" role="menu">
          <MenuItem onClick={() => closeAction(onCopy)} shortcut="Ctrl Shift C">Copy Adjustments</MenuItem>
          <MenuItem onClick={() => closeAction(onPaste)} disabled={!canPaste} shortcut="Ctrl Shift V">Paste Adjustments</MenuItem>
          <MenuItem onClick={() => closeAction(onSavePreset)}>Save as Preset...</MenuItem>
          <div className="menu-separator" />
          <MenuItem onClick={() => closeAction(onReset)}>Reset All Adjustments</MenuItem>
        </div>}
      </div>
      <IconButton label="Hide editing inspector" className="inspector-close" onClick={onClose}><X size={15} /></IconButton>
    </div>
    <div className="inspector-scroll">{tool === 'adjust' ? <><div className="auto-enhance-row"><button onClick={onAuto}><Sparkles size={17} /><span>Auto Enhance</span></button><Toggle checked={edit.autoEnhanced} label="Auto Enhance" onChange={onAuto} /></div><Histogram data={histogram} photo={photo} />
      <AdjustmentSection title="White Balance" icon={<Thermometer size={14} />} enabled={edit.whiteBalanceEnabled} onToggle={() => onChange({ whiteBalanceEnabled: !edit.whiteBalanceEnabled })} onAuto={onAutoWhiteBalance} onReset={() => onChange({ temperature: 5500, tint: 0 })}>
        {range('temperature', 'Temperature', { min: 2000, max: 10000, step: 50, defaultValue: 5500, suffix: 'K', color: 'temperature', signed: false, disabled: !edit.whiteBalanceEnabled })}
        {range('tint', 'Tint', { color: 'tint', disabled: !edit.whiteBalanceEnabled })}
      </AdjustmentSection>
      <AdjustmentSection title="Lightness" icon={<Sun size={15} />} enabled={edit.lightnessEnabled} onToggle={() => onChange({ lightnessEnabled: !edit.lightnessEnabled })} onAuto={onAutoLightness} onReset={() => onChange({ exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, blacks: 0 })}>
        {range('exposure', 'Exposure', { min: -3, max: 3, step: 0.01, disabled: !edit.lightnessEnabled })}
        {range('brightness', 'Brightness', { disabled: !edit.lightnessEnabled })}
        {range('contrast', 'Contrast', { disabled: !edit.lightnessEnabled })}
        {range('highlights', 'Highlights', { disabled: !edit.lightnessEnabled })}
        {range('shadows', 'Shadows', { disabled: !edit.lightnessEnabled })}
        {range('blacks', 'Black Point', { disabled: !edit.lightnessEnabled })}
      </AdjustmentSection>
      <AdjustmentSection title="Hue & Saturation" icon={<Palette size={14} />} enabled={edit.colorEnabled} onToggle={() => onChange({ colorEnabled: !edit.colorEnabled })} onReset={() => onChange({ hue: 0, saturation: 0, vibrance: 0 })}>
        {range('saturation', 'Saturation', { disabled: !edit.colorEnabled })}
        {range('vibrance', 'Vibrance', { disabled: !edit.colorEnabled })}
        {range('hue', 'Hue', { min: -180, max: 180, color: 'hue', disabled: !edit.colorEnabled })}
      </AdjustmentSection>
      <AdjustmentSection key={`curves-${openedExtra === 'Curves' ? extraRevision : 0}`} title="Curves" icon={<Spline size={14} />} initiallyOpen={openedExtra === 'Curves'} onReset={() => onChange({ curve: 0 })}>
        <div className="curve-graph"><span>RGB</span><svg viewBox="0 0 240 160" aria-label="Interactive tone curve" role="slider" tabIndex={0} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={edit.curve} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); onChange({ curve: Math.max(-100, Math.min(100, (0.5 - (event.clientY - rect.top) / rect.height) * 200)) }, 'curve'); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.getBoundingClientRect(); onChange({ curve: Math.max(-100, Math.min(100, (0.5 - (event.clientY - rect.top) / rect.height) * 200)) }, 'curve'); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onChange({ curve: Math.max(-100, Math.min(100, edit.curve + (event.key === 'ArrowUp' ? 5 : -5))) }, 'curve'); } }}><g className="curve-grid">{[60, 120, 180].map((x) => <path key={x} d={`M${x} 0V160`} />)}{[40, 80, 120].map((y) => <path key={y} d={`M0 ${y}H240`} />)}</g><path d="M0 160L240 0" stroke="#555" strokeDasharray="3 4" /><path d={`M0 160Q120 ${80 - edit.curve * 0.8} 240 0`} fill="none" stroke="#e4c67d" strokeWidth="2" /><circle cx="120" cy={80 - edit.curve * 0.4} r="4" fill="#f3d492" /></svg></div>{range('curve', 'Midtones')}
      </AdjustmentSection>
      <AdjustmentSection key={`details-${openedExtra === 'Details' ? extraRevision : 0}`} title="Details" icon={<Focus size={14} />} initiallyOpen={openedExtra === 'Details'} enabled={edit.detailsEnabled} onToggle={() => onChange({ detailsEnabled: !edit.detailsEnabled })}>
        {range('clarity', 'Clarity', { disabled: !edit.detailsEnabled })}{range('sharpness', 'Sharpness', { min: 0, disabled: !edit.detailsEnabled })}{range('grain', 'Grain', { min: 0, disabled: !edit.detailsEnabled })}
      </AdjustmentSection>
      <AdjustmentSection key={`effects-${openedExtra === 'Effects' ? extraRevision : 0}`} title="Effects" icon={<CircleDashed size={14} />} initiallyOpen={openedExtra === 'Effects'} onReset={() => onChange({ vignette: 0, fade: 0 })}>
        {range('vignette', 'Vignette', { min: 0 })}{range('fade', 'Fade', { min: 0 })}
      </AdjustmentSection>
      {extraSections.includes('Black & White') && <AdjustmentSection title="Black & White" icon={<Contrast size={14} />} enabled={edit.blackAndWhite} onToggle={() => onChange({ blackAndWhite: !edit.blackAndWhite })}><p className="inspector-note">A timeless look, without the distraction of color.</p><button className="secondary-button full-width" onClick={() => onChange({ blackAndWhite: !edit.blackAndWhite })}>{edit.blackAndWhite ? 'Restore Color' : 'Make Black & White'}</button></AdjustmentSection>}
      <div className="inspector-end-note"><Circle size={10} />Every change. Always reversible.</div>
    </> : tool === 'crop' ? <div className="tool-inspector crop-inspector"><div className="tool-intro"><Crop size={28} strokeWidth={1.3} /><h3>A fresh point of view.</h3><p>Find the right balance. Keep the best bits.</p></div><SelectField label="Aspect Ratio" value={edit.cropRatio} options={Object.keys(CROP_RATIOS).map((ratio) => ({ value: ratio, label: ratio === 'Original' ? 'Original proportions' : ratio }))} onChange={(cropRatio) => onChange({ cropRatio })} /><div className="ratio-presets">{['Original', '1:1', '4:3', '16:9'].map((ratio) => <button key={ratio} className={edit.cropRatio === ratio ? 'is-active' : ''} onClick={() => onChange({ cropRatio: ratio })}><span style={{ aspectRatio: CROP_RATIOS[ratio] || 1.5 }} />{ratio}</button>)}</div><div className="tool-divider" /><h4>Rotate & Flip</h4><div className="transform-buttons"><button title="Rotate left 90 degrees" onClick={() => onChange({ rotation: (edit.rotation - 90) % 360 })}><RotateCcw size={18} /><span>Left</span></button><button title="Rotate right 90 degrees" onClick={() => onChange({ rotation: (edit.rotation + 90) % 360 })}><RotateCw size={18} /><span>Right</span></button><button className={edit.flipH ? 'is-active' : ''} title="Flip horizontally" onClick={() => onChange({ flipH: !edit.flipH })}><FlipHorizontal2 size={18} /><span>Horizontal</span></button><button className={edit.flipV ? 'is-active' : ''} title="Flip vertically" onClick={() => onChange({ flipV: !edit.flipV })}><FlipVertical2 size={18} /><span>Vertical</span></button></div>{straightenAssist ? <StraightenControl value={edit.straighten} assist={straightenAssist} onChange={onChange} /> : range('straighten', 'Straighten', { min: -15, max: 15, step: 0.1, suffix: 'deg' })}<button className="secondary-button full-width reset-crop" onClick={() => onChange({ cropRatio: 'Original', rotation: 0, flipH: false, flipV: false, straighten: 0 })}><RotateCcw size={13} />Reset Composition</button><p className="inspector-note">Cropping is non-destructive. Your original photo is always kept safe.</p></div> : <div className="tool-inspector"><div className="tool-intro">{tool === 'repair' ? <Bandage size={30} strokeWidth={1.3} /> : <Stamp size={30} strokeWidth={1.3} />}<h3>{tool === 'repair' ? 'Less distraction. More photo.' : 'A little creative borrowing.'}</h3><p>{tool === 'repair' ? repairAssist ? 'Rebuild small distractions from the surrounding photo.' : 'Gently blend small distractions with a soft retouching brush.' : 'Sample one area of your photo and paint it onto another.'}</p></div><div className="segmented-control"><button className={tool === 'repair' ? 'is-active' : ''} onClick={() => onTool('repair')}>Repair</button><button className={tool === 'clone' ? 'is-active' : ''} onClick={() => onTool('clone')}>Clone</button></div><RangeControl label="Brush Size" value={brushSize} min={5} max={160} suffix="px" onChange={onBrushSize} /><RangeControl label="Strength" value={brushStrength} min={1} max={100} suffix="%" onChange={onBrushStrength} />{tool === 'repair' && repairAssist && <RepairMethodControl assist={repairAssist} />}<div className="brush-preview"><span style={{ width: Math.min(brushSize, 90), height: Math.min(brushSize, 90), opacity: brushStrength / 100 }} /><small>Brush preview</small></div><p className="inspector-note">{tool === 'clone' ? 'Hold Alt and click to choose a source. Then click and drag to paint. Use Undo to step back.' : repairAssist ? 'Click and drag over small distractions to rebuild them from surrounding detail. Computed in your browser — not AI object removal.' : 'Click and drag over the photo to apply a local blur. This demo uses browser-based retouching, not AI object removal.'}</p><div className="retouch-status"><span>{edit.retouches.length} brush stamps</span><IconButton label="Clear all retouching" disabled={!edit.retouches.length} onClick={() => onChange({ retouches: [] })}><Trash2 size={14} /></IconButton></div></div>}</div>
    <div className="inspector-footer">{tool === 'adjust' ? <><button className="add-adjustment" onClick={() => setAddMenu(!addMenu)} aria-expanded={addMenu}><Plus size={15} />Add Adjustment<ChevronDown size={12} /></button>{addMenu && <div className="dropdown-menu add-adjustment-menu" role="menu">{['Black & White'].filter((name) => !extraSections.includes(name)).map((name) => <MenuItem key={name} onClick={() => addSection(name)}>{name}</MenuItem>)}{!extraSections.includes('Black & White') && <div className="menu-separator" />}<MenuItem onClick={() => { onSavePreset(); setAddMenu(false); }}>Save as Preset...</MenuItem></div>}</> : <button className="primary-button full-width" onClick={tool === 'crop' ? onApplyCrop : () => onTool('adjust')}>Done</button>}</div>
  </aside>;
}