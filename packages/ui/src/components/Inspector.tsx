import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bandage, Brush, ChevronDown, ChevronRight, Circle, CircleDashed, Contrast, Crop, Eraser, FlipHorizontal2, FlipVertical2, Focus, Layers, MoreHorizontal, Palette, Plus, RotateCcw, RotateCw, SlidersHorizontal, Sparkles, Spline, Sun, Thermometer, Trash2, X } from 'lucide-react';
import { CROP_RATIOS, SCENE_DISPLAY_NAMES, SELECTIVE_MASK_DEFAULT_EXPOSURE, STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD, denoiseStrengthForIso, groupRetouchStrokes, shouldAutoDenoise, strokeIdForPoint } from '@f8/core';
import type { ChangeEdit, DenoiseSource, DenoiseState, DetectedObject, DustSpot, DustSpotsSource, EditState, FaceDetectSource, HealQuality, InpaintMethod, NumericAdjustment, ObjectDetectSource, Photo, SelectiveAdjustState, SelectiveMaskSource, SelectiveTarget, Tool, VisionWorkerStatus } from '@f8/core';
import type { HistogramData } from './PhotoCanvas.js';
import { IconButton, MenuItem, RangeControl, SelectField, Toggle } from './EditorUI.js';

interface AdjustmentSectionProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
  enabled?: boolean;
  /** Small heading adornment after the title, e.g. an ML badge. */
  badge?: ReactNode;
  onToggle?: () => void;
  onAuto?: () => void;
  onReset?: () => void;
}

function AdjustmentSection({ title, icon, children, initiallyOpen = true, enabled, badge, onToggle, onAuto, onReset }: AdjustmentSectionProps) {
  const [open, setOpen] = useState(initiallyOpen);
  return <section className={`adjustment-section ${!open ? 'is-collapsed' : ''}`}><div className="adjustment-heading"><button className="section-disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="adjustment-section-icon">{icon}</span><h3>{title}</h3>{badge}</button><div className="section-actions">{onAuto && open && <button className="auto-small" title={`Automatically adjust ${title.toLowerCase()}`} onClick={onAuto}>Auto</button>}{onReset && <IconButton className="section-reset" label={`Reset ${title.toLowerCase()}`} onClick={onReset}><RotateCcw size={11} /></IconButton>}{onToggle && <Toggle checked={Boolean(enabled)} onChange={onToggle} label={`Enable ${title.toLowerCase()}`} />}</div></div>{open && <div className="adjustment-content">{children}</div>}</section>;
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
  /** "ml" when the suggestion was refined on the photo server. */
  source?: "classic" | "ml" | null;
  /** Per-run id, bumped on every Auto click; 0 when idle. */
  runId?: number;
  /** Live server fallback progress; same shape as ML-heal progress. */
  mlProgress?: { fraction: number; stage: string; updatedAt?: number } | null;
  /** True while the server fallback is warming/estimating. */
  mlWarming?: boolean;
  /** Note when the server run failed or was cancelled but classic is kept. */
  mlNote?: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  onDetect: () => void;
  onDismiss: () => void;
  onCancelMl?: () => void;
}

/** View model for repair inpainting, driven by the app's vision hook. */
export interface RepairAssist {
  method: InpaintMethod;
  quality: HealQuality;
  seamlessLight: boolean;
  featherPx: number;
  status: VisionWorkerStatus;
  /** Latest ML progress (warmup or job); null when nothing ran yet. */
  mlProgress: { fraction: number; stage: string; job?: 'heal' | 'warmup'; areas?: number | null; updatedAt?: number } | null;
  /** True when the last ML attempt found the photo server down. */
  serverDown: boolean;
  /** Abort a hung heal/warmup and restart the worker. */
  onCancelHeal?: () => void;
  /** Re-run the tier warmup after the server comes back. */
  onRetry: () => void;
  onMethodChange: (method: InpaintMethod) => void;
  onQualityChange: (quality: HealQuality) => void;
  onSeamlessLightChange: (value: boolean) => void;
  onFeatherChange: (value: number) => void;
  /** One-click ML removal; absent when the app does not offer it. */
  removal?: ObjectRemovalAssist;
  /** Auto ML dust-spot detection; absent when the app does not offer it. */
  dustSpots?: DustSpotsAssist;
}

/** View model for ML one-click object removal, driven by the app's vision hook. */
export interface ObjectRemovalAssist {
  state: 'idle' | 'detecting' | 'ready' | 'error';
  /** Detections with confirm flags; set when state is ready. */
  detections: Array<DetectedObject & { checked: boolean }>;
  /** "onnx" when YOLO served, "classic" for the skin-tone fallback. */
  source: ObjectDetectSource | null;
  /** Live server progress (warmup + detect); same shape as ML-heal progress. */
  progress: { fraction: number; stage: string; updatedAt?: number } | null;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  /** List index hovered for canvas preview; null when none. */
  highlighted?: number | null;
  onDetect: () => void;
  onToggle: (index: number) => void;
  /** Hover a list row (null on leave) so the canvas previews it in red. */
  onHighlight?: (index: number | null) => void;
  /** Apply checked detections as repair strokes (one undo step). */
  onApply: () => void;
  onDismiss: () => void;
}

/** View model for ML auto dust/spot detection, driven by the app's vision hook. */
export interface DustSpotsAssist {
  state: 'idle' | 'detecting' | 'ready' | 'error';
  /** Spots with accept flags; set when state is ready. */
  spots: Array<DustSpot & { checked: boolean }>;
  /** "ml" when the classifier filtered, "classic" for the unfiltered scan. */
  source: DustSpotsSource | null;
  /** Live server progress (warmup + scan); same shape as ML-heal progress. */
  progress: { fraction: number; stage: string; updatedAt?: number } | null;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  /** List index hovered for canvas preview; null when none. */
  highlighted?: number | null;
  onDetect: () => void;
  onToggle: (index: number) => void;
  /** Hover a list row (null on leave) so the canvas previews it in red. */
  onHighlight?: (index: number | null) => void;
  /** Apply checked spots as repair strokes (one undo step). */
  onApply: () => void;
  onDismiss: () => void;
}

/** View model for ML face-aware exposure, driven by the app's vision hook. */
export interface FaceEnhanceAssist {
  state: 'idle' | 'detecting' | 'ready' | 'error';
  /** Detected faces; set when state is ready. */
  faces: number;
  /** "onnx" when YuNet served, "classic" for the skin-tone fallback. */
  source: FaceDetectSource | null;
  /** WB the apply would set (skin-anchored when skinAnchored, else whole-image). */
  whiteBalance: { temperature: number; tint: number } | null;
  /** True when the WB anchors on face skin tones (vs the classic fallback). */
  skinAnchored: boolean;
  /** Masked lift in EV the apply would set (0 when faces need none). */
  liftAmount: number;
  /** Red-eye discs the apply would set. */
  redEyeCount: number;
  /** Live server progress (warmup + detect); same shape as ML-heal progress. */
  progress: { fraction: number; stage: string; updatedAt?: number } | null;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  /** Stored face adjust from the recipe; shown with Clear while idle. */
  applied: { faces: number; source: FaceDetectSource } | null;
  onDetect: () => void;
  /** Apply WB + masked lift + red-eye fixes as one undo step. */
  onApply: () => void;
  /** Remove the stored masked lift + red-eye discs (WB sliders stay). */
  onClear: () => void;
  onDismiss: () => void;
}

/** Masked exposure/contrast/saturation over the subject or background (pre-apply draft or live patch). */
export interface SelectiveMaskDraft {
  target: SelectiveTarget;
  exposure: number;
  contrast: number;
  saturation: number;
}

/** View model for ML selective (masked) adjustments, driven by the app's vision hook. */
export interface SelectiveMaskAssist {
  state: 'idle' | 'detecting' | 'ready' | 'error';
  /** True when the ready result holds a usable subject mask. */
  found: boolean;
  /** Subject fraction 0..1; set when state is ready. */
  coverage: number;
  /** "onnx" when u2netp served, "classic" for the fallback proposer. */
  source: SelectiveMaskSource | null;
  /** Live server progress (warmup + segment); same shape as ML-heal progress. */
  progress: { fraction: number; stage: string; updatedAt?: number } | null;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  /** Stored selective adjust from the recipe; shown with live sliders while idle. */
  applied: SelectiveAdjustState | null;
  onDetect: () => void;
  /** Store the mask with the draft target/params as one undo step. */
  onApply: (draft: SelectiveMaskDraft) => void;
  /** Live-tweak the stored target/params (each drag coalesces to one undo step). */
  onAdjust: (patch: Partial<SelectiveMaskDraft>) => void;
  /** Remove the stored mask + params. */
  onClear: () => void;
  onDismiss: () => void;
}

/** View model for lightweight denoise, driven by the app's vision hook. */
export interface DenoiseAssist {
  state: 'idle' | 'previewing' | 'preview-ready' | 'applying' | 'applied' | 'error';
  /** Downsampled before/after pair; set when state is preview-ready. */
  preview: { beforeUrl: string; afterUrl: string; strength: number; source: DenoiseSource } | null;
  /** Stored denoise state from the recipe; null when never applied. */
  applied: DenoiseState | null;
  /** True when the denoised full-res base lives in this session. */
  hasBase: boolean;
  /** Live server progress (warmup + denoise); same shape as ML-heal progress. */
  progress: { fraction: number; stage: string; updatedAt?: number } | null;
  /** Note when the classical fallback served instead of ML. */
  note: string | null;
  /** Human-readable error; set only when state is error. */
  message: string | null;
  /** Preview a strength on the ≤512px downsample (before/after, recipe untouched). */
  onPreview: (strength: number, auto: boolean) => void;
  /** Denoise at up to 2048px and use it as the canvas/export base. */
  onApply: (strength: number, auto: boolean) => void;
  /** Remove the stored strength and drop the denoised base. */
  onClear: () => void;
  onDismiss: () => void;
}

/** Success stages auto-dismiss; errors never do. */
const ML_SUCCESS_DISMISS_MS = 4000;

function isMlErrorStage(stage: string): boolean {
  return stage.startsWith('Model unavailable');
}

function isMlDoneStage(stage: string, fraction: number): boolean {
  return fraction >= 1 || stage === 'Repair done' || stage.endsWith('ready on this device');
}

function isMlDownloadStage(stage: string): boolean {
  return stage.startsWith('Downloading');
}

function isMlSteppedStage(stage: string): boolean {
  return /^Repairing \d+ of \d+/.test(stage);
}

function MlProgressView({ progress, onCancel }: { progress: { fraction: number; stage: string; job?: string; areas?: number | null; updatedAt?: number }; onCancel?: () => void }) {
  const isError = isMlErrorStage(progress.stage);
  const isDone = isMlDoneStage(progress.stage, progress.fraction);
  const [, setTick] = useState(0);
  const updatedAt = progress.updatedAt ?? 0;
  // Tick while active so the elapsed-seconds suffix and success
  // auto-dismiss stay live without new worker messages (LaMa inference has
  // no per-step posts).
  useEffect(() => {
    if (isError || (isDone && Date.now() - updatedAt > ML_SUCCESS_DISMISS_MS)) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [isError, isDone, updatedAt, progress.stage, progress.fraction]);
  if (!isError && isDone && Date.now() - updatedAt > ML_SUCCESS_DISMISS_MS) return null;
  const showPercent = isMlDownloadStage(progress.stage) || isMlSteppedStage(progress.stage);
  const pct = Math.round(progress.fraction * 100);
  const elapsed = updatedAt ? Math.max(0, (Date.now() - updatedAt) / 1000) : 0;
  const stalled = !isError && !isDone && elapsed > 2;
  const areas = progress.areas ?? null;
  const areaNote = progress.job === 'heal' && areas !== null && areas > 1 && !isError
    ? `${areas} areas · one pass`
    : null;
  const headline = showPercent
    ? `${progress.stage} · ${pct}%`
    : stalled
      ? `${progress.stage} ${Math.floor(elapsed)}s`
      : progress.stage;
  return <div className={`ml-progress${isError ? ' is-error' : ''}${!showPercent && !isError && !isDone ? ' is-busy' : ''}`} data-testid="ml-progress" role={isError ? 'alert' : 'status'} aria-live="polite">
    {!isDone && <div className={`ml-progress-bar${!showPercent && !isError ? ' is-indeterminate' : ''}`}>{showPercent || isError ? <span style={{ width: `${pct}%` }} /> : <span className="ml-progress-pulse" />}</div>}
    <p className="inspector-note" data-testid="ml-progress-stage">{headline}</p>
    {areaNote && <p className="inspector-note ml-area-note" data-testid="ml-area-note">{areaNote}</p>}
    {!isError && !isDone && onCancel && <button className="text-button" data-testid="ml-cancel" title="Stop this repair and restart the worker" onClick={onCancel}>Cancel repair</button>}
  </div>;
}

function StraightenControl({ value, assist, onStraighten, onDraggingChange }: { value: number; assist: StraightenAssist; onStraighten: (next: number, mergeKey?: string) => void; onDraggingChange?: (dragging: boolean) => void }) {
  const working = assist.state === 'loading' || assist.state === 'detecting';
  const mlActive = Boolean(working && assist.mlProgress);
  // Pre-Auto slider value for one-click Revert. Captured in the Auto click
  // handler (the vision hook never sees the edit); cleared whenever the
  // assist returns to idle (dismiss, manual edit, photo switch).
  const [snapshot, setSnapshot] = useState<number | null>(null);
  // Applied key `${runId}:${angle}`: classic auto-applies on arrival, the
  // server fallback overwrites with the same runId but a new angle, and
  // StrictMode double-effects never double-apply.
  const appliedKey = useRef('');
  useEffect(() => {
    if (assist.state === 'idle') { setSnapshot(null); appliedKey.current = ''; }
  }, [assist.state]);
  const runId = assist.runId ?? 0;
  const readyAngle = assist.state === 'ready' ? assist.angle : null;
  useEffect(() => {
    if (assist.state === 'ready' && readyAngle !== null && runId !== 0) {
      const key = `${runId}:${readyAngle}`;
      if (appliedKey.current !== key) {
        appliedKey.current = key;
        // Discrete step: Auto must stay independently undoable and never
        // coalesce with adjacent manual slider drags sharing 'straighten'.
        onStraighten(readyAngle);
      }
    }
  }, [assist.state, readyAngle, runId, onStraighten]);
  const suggestion = assist.state === 'ready' && assist.angle !== null && assist.confidence !== null
    ? { angle: assist.angle, confidence: assist.confidence }
    : null;
  const formatAngle = (angle: number) => `${angle > 0 ? '+' : ''}${angle.toFixed(1)}°`;
  return <div className="straighten-assist">
    <RangeControl label="Straighten" value={value} min={-15} max={15} step={0.1} suffix="deg" signed valueHint="Click to type an exact value in degrees" onDraggingChange={onDraggingChange} onChange={(next) => { assist.onDismiss(); onStraighten(next, 'straighten'); }} />
    <div className="straighten-auto-row">
      <button className="auto-small straighten-auto" disabled={working} title="Detect the horizon tilt automatically and apply it" onClick={() => { setSnapshot(value); assist.onDetect(); }}>{working ? (assist.state === 'loading' ? 'Loading…' : mlActive ? 'Estimating…' : 'Detecting…') : 'Auto'}</button>
      {working && !mlActive && <span className="straighten-status" role="status">{assist.state === 'loading' ? 'Loading vision engine…' : 'Detecting horizon tilt…'}</span>}
      {assist.state === 'error' && assist.message && <span className="straighten-status is-error" role="alert">{assist.message}</span>}
    </div>
    {mlActive && assist.mlProgress && <MlProgressView progress={assist.mlProgress} onCancel={assist.mlWarming && assist.onCancelMl ? assist.onCancelMl : undefined} />}
    {suggestion && <div className="straighten-suggestion" role="status">
      <div className="suggestion-text"><span>Applied <strong>{formatAngle(suggestion.angle)}</strong></span><span className="suggestion-confidence">{Math.round(suggestion.confidence * 100)}% confidence{assist.source === 'ml' ? ' · ML' : ''}</span></div>
      {suggestion.confidence < STRAIGHTEN_LOW_CONFIDENCE_THRESHOLD && <p className="inspector-note">Low confidence — no clear horizon found. Adjust the slider or revert below.</p>}
      {assist.mlNote && <p className="inspector-note">{assist.mlNote}</p>}
      <div className="suggestion-actions">
        {snapshot !== null && <button className="secondary-button" title={`Restore straighten to ${formatAngle(snapshot)}`} onClick={() => { onStraighten(snapshot); assist.onDismiss(); }}>Revert</button>}
        <button className="secondary-button" onClick={assist.onDismiss}>Dismiss</button>
      </div>
    </div>}
  </div>;
}

function RepairMethodControl({ assist }: { assist: RepairAssist }) {
  const methodBlurb = assist.method === 'ml-heal'
    ? 'Neural fill on the photo server.'
    : assist.method === 'heal'
    ? 'Copies matching texture from nearby.'
    : assist.method === 'telea'
      ? 'Fast fill for tiny smooth blemishes.'
      : 'Slower fill that follows edges.';
  const progress = assist.method === 'ml-heal' ? assist.mlProgress : null;
  // Server down hides the ML tier UI entirely: neither quality can run, so a
  // single offline line plus retry replaces quality, progress, and fallbacks.
  // Recovery is explicit — pick another method above, or retry once the
  // server is back. Painting stays gated until the tier warms.
  const offline = assist.method === 'ml-heal' && assist.serverDown;
  return <>
    <div className="segmented-control" role="group" aria-label="Repair reconstruction method" data-testid="repair-method-group">
      <button data-testid="repair-method-ml-heal" className={assist.method === 'ml-heal' ? 'is-active' : ''} title="ML Repair: neural fill on the photo server" onClick={() => assist.onMethodChange('ml-heal')}>ML Repair</button>
      <button data-testid="repair-method-heal" className={assist.method === 'heal' ? 'is-active' : ''} title="Repair: copies matching texture from nearby" onClick={() => assist.onMethodChange('heal')}>Repair</button>
      <button data-testid="repair-method-telea" className={assist.method === 'telea' ? 'is-active' : ''} title="Smooth fill: fast, for tiny blemishes" onClick={() => assist.onMethodChange('telea')}>Smooth</button>
      <button data-testid="repair-method-ns" className={assist.method === 'ns' ? 'is-active' : ''} title="Detail fill: slower, follows edges" onClick={() => assist.onMethodChange('ns')}>Detail</button>
    </div>
    <p className="inspector-note repair-method-blurb">{methodBlurb}</p>
    {(assist.method === 'heal' || assist.method === 'ml-heal') && <>
      {!offline && <>
        <h4>Repair Quality</h4>
        <div className="segmented-control" role="group" aria-label="Repair search effort" data-testid="heal-quality-group">
          {assist.method !== 'ml-heal' && <button data-testid="heal-quality-fast" className={assist.quality === 'fast' ? 'is-active' : ''} title="Fast: nearby donors only, best for small blemishes" onClick={() => assist.onQualityChange('fast')}>Fast</button>}
          <button data-testid="heal-quality-balanced" className={assist.quality === 'balanced' ? 'is-active' : ''} title={assist.method === 'ml-heal' ? 'Balanced: neural fill' : 'Balanced: the default search reach and effort'} onClick={() => assist.onQualityChange('balanced')}>Balanced</button>
          <button data-testid="heal-quality-best" className={assist.quality === 'best' ? 'is-active' : ''} title={assist.method === 'ml-heal' ? 'Best: diffusion inpainting, slowest' : 'Best: widest search, slowest — for tricky removals'} onClick={() => assist.onQualityChange('best')}>Best</button>
        </div>
      </>}
      {offline
        ? <div className="ml-offline" data-testid="ml-offline" role="alert"><p>Photo server offline.</p><button className="text-button" data-testid="ml-retry" title="Warm the ML tier again" onClick={assist.onRetry}>Retry</button></div>
        : progress && <MlProgressView progress={progress} onCancel={assist.onCancelHeal} />}
      {assist.method === 'heal' && <>
      <div className="repair-toggle-row" data-testid="seamless-light-row"><span>Seamless light</span><Toggle checked={assist.seamlessLight} onChange={() => assist.onSeamlessLightChange(!assist.seamlessLight)} label="Seamless light adaptation" /></div>
      <p className="inspector-note">Adapts repairs to lighting gradients.</p>
      </>}
    </>}
    <RangeControl label="Blend Feather" value={assist.featherPx} min={0} max={8} step={1} defaultValue={2} suffix="px" testId="blend-feather" onChange={assist.onFeatherChange} />
    {assist.status === 'loading' && <p className="inspector-note" role="status">Loading enhanced repair…</p>}
    {assist.status === 'failed' && <p className="inspector-note" role="alert">Enhanced repair is unavailable — using soft retouch instead.</p>}
  </>;
}

function ObjectRemovalControl({ assist }: { assist: ObjectRemovalAssist }) {
  const working = assist.state === 'detecting';
  const checked = assist.detections.filter((detection) => detection.checked).length;
  return <div className="object-removal" data-testid="object-removal">
    {assist.state === 'idle' && <>
      <button className="slim-button full-width" data-testid="object-removal-detect" title="Find people with ML, then review before removing" onClick={assist.onDetect}>Remove people</button>
      <p className="inspector-note">Finds people with ML, then heals each one like a brush stroke. Nothing is removed until you apply.</p>
    </>}
    {working && assist.progress && <MlProgressView progress={assist.progress} />}
    {working && <div className="suggestion-actions"><button className="text-button" data-testid="object-removal-cancel" onClick={assist.onDismiss}>Cancel</button></div>}
    {assist.state === 'ready' && (assist.detections.length === 0 ? <>
      <p className="inspector-note" role="status">No people found{assist.source === 'classic' ? ' by the classical scan' : ''}.</p>
      <div className="suggestion-actions"><button className="text-button" onClick={assist.onDismiss}>Dismiss</button></div>
    </> : <>
      <ul className="retouch-group-list" data-testid="object-removal-list" aria-label="Detected people">
        {assist.detections.map((detection, index) => (
          <li
            key={index}
            className={`retouch-group${assist.highlighted === index ? ' is-highlighted' : ''}`}
            data-testid={`object-removal-item-${index}`}
            onMouseEnter={() => assist.onHighlight?.(index)}
            onMouseLeave={() => assist.onHighlight?.(null)}
            onFocus={() => assist.onHighlight?.(index)}
            onBlur={() => assist.onHighlight?.(null)}
          >
            <label className="checkbox-field">
              <input type="checkbox" data-testid={`object-removal-check-${index}`} checked={detection.checked} onChange={() => assist.onToggle(index)} />
              <span>Person {index + 1} · {Math.round(detection.score * 100)}%{assist.source === 'onnx' ? ' · ML' : ''}</span>
            </label>
          </li>
        ))}
      </ul>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="slim-button" data-testid="object-removal-apply" disabled={checked === 0} title="Heal the checked people with the current repair method" onClick={assist.onApply}>Remove {checked} selected</button>
        <button className="text-button" onClick={assist.onDismiss}>Cancel</button>
      </div>
    </>)}
    {assist.state === 'error' && (
      <div className="assist-message is-error" data-testid="object-removal-error" role="alert">
        <p>{assist.message ?? 'Detection failed.'}</p>
        <div className="suggestion-actions">
          <button className="slim-button" data-testid="object-removal-retry" title="Detect people again" onClick={assist.onDetect}>Retry</button>
          <button className="text-button" data-testid="object-removal-dismiss" onClick={assist.onDismiss}>Dismiss</button>
        </div>
      </div>
    )}
  </div>;
}

function DustSpotsControl({ assist }: { assist: DustSpotsAssist }) {
  const working = assist.state === 'detecting';
  const checked = assist.spots.filter((spot) => spot.checked).length;
  // Highest confidence first regardless of server order. Original indices are
  // kept alongside so toggle/highlight callbacks still address the hook's
  // array (the canvas preview and checkbox state are index-based).
  const ordered = assist.spots
    .map((spot, index) => ({ spot, index }))
    .sort((a, b) => b.spot.score - a.spot.score);
  return <div className="object-removal dust-spots" data-testid="dust-spots">
    {assist.state === 'idle' && <>
      <button className="slim-button full-width" data-testid="dust-spots-detect" title="Find dust spots with ML, then review before repairing" onClick={assist.onDetect}>Find dust spots</button>
      <p className="inspector-note">Scans for dust and spots with ML, then repairs each accepted one like a brush stroke. Nothing is repaired until you apply.</p>
    </>}
    {working && assist.progress && <MlProgressView progress={assist.progress} />}
    {working && <div className="suggestion-actions"><button className="text-button" data-testid="dust-spots-cancel" onClick={assist.onDismiss}>Cancel</button></div>}
    {assist.state === 'ready' && (assist.spots.length === 0 ? <>
      <p className="inspector-note" role="status">No dust spots found{assist.source === 'classic' ? ' by the classical scan' : ''}.</p>
      <div className="suggestion-actions"><button className="text-button" onClick={assist.onDismiss}>Dismiss</button></div>
    </> : <>
      <ul className="retouch-group-list" data-testid="dust-spots-list" aria-label="Detected dust spots">
        {ordered.map(({ spot, index }, display) => (
          <li
            key={index}
            className={`retouch-group${assist.highlighted === index ? ' is-highlighted' : ''}`}
            data-testid={`dust-spots-item-${display}`}
            onMouseEnter={() => assist.onHighlight?.(index)}
            onMouseLeave={() => assist.onHighlight?.(null)}
            onFocus={() => assist.onHighlight?.(index)}
            onBlur={() => assist.onHighlight?.(null)}
          >
            <label className="checkbox-field">
              <input type="checkbox" data-testid={`dust-spots-check-${display}`} checked={spot.checked} onChange={() => assist.onToggle(index)} />
              <span>Spot {display + 1} · {Math.round(spot.score * 100)}%{assist.source === 'ml' ? ' · ML' : ''}</span>
            </label>
          </li>
        ))}
      </ul>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="slim-button" data-testid="dust-spots-apply" disabled={checked === 0} title="Repair the checked spots with the current repair method" onClick={assist.onApply}>Repair {checked} selected</button>
        <button className="text-button" onClick={assist.onDismiss}>Cancel</button>
      </div>
    </>)}
    {assist.state === 'error' && <>
      <p className="inspector-note" role="alert">{assist.message ?? 'Detection failed.'}</p>
      <div className="suggestion-actions">
        <button className="text-button" data-testid="dust-spots-retry" onClick={assist.onDetect}>Retry</button>
        <button className="text-button" onClick={assist.onDismiss}>Dismiss</button>
      </div>
    </>}
  </div>;
}

function SceneEnhanceControl({ edit, onAutoScene }: { edit: EditState; onAutoScene: () => void }) {
  const active = edit.autoEnhanced && Boolean(edit.sceneEnhance);
  return <div className="scene-enhance" data-testid="scene-enhance">
    <button className={`slim-button full-width${active ? ' is-active' : ''}`} data-testid="scene-enhance-apply" aria-pressed={active} title="Classify the scene with ML (portrait, landscape, night, document) and enhance with per-scene settings" onClick={onAutoScene}><span>Scene Enhance <span className="ml-badge" title="The scene is classified by a machine-learning model on your device">ML</span></span></button>
    {active && edit.sceneEnhance && <span className="scene-enhance-scene" data-testid="scene-enhance-scene" title={`Detected scene: ${SCENE_DISPLAY_NAMES[edit.sceneEnhance.scene]}, ${Math.round(edit.sceneEnhance.confidence * 100)}% confidence`}>{SCENE_DISPLAY_NAMES[edit.sceneEnhance.scene]} · {Math.round(edit.sceneEnhance.confidence * 100)}% · ML</span>}
  </div>;
}

function FaceEnhanceControl({ assist }: { assist: FaceEnhanceAssist }) {
  const working = assist.state === 'detecting';
  const mlTag = assist.source === 'onnx' ? ' · ML' : '';
  const wb = assist.whiteBalance;
  const summary = wb
    ? [`${assist.faces} ${assist.faces === 1 ? 'face' : 'faces'}`,
      `${assist.skinAnchored ? 'skin WB' : 'WB'} ${wb.temperature}K ${wb.tint >= 0 ? '+' : ''}${wb.tint}`,
      ...(assist.liftAmount > 0 ? [`lift +${assist.liftAmount} EV`] : []),
      ...(assist.redEyeCount > 0 ? [`${assist.redEyeCount} red-eye`] : []),
    ].join(' · ') + mlTag
    : null;
  return <div className="face-enhance" data-testid="face-enhance">
    {assist.state === 'idle' && !assist.applied && <>
      <button className="slim-button full-width" data-testid="face-enhance-detect" title="Find faces with ML, anchor white balance on skin, lift dark faces, fix red-eye" onClick={assist.onDetect}><span>Enhance Faces <span className="ml-badge" title="Faces are detected by a machine-learning model on the photo server">ML</span></span></button>
      <p className="inspector-note">Finds faces with ML, then anchors white balance on skin, lifts dark faces, and fixes red-eye. Nothing changes until you apply.</p>
    </>}
    {assist.state === 'idle' && assist.applied && <div className="auto-enhance-row face-enhance-row">
      <span className="scene-enhance-scene" data-testid="face-enhance-applied" title={`Face enhance applied to ${assist.applied.faces} ${assist.applied.faces === 1 ? 'face' : 'faces'}`}>{assist.applied.faces} {assist.applied.faces === 1 ? 'face' : 'faces'}{assist.applied.source === 'onnx' ? ' · ML' : ''}</span>
      <div className="suggestion-actions">
        <button className="text-button" data-testid="face-enhance-redetect" title="Detect faces again" onClick={assist.onDetect}>Rescan</button>
        <button className="text-button" data-testid="face-enhance-clear" title="Remove the masked face lift and red-eye fixes (white balance stays)" onClick={assist.onClear}>Clear</button>
      </div>
    </div>}
    {working && assist.progress && <MlProgressView progress={assist.progress} />}
    {working && <div className="suggestion-actions"><button className="text-button" data-testid="face-enhance-cancel" onClick={assist.onDismiss}>Cancel</button></div>}
    {assist.state === 'ready' && (assist.faces === 0 ? <>
      <p className="inspector-note" role="status">No faces found{assist.source === 'classic' ? ' by the classical scan' : ''}.</p>
      <div className="suggestion-actions"><button className="text-button" onClick={assist.onDismiss}>Dismiss</button></div>
    </> : <>
      <p className="inspector-note" role="status" data-testid="face-enhance-summary">{summary}</p>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="slim-button" data-testid="face-enhance-apply" title="Set white balance from faces and store the masked lift plus red-eye fixes" onClick={assist.onApply}>Apply face enhance</button>
        <button className="text-button" onClick={assist.onDismiss}>Cancel</button>
      </div>
    </>)}
    {assist.state === 'error' && <>
      <p className="inspector-note" role="alert">{assist.message ?? 'Detection failed.'}</p>
      <div className="suggestion-actions">
        <button className="text-button" data-testid="face-enhance-retry" onClick={assist.onDetect}>Retry</button>
        <button className="text-button" onClick={assist.onDismiss}>Dismiss</button>
      </div>
    </>}
  </div>;
}

function SelectiveTargetToggle({ target, onTarget, testIdPrefix }: { target: SelectiveTarget; onTarget: (target: SelectiveTarget) => void; testIdPrefix: string }) {
  return <div className="selective-target" role="group" aria-label="Masked adjustment target">
    <button className={target === 'subject' ? 'is-active' : ''} data-testid={`${testIdPrefix}-target-subject`} aria-pressed={target === 'subject'} title="Apply the masked adjustments to the subject" onClick={() => onTarget('subject')}>Subject</button>
    <button className={target === 'background' ? 'is-active' : ''} data-testid={`${testIdPrefix}-target-background`} aria-pressed={target === 'background'} title="Apply the masked adjustments to the background" onClick={() => onTarget('background')}>Background</button>
  </div>;
}

function SelectiveParamSliders({ values, onParam, testIdPrefix }: { values: SelectiveMaskDraft; onParam: (patch: Partial<SelectiveMaskDraft>) => void; testIdPrefix: string }) {
  return <>
    <RangeControl label="Exposure" value={values.exposure} min={-1} max={1} step={0.05} suffix=" EV" signed testId={`${testIdPrefix}-exposure`} onChange={(exposure) => onParam({ exposure })} />
    <RangeControl label="Contrast" value={values.contrast} min={-50} max={50} step={1} signed testId={`${testIdPrefix}-contrast`} onChange={(contrast) => onParam({ contrast })} />
    <RangeControl label="Saturation" value={values.saturation} min={-50} max={50} step={1} signed testId={`${testIdPrefix}-saturation`} onChange={(saturation) => onParam({ saturation })} />
  </>;
}

function selectiveSummary(values: SelectiveMaskDraft, source: SelectiveMaskSource | null): string {
  const signed = (value: number): string => `${value >= 0 ? '+' : ''}${Math.round(value * 100) / 100}`;
  const parts = [
    values.target === 'subject' ? 'Subject' : 'Background',
    ...(values.exposure !== 0 ? [`${signed(values.exposure)} EV`] : []),
    ...(values.contrast !== 0 ? [`C ${signed(values.contrast)}`] : []),
    ...(values.saturation !== 0 ? [`S ${signed(values.saturation)}`] : []),
  ];
  return parts.join(' · ') + (source === 'onnx' ? ' · ML' : '');
}

function SelectiveMaskControl({ assist }: { assist: SelectiveMaskAssist }) {
  const working = assist.state === 'detecting';
  const mlTag = assist.source === 'onnx' ? ' · ML' : '';
  // Pre-apply draft: reset whenever a fresh result arrives (a rescan with
  // identical coverage keeps the draft, which is harmless).
  const [draft, setDraft] = useState<SelectiveMaskDraft>(() => ({ target: 'subject', exposure: SELECTIVE_MASK_DEFAULT_EXPOSURE, contrast: 0, saturation: 0 }));
  const readyKey = `${assist.state}:${assist.coverage}:${assist.source}`;
  useEffect(() => {
    setDraft({ target: 'subject', exposure: SELECTIVE_MASK_DEFAULT_EXPOSURE, contrast: 0, saturation: 0 });
  }, [readyKey]);
  const patchDraft = (patch: Partial<SelectiveMaskDraft>): void => setDraft((current) => ({ ...current, ...patch }));
  return <div className="selective-mask" data-testid="selective-mask">
    {assist.state === 'idle' && !assist.applied && <>
      <button className="slim-button full-width" data-testid="selective-mask-detect" title="Segment the subject with ML, then adjust just the subject or background" onClick={assist.onDetect}><span>Brighten Subject Only <span className="ml-badge" title="The subject is segmented by a machine-learning model on the photo server">ML</span></span></button>
      <p className="inspector-note">Finds the subject with ML, then adjusts just the subject or background. Nothing changes until you apply.</p>
    </>}
    {assist.state === 'idle' && assist.applied && <>
      <div className="auto-enhance-row selective-mask-row">
        <span className="scene-enhance-scene" data-testid="selective-mask-applied" title="Selective adjustments applied through the subject mask">{selectiveSummary(assist.applied, assist.applied.source)}</span>
        <div className="suggestion-actions">
          <button className="text-button" data-testid="selective-mask-redetect" title="Segment the subject again" onClick={assist.onDetect}>Rescan</button>
          <button className="text-button" data-testid="selective-mask-clear" title="Remove the subject mask and its adjustments" onClick={assist.onClear}>Clear</button>
        </div>
      </div>
      <SelectiveTargetToggle target={assist.applied.target} onTarget={(target) => assist.onAdjust({ target })} testIdPrefix="selective-mask-applied" />
      <SelectiveParamSliders values={assist.applied} onParam={assist.onAdjust} testIdPrefix="selective-mask-applied" />
    </>}
    {working && assist.progress && <MlProgressView progress={assist.progress} />}
    {working && <div className="suggestion-actions"><button className="text-button" data-testid="selective-mask-cancel" onClick={assist.onDismiss}>Cancel</button></div>}
    {assist.state === 'ready' && (!assist.found ? <>
      <p className="inspector-note" role="status">No subject found{assist.source === 'classic' ? ' by the classical scan' : ''}.</p>
      <div className="suggestion-actions"><button className="text-button" onClick={assist.onDismiss}>Dismiss</button></div>
    </> : <>
      <p className="inspector-note" role="status" data-testid="selective-mask-summary">Subject {Math.round(assist.coverage * 100)}%{mlTag}</p>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <SelectiveTargetToggle target={draft.target} onTarget={(target) => patchDraft({ target })} testIdPrefix="selective-mask" />
      <SelectiveParamSliders values={draft} onParam={patchDraft} testIdPrefix="selective-mask" />
      <div className="suggestion-actions">
        <button className="slim-button" data-testid="selective-mask-apply" title="Store the subject mask with these adjustments" onClick={() => assist.onApply(draft)}>Apply to {draft.target}</button>
        <button className="text-button" onClick={assist.onDismiss}>Cancel</button>
      </div>
    </>)}
    {assist.state === 'error' && <>
      <p className="inspector-note" role="alert">{assist.message ?? 'Segmentation failed.'}</p>
      <div className="suggestion-actions">
        <button className="text-button" data-testid="selective-mask-retry" onClick={assist.onDetect}>Retry</button>
        <button className="text-button" onClick={assist.onDismiss}>Dismiss</button>
      </div>
    </>}
  </div>;
}

/** Manual slider start for clean captures (the auto ladder suggests 0 there). */
const DENOISE_MANUAL_DEFAULT = 45;

function DenoiseControl({ assist, photo }: { assist: DenoiseAssist; photo: Photo }) {
  const working = assist.state === 'previewing' || assist.state === 'applying';
  // Draft strength + auto toggle, reset per photo: high-ISO captures start
  // on Auto at the ISO suggestion, clean captures on manual 45.
  const [auto, setAuto] = useState(() => shouldAutoDenoise(photo.iso));
  const [slider, setSlider] = useState(() => denoiseStrengthForIso(photo.iso) || DENOISE_MANUAL_DEFAULT);
  useEffect(() => {
    setAuto(shouldAutoDenoise(photo.iso));
    setSlider(denoiseStrengthForIso(photo.iso) || DENOISE_MANUAL_DEFAULT);
  }, [photo.id]);
  const suggestion = denoiseStrengthForIso(photo.iso);
  const effective = auto ? suggestion : slider;
  // Stale after reload (recipe strength, no session pixels) — except while
  // a fresh preview is on screen, where Apply already covers the re-run.
  const stale = assist.applied !== null && !assist.hasBase && assist.state !== 'preview-ready';
  const appliedTag = assist.applied?.source === 'onnx' ? ' · ML' : '';
  const previewTag = assist.preview?.source === 'onnx' ? ' · ML' : '';
  return <div className="denoise" data-testid="denoise">
    <div className="denoise-auto-row" data-testid="denoise-auto-row">
      <span>Auto <span className="ml-badge" title="The strength is suggested by the capture ISO for a machine-learning denoise on the photo server">ML</span></span>
      <Toggle checked={auto} onChange={() => setAuto(!auto)} label="Auto denoise strength from ISO" />
    </div>
    <RangeControl label="Strength" value={auto ? suggestion : slider} min={0} max={100} step={1} defaultValue={DENOISE_MANUAL_DEFAULT} disabled={auto || working} testId="denoise-strength" onChange={setSlider} />
    <p className="inspector-note" data-testid="denoise-hint">
      {auto
        ? (suggestion > 0 ? `Auto · ISO ${photo.iso} → ${suggestion}` : `Auto · ISO ${photo.iso} needs no denoise`)
        : 'Manual strength — previews on a small downsample first'}
    </p>
    {working && assist.progress && <MlProgressView progress={assist.progress} />}
    {working && <div className="suggestion-actions"><button className="text-button" data-testid="denoise-cancel" onClick={assist.onDismiss}>Cancel</button></div>}
    {!working && assist.state !== 'preview-ready' && !assist.applied && <>
      <button className="secondary-button full-width" data-testid="denoise-preview" disabled={effective <= 0} title={effective <= 0 ? 'Raise the strength to preview' : 'Preview this strength on a small downsample'} onClick={() => assist.onPreview(effective, auto)}>Preview denoise</button>
      <p className="inspector-note">Denoises on the photo server — a small preview first, then the full photo on apply. The recipe keeps only the strength.</p>
    </>}
    {!working && assist.state === 'preview-ready' && assist.preview && <>
      <div className="denoise-compare" data-testid="denoise-compare">
        <figure><img src={assist.preview.beforeUrl} alt="Noisy preview" data-testid="denoise-before" /><figcaption>Before</figcaption></figure>
        <figure><img src={assist.preview.afterUrl} alt="Denoised preview" data-testid="denoise-after" /><figcaption>After</figcaption></figure>
      </div>
      <p className="inspector-note" role="status" data-testid="denoise-summary">Preview {assist.preview.strength}{previewTag}</p>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="secondary-button" data-testid="denoise-apply" title="Denoise the full photo and edit from the clean pixels" onClick={() => assist.onApply(effective, auto)}>Apply to photo</button>
        <button className="text-button" data-testid="denoise-repreview" title="Preview the current strength again" onClick={() => assist.onPreview(effective, auto)}>Update preview</button>
        <button className="text-button" onClick={assist.onDismiss}>Cancel</button>
      </div>
    </>}
    {!working && assist.state === 'applied' && assist.hasBase && assist.applied && <>
      <p className="inspector-note" role="status" data-testid="denoise-applied">Denoised {assist.applied.strength}{appliedTag} — the canvas and export use the clean photo.</p>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="text-button" data-testid="denoise-repreview" title="Try another strength on a small preview first" onClick={() => assist.onPreview(effective, auto)}>Try another strength</button>
        <button className="text-button" data-testid="denoise-clear" title="Drop the denoised photo and edit from the original" onClick={assist.onClear}>Clear</button>
      </div>
    </>}
    {!working && stale && assist.applied && <>
      <p className="inspector-note" role="status" data-testid="denoise-stale">Denoise {assist.applied.strength}{appliedTag} was applied — re-run to restore the clean photo.</p>
      <div className="suggestion-actions">
        <button className="secondary-button" data-testid="denoise-restore" title="Denoise the full photo again at the stored strength" onClick={() => assist.onApply(assist.applied!.strength, assist.applied!.auto)}>Restore denoise</button>
        <button className="text-button" data-testid="denoise-clear" title="Drop the stored strength and keep the original" onClick={assist.onClear}>Clear</button>
      </div>
    </>}
    {assist.state === 'error' && <>
      <p className="inspector-note" role="alert">{assist.message ?? 'Denoise failed.'}</p>
      <div className="suggestion-actions">
        <button className="text-button" data-testid="denoise-retry" onClick={() => assist.onPreview(effective, auto)}>Retry</button>
        <button className="text-button" onClick={assist.onDismiss}>Dismiss</button>
      </div>
    </>}
  </div>;
}

function RetouchGroups({ edit, highlightStroke, onHighlightStroke, onChange }: { edit: EditState; highlightStroke: number | null; onHighlightStroke?: (stroke: number | null) => void; onChange: ChangeEdit }) {
  const groups = useMemo(() => groupRetouchStrokes(edit.retouches), [edit.retouches]);
  const counters = { repair: 0 };
  const labels = groups.map((group) => {
    counters[group.kind] += 1;
    return `Repair ${counters[group.kind]}`;
  });
  const clearHighlight = (id: number) => { if (highlightStroke === id) onHighlightStroke?.(null); };
  return <div className="retouch-groups">
    <div className="retouch-status" data-testid="retouch-status">
      <span>{groups.length ? `${groups.length} ${groups.length === 1 ? 'group' : 'groups'} · ${edit.retouches.length} ${edit.retouches.length === 1 ? 'stamp' : 'stamps'}` : 'No retouching yet'}</span>
      <IconButton label="Clear all retouching" data-testid="retouch-clear" disabled={!edit.retouches.length} onClick={() => { onChange({ retouches: [] }); onHighlightStroke?.(null); }}><Trash2 size={14} /></IconButton>
    </div>
    {groups.length > 0 && <ul className="retouch-group-list" data-testid="retouch-group-list" aria-label="Retouch strokes">
      {groups.map((group, index) => (
        <li
          key={group.id}
          className={`retouch-group ${highlightStroke === group.id ? 'is-highlighted' : ''}`}
          onMouseEnter={() => onHighlightStroke?.(group.id)}
          onMouseLeave={() => clearHighlight(group.id)}
        >
          <span className="retouch-group-label">{labels[index]}</span>
          <span className="retouch-group-count">{group.points.length} {group.points.length === 1 ? 'stamp' : 'stamps'}</span>
          <IconButton
            label={`Delete ${labels[index]}`}
            onClick={() => { onChange({ retouches: edit.retouches.filter((point) => strokeIdForPoint(point) !== group.id) }); clearHighlight(group.id); }}
            onFocus={() => onHighlightStroke?.(group.id)}
            onBlur={() => clearHighlight(group.id)}
          ><X size={12} /></IconButton>
        </li>
      ))}
    </ul>}
  </div>;
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
  /** Fires while the straighten slider is dragged so the canvas can show a fine grid. */
  onStraightenDragging?: (dragging: boolean) => void;
  highlightStroke?: number | null;
  onHighlightStroke?: (stroke: number | null) => void;
  onChange: ChangeEdit;
  /** Rotate 90 degrees, turning repairs with the image. */
  onRotate: (direction: 1 | -1) => void;
  /** Set straighten degrees, turning repairs with the image. Merge key preserves slider-drag undo coalescing. */
  onStraighten: (next: number, mergeKey?: string) => void;
  onReset: () => void;
  onAuto: () => void;
  /** ML subject-aware enhance; omit to hide the scene row. */
  onAutoScene?: () => void;
  /** ML face-aware exposure; omit to hide the faces control. */
  faceAssist?: FaceEnhanceAssist;
  /** ML selective (masked) adjustments; omit to hide the subject control. */
  selectiveAssist?: SelectiveMaskAssist;
  /** Lightweight denoise; omit to hide the denoise section. */
  denoiseAssist?: DenoiseAssist;
  onAutoWhiteBalance: () => void;
  onAutoLightness: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSavePreset: () => void;
  onBrushSize: (value: number) => void;
  onBrushStrength: (value: number) => void;
  onClose: () => void;
}

export function Inspector({ photo, edit, tool, histogram, brushSize, brushStrength, canPaste, straightenAssist, repairAssist, onStraightenDragging, highlightStroke = null, onHighlightStroke, onChange, onRotate, onStraighten, onReset, onAuto, onAutoScene, faceAssist, selectiveAssist, denoiseAssist, onAutoWhiteBalance, onAutoLightness, onCopy, onPaste, onSavePreset, onBrushSize, onBrushStrength, onClose }: InspectorProps) {
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
  const title = tool === 'crop' ? 'Crop & Straighten' : tool === 'repair' ? 'Repair' : 'Color Adjustments';
  const TitleIcon = tool === 'crop' ? Crop : tool === 'repair' ? Bandage : SlidersHorizontal;
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
    <div className="inspector-scroll">{tool === 'adjust' ? <><div className="classic-enhance" data-testid="auto-enhance"><button className={`slim-button full-width${edit.autoEnhanced && !edit.sceneEnhance ? ' is-active' : ''}`} data-testid="auto-enhance-apply" aria-pressed={edit.autoEnhanced && !edit.sceneEnhance} title="Automatically enhance exposure, contrast, and color; click again to revert" onClick={onAuto}><Sparkles size={13} /><span>Auto Enhance</span></button></div>{(onAutoScene || faceAssist || selectiveAssist) && <AdjustmentSection title="ML Enhance" icon={<Sparkles size={14} />} badge={<span className="ml-badge" title="Each action below is powered by a machine-learning model">ML</span>}><div className="ml-enhance" data-testid="ml-enhance">{onAutoScene && <SceneEnhanceControl edit={edit} onAutoScene={onAutoScene} />}{faceAssist && <FaceEnhanceControl assist={faceAssist} />}{selectiveAssist && <SelectiveMaskControl assist={selectiveAssist} />}</div></AdjustmentSection>}<Histogram data={histogram} photo={photo} />
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
      {denoiseAssist && <AdjustmentSection title="Denoise" icon={<Sparkles size={14} />} onReset={denoiseAssist.onClear}>
        <DenoiseControl assist={denoiseAssist} photo={photo} />
      </AdjustmentSection>}
      <AdjustmentSection key={`effects-${openedExtra === 'Effects' ? extraRevision : 0}`} title="Effects" icon={<CircleDashed size={14} />} initiallyOpen={openedExtra === 'Effects'} onReset={() => onChange({ vignette: 0, fade: 0 })}>
        {range('vignette', 'Vignette', { min: 0 })}{range('fade', 'Fade', { min: 0 })}
      </AdjustmentSection>
      {extraSections.includes('Black & White') && <AdjustmentSection title="Black & White" icon={<Contrast size={14} />} enabled={edit.blackAndWhite} onToggle={() => onChange({ blackAndWhite: !edit.blackAndWhite })}><p className="inspector-note">A timeless look, without the distraction of color.</p><button className="secondary-button full-width" onClick={() => onChange({ blackAndWhite: !edit.blackAndWhite })}>{edit.blackAndWhite ? 'Restore Color' : 'Make Black & White'}</button></AdjustmentSection>}
      <div className="inspector-end-note"><Circle size={10} />Every change. Always reversible.</div>
    </> : tool === 'crop' ? <div className="tool-inspector crop-inspector"><div className="tool-intro"><Crop size={28} strokeWidth={1.3} /><h3>A fresh point of view.</h3><p>Find the right balance. Keep the best bits.</p></div><SelectField label="Aspect Ratio" value={edit.cropRatio} options={Object.keys(CROP_RATIOS).map((ratio) => ({ value: ratio, label: ratio === 'Original' ? 'Original proportions' : ratio }))} onChange={(cropRatio) => onChange({ cropRatio })} /><div className="ratio-presets">{['Original', '1:1', '4:3', '16:9'].map((ratio) => <button key={ratio} className={edit.cropRatio === ratio ? 'is-active' : ''} onClick={() => onChange({ cropRatio: ratio })}><span style={{ aspectRatio: CROP_RATIOS[ratio] || 1.5 }} />{ratio}</button>)}</div><div className="tool-divider" /><h4>Rotate & Flip</h4><div className="transform-buttons"><button title="Rotate left 90 degrees" onClick={() => onRotate(-1)}><RotateCcw size={18} /><span>Left</span></button><button title="Rotate right 90 degrees" onClick={() => onRotate(1)}><RotateCw size={18} /><span>Right</span></button><button className={edit.flipH ? 'is-active' : ''} title="Flip horizontally" onClick={() => onChange({ flipH: !edit.flipH })}><FlipHorizontal2 size={18} /><span>Horizontal</span></button><button className={edit.flipV ? 'is-active' : ''} title="Flip vertically" onClick={() => onChange({ flipV: !edit.flipV })}><FlipVertical2 size={18} /><span>Vertical</span></button></div>{straightenAssist ? <StraightenControl value={edit.straighten} assist={straightenAssist} onStraighten={onStraighten} onDraggingChange={onStraightenDragging} /> : <RangeControl label="Straighten" value={edit.straighten} min={-15} max={15} step={0.1} suffix="deg" signed onDraggingChange={onStraightenDragging} onChange={(next) => onStraighten(next, 'straighten')} />}<p className="inspector-note">Cropping is non-destructive. Your original photo is always kept safe.</p></div> : <><div className="tool-inspector"><div className="tool-intro"><Bandage size={30} strokeWidth={1.3} /><h3>Less distraction. More photo.</h3><p>Rebuild small distractions from the surrounding photo.</p></div></div><AdjustmentSection title="Brush" icon={<Brush size={14} />}><RangeControl label="Brush Size" value={brushSize} min={5} max={160} defaultValue={45} suffix="px" testId="brush-size" onChange={onBrushSize} /><RangeControl label="Strength" value={brushStrength} min={1} max={100} defaultValue={100} suffix="%" testId="brush-strength" onChange={onBrushStrength} /></AdjustmentSection>{repairAssist && <AdjustmentSection title="Reconstruction" icon={<Layers size={14} />}><RepairMethodControl assist={repairAssist} /></AdjustmentSection>}{repairAssist?.removal && <AdjustmentSection title="One-Click Removal" icon={<Eraser size={14} />} badge={<span className="ml-badge" title="Detected by a machine-learning model on the photo server">ML</span>}><ObjectRemovalControl assist={repairAssist.removal} /></AdjustmentSection>}{repairAssist?.dustSpots && <AdjustmentSection title="Dust Spots" icon={<Sparkles size={14} />} badge={<span className="ml-badge" title="Filtered by a machine-learning model on the photo server">ML</span>}><DustSpotsControl assist={repairAssist.dustSpots} /></AdjustmentSection>}<AdjustmentSection title="Repairs" icon={<Bandage size={14} />}><RetouchGroups edit={edit} highlightStroke={highlightStroke} onHighlightStroke={onHighlightStroke} onChange={onChange} /></AdjustmentSection></>}</div>
    {tool === 'adjust' && <div className="inspector-footer"><button className="add-adjustment" onClick={() => setAddMenu(!addMenu)} aria-expanded={addMenu}><Plus size={15} />Add Adjustment<ChevronDown size={12} /></button>{addMenu && <div className="dropdown-menu add-adjustment-menu" role="menu">{['Black & White'].filter((name) => !extraSections.includes(name)).map((name) => <MenuItem key={name} onClick={() => addSection(name)}>{name}</MenuItem>)}{!extraSections.includes('Black & White') && <div className="menu-separator" />}<MenuItem onClick={() => { onSavePreset(); setAddMenu(false); }}>Save as Preset...</MenuItem></div>}</div>}
  </aside>;
}