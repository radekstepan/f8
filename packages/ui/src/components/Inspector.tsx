import { useEffect, useMemo, useRef, useState } from 'react';
import { Bandage, Brush, ChevronDown, Circle, CircleDashed, Contrast, Crop, Eraser, FlipHorizontal2, FlipVertical2, Focus, Layers, MoreHorizontal, Palette, RotateCcw, RotateCw, ScanFace, SlidersHorizontal, Sparkles, Spline, Sun, Thermometer, Trash2, Waves, X } from 'lucide-react';
import { CROP_RATIOS, SCENE_DISPLAY_NAMES, denoiseStrengthForIso, groupRetouchStrokes, hasStraightenHorizon, shouldAutoDenoise, strokeIdForPoint } from '@f8/core';
import type { ChangeEdit, DenoiseSource, DenoiseState, DetectedObject, DustSpot, DustSpotsSource, EditState, FaceDetectSource, HealQuality, InpaintMethod, MlCategory, NumericAdjustment, ObjectDetectSource, Photo, SelectiveAdjustParams, SelectiveAdjustState, SelectiveMaskSource, SelectiveTarget, Tool, VisionWorkerStatus } from '@f8/core';
import type { HistogramData } from './PhotoCanvas.js';
import { AdjustmentSection } from './AdjustmentSection.js';
import { CheckField, IconButton, MenuItem, MenuSeparator, RangeControl, RevertButton, SegmentedControl, SelectField, Toggle } from './EditorUI.js';
import { useMenuDismiss } from '../hooks/useMenuDismiss.js';

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
  /** Pre-Auto slider value; set while a revert is available, even after manual edits cleared the highlight. */
  snapshot: number | null;
  /** The control passes its current slider value so the app can snapshot it before detecting. */
  onDetect: (currentValue: number) => void;
  /** Dismiss the detection highlight; the snapshot stays for the revert icon. */
  onDismiss: () => void;
  /** Clear the snapshot and dismiss. The control restores the value itself first. */
  onRevert: () => void;
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
  /** Stored face adjust from the recipe; shown with a toggle + Clear while idle (faces is 0 for a recorded no-face scan, shown without the toggle). */
  applied: { faces: number; source: FaceDetectSource; enabled: boolean; liftAmount: number; redEyeCount: number } | null;
  onDetect: () => void;
  /** Apply WB + masked lift + red-eye fixes as one undo step. */
  onApply: () => void;
  /** Bypass/restore the stored masked lift + red-eye discs without deleting them. */
  onToggle: () => void;
  /** Remove the stored masked lift + red-eye discs (WB sliders stay). */
  onClear: () => void;
  onDismiss: () => void;
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
  /** Stored selective adjust from the recipe (set whenever a mask is stored, even fully neutral). */
  applied: SelectiveAdjustState | null;
  /** Segment the subject; the app stores the mask immediately so sliders preview live. */
  onDetect: () => void;
  /** Live-tweak one side's stored params (each drag coalesces to one undo step). */
  onAdjust: (target: SelectiveTarget, patch: Partial<SelectiveAdjustParams>) => void;
  /** Bypass/restore both sides' stored params without deleting the mask. */
  onToggle: () => void;
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
  // One Auto button plus a revert icon, like the per-category ML actions:
  // applied derives from the assist result alone, so a manual slider move
  // or 90° rotate (both dismiss the assist) untoggles the button while the
  // value stays — and the snapshot-backed revert icon stays available.
  // Below the horizon threshold nothing applies; the app flashes the
  // no-horizon message over the photo instead (see PhotoCanvas
  // straightenFlash).
  const applied = assist.state === 'ready' && assist.angle !== null && hasStraightenHorizon(assist.confidence) && (assist.runId ?? 0) !== 0;
  // Applied key `${runId}:${angle}`: the server fallback overwrites with the
  // same runId but a new angle, and StrictMode double-effects never
  // double-apply.
  const appliedKey = useRef('');
  useEffect(() => {
    if (assist.state === 'idle') appliedKey.current = '';
  }, [assist.state]);
  const runId = assist.runId ?? 0;
  const readyAngle = applied ? assist.angle : null;
  useEffect(() => {
    if (readyAngle !== null && runId !== 0) {
      const key = `${runId}:${readyAngle}`;
      if (appliedKey.current !== key) {
        appliedKey.current = key;
        // Discrete step: Auto must stay independently undoable and never
        // coalesce with adjacent manual slider drags sharing 'straighten'.
        onStraighten(readyAngle);
      }
    }
  }, [readyAngle, runId, onStraighten]);
  const revert = () => {
    if (assist.snapshot !== null) onStraighten(assist.snapshot);
    assist.onRevert();
  };
  const onToggle = () => {
    if (applied) {
      revert();
      return;
    }
    assist.onDetect(value);
  };
  return <div className="straighten-assist">
    <RangeControl label="Straighten" value={value} min={-15} max={15} step={0.1} suffix="deg" signed valueHint="Click to type an exact value in degrees" onDraggingChange={onDraggingChange} onChange={(next) => { assist.onDismiss(); onStraighten(next, 'straighten'); }} />
    <div className="straighten-auto-row">
      <button className={`auto-small straighten-auto${applied ? ' is-active' : ''}`} data-testid="straighten-auto" aria-pressed={applied} disabled={working} title={applied ? 'Auto-straighten applied — click to revert' : 'Detect the horizon tilt automatically and apply it'} onClick={onToggle}>{working ? (assist.state === 'loading' ? 'Loading…' : mlActive ? 'Estimating…' : 'Detecting…') : 'Auto'}</button>
      {assist.snapshot !== null && <RevertButton testId="straighten-auto-revert" label="Revert auto-straighten" onClick={revert} />}
      {working && !mlActive && <span className="straighten-status" role="status">{assist.state === 'loading' ? 'Loading vision engine…' : 'Detecting horizon tilt…'}</span>}
      {assist.state === 'error' && assist.message && <span className="straighten-status is-error" role="alert">{assist.message}</span>}
    </div>
    {mlActive && assist.mlProgress && <MlProgressView progress={assist.mlProgress} onCancel={assist.mlWarming && assist.onCancelMl ? assist.onCancelMl : undefined} />}
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
    <SegmentedControl label="Repair reconstruction method" testId="repair-method-group" value={assist.method} onChange={assist.onMethodChange} options={[
      { value: 'ml-heal', label: 'ML Repair', title: 'ML Repair: neural fill on the photo server', testId: 'repair-method-ml-heal' },
      { value: 'heal', label: 'Repair', title: 'Repair: copies matching texture from nearby', testId: 'repair-method-heal' },
      { value: 'telea', label: 'Smooth', title: 'Smooth fill: fast, for tiny blemishes', testId: 'repair-method-telea' },
      { value: 'ns', label: 'Detail', title: 'Detail fill: slower, follows edges', testId: 'repair-method-ns' },
    ]} />
    <p className="inspector-note repair-method-blurb">{methodBlurb}</p>
    {(assist.method === 'heal' || assist.method === 'ml-heal') && <>
      {!offline && <>
        <h4>Repair Quality</h4>
        <SegmentedControl label="Repair search effort" testId="heal-quality-group" value={assist.quality} onChange={assist.onQualityChange} options={[
          ...(assist.method !== 'ml-heal' ? [{ value: 'fast' as const, label: 'Fast', title: 'Fast: nearby donors only, best for small blemishes', testId: 'heal-quality-fast' }] : []),
          { value: 'balanced' as const, label: 'Balanced', title: assist.method === 'ml-heal' ? 'Balanced: neural fill' : 'Balanced: the default search reach and effort', testId: 'heal-quality-balanced' },
          { value: 'best' as const, label: 'Best', title: assist.method === 'ml-heal' ? 'Best: diffusion inpainting, slowest' : 'Best: widest search, slowest — for tricky removals', testId: 'heal-quality-best' },
        ]} />
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
    {assist.state === 'idle' &&
      <p className="inspector-note">Finds people with ML, then heals each one like a brush stroke. Nothing is removed until you apply.</p>
    }
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
            <CheckField testId={`object-removal-check-${index}`} checked={detection.checked} onChange={() => assist.onToggle(index)}>Person {index + 1} · {Math.round(detection.score * 100)}%{assist.source === 'onnx' ? ' · ML' : ''}</CheckField>
          </li>
        ))}
      </ul>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="text-button" data-testid="object-removal-apply" disabled={checked === 0} title="Heal the checked people with the current repair method" onClick={assist.onApply}>Remove {checked} selected</button>
        <button className="text-button" onClick={assist.onDismiss}>Cancel</button>
      </div>
    </>)}
    {assist.state === 'error' && (
      <div className="assist-message is-error" data-testid="object-removal-error" role="alert">
        <p>{assist.message ?? 'Detection failed.'}</p>
        <div className="suggestion-actions">
          <button className="text-button" data-testid="object-removal-retry" title="Detect people again" onClick={assist.onDetect}>Retry</button>
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
    {assist.state === 'idle' &&
      <p className="inspector-note">Scans for dust and spots with ML, then repairs each accepted one like a brush stroke. Nothing is repaired until you apply.</p>
    }
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
            <CheckField testId={`dust-spots-check-${display}`} checked={spot.checked} onChange={() => assist.onToggle(index)}>Spot {display + 1} · {Math.round(spot.score * 100)}%{assist.source === 'ml' ? ' · ML' : ''}</CheckField>
          </li>
        ))}
      </ul>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="text-button" data-testid="dust-spots-apply" disabled={checked === 0} title="Repair the checked spots with the current repair method" onClick={assist.onApply}>Repair {checked} selected</button>
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

function SceneEnhanceControl({ edit }: { edit: EditState }) {
  // Enhancement runs from the section header's ML button (White Balance
  // pattern), so there is no apply bar in the content in any state — just
  // the persisted scene label, or the explanatory note before the first run.
  return <div className="scene-enhance" data-testid="scene-enhance">
    {edit.sceneEnhance
      ? <span className="scene-enhance-scene" data-testid="scene-enhance-scene" title={`Detected scene: ${SCENE_DISPLAY_NAMES[edit.sceneEnhance.scene]}, ${Math.round(edit.sceneEnhance.confidence * 100)}% confidence`}>{SCENE_DISPLAY_NAMES[edit.sceneEnhance.scene]} · {Math.round(edit.sceneEnhance.confidence * 100)}%</span>
      : <p className="inspector-note">Classify the scene with ML (portrait, landscape, night, document) and enhance with per-scene settings.</p>}
  </div>;
}

/** What the stored face adjust does, so the applied badge answers "did it work?". */
function appliedSummary(applied: NonNullable<FaceEnhanceAssist['applied']>): string {
  // A recorded scan that found nothing shows the plain outcome, not "0
  // faces" and with no ML tag — a hit keeps its tag as the engine credit.
  if (applied.faces === 0) return 'No faces found';
  const mlTag = applied.source === 'onnx' ? ' · ML' : '';
  const parts = [
    `${applied.faces} ${applied.faces === 1 ? 'face' : 'faces'}`,
    ...(applied.liftAmount > 0 ? [`lift +${applied.liftAmount} EV`] : []),
    ...(applied.redEyeCount > 0 ? [`${applied.redEyeCount} red-eye`] : []),
  ];
  return parts.join(' · ') + mlTag;
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
  // Detection runs from the section header's ML button (White Balance
  // pattern), so there is no detect bar in the content in any state — the
  // idle state is just the explanatory note.
  return <div className="face-enhance" data-testid="face-enhance">
    {assist.state === 'idle' && !assist.applied &&
      <p className="inspector-note">Finds faces with ML, then anchors white balance on skin, lifts dark faces, and fixes red-eye. Nothing changes until you apply.</p>
    }
    {assist.state === 'idle' && assist.applied && <div className="auto-enhance-row face-enhance-row">
      <span className={`scene-enhance-scene${assist.applied.enabled ? '' : ' is-off'}`} data-testid="face-enhance-applied" title={assist.applied.faces === 0 ? 'Checked — no faces found. Rescan to run detection again.' : assist.applied.enabled ? `Face enhance on: ${appliedSummary(assist.applied)}` : 'Face enhance off — the lift and red-eye fixes are bypassed'}>{appliedSummary(assist.applied)}</span>
      {assist.applied.faces > 0 && <Toggle checked={assist.applied.enabled} onChange={assist.onToggle} label="Enable face enhance" />}
      <div className="suggestion-actions">
        <button className="text-button" data-testid="face-enhance-redetect" title="Detect faces again" onClick={assist.onDetect}>Rescan</button>
        <button className="text-button" data-testid="face-enhance-clear" title={assist.applied.faces === 0 ? 'Remove the recorded no-face scan' : 'Remove the masked face lift and red-eye fixes (white balance stays)'} onClick={assist.onClear}>Clear</button>
      </div>
    </div>}
    {working && <MlProgressView progress={assist.progress ?? { fraction: 0, stage: 'Preparing photo…' }} />}
    {working && <div className="suggestion-actions"><button className="text-button" data-testid="face-enhance-cancel" onClick={assist.onDismiss}>Cancel</button></div>}
    {assist.state === 'ready' && (assist.faces === 0 ? <>
      <p className="inspector-note" role="status">No faces found{assist.source === 'classic' ? ' by the classical scan' : ''}.</p>
      <div className="suggestion-actions"><button className="text-button" onClick={assist.onDismiss}>Dismiss</button></div>
    </> : <>
      <p className="inspector-note" role="status" data-testid="face-enhance-summary">{summary}</p>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="text-button" data-testid="face-enhance-apply" title="Set white balance from faces and store the masked lift plus red-eye fixes" onClick={assist.onApply}>Apply face enhance</button>
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

function SelectiveParamGroup({ label, values, onParam, testIdPrefix }: { label: string; values: SelectiveAdjustParams; onParam: (patch: Partial<SelectiveAdjustParams>) => void; testIdPrefix: string }) {
  return <div className="selective-group" data-testid={`${testIdPrefix}-group`}>
    <span className="selective-group-label">{label}</span>
    <RangeControl label="Exposure" value={values.exposure} min={-1} max={1} step={0.05} suffix=" EV" signed testId={`${testIdPrefix}-exposure`} onChange={(exposure) => onParam({ exposure })} />
    <RangeControl label="Contrast" value={values.contrast} min={-50} max={50} step={1} signed testId={`${testIdPrefix}-contrast`} onChange={(contrast) => onParam({ contrast })} />
    <RangeControl label="Saturation" value={values.saturation} min={-50} max={50} step={1} signed testId={`${testIdPrefix}-saturation`} onChange={(saturation) => onParam({ saturation })} />
  </div>;
}

function SelectiveMaskControl({ assist }: { assist: SelectiveMaskAssist }) {
  const working = assist.state === 'detecting';
  const mlTag = assist.source === 'onnx' ? ' · ML' : '';
  // No draft state: the app stores the mask the moment segmentation lands,
  // so every slider below patches the recipe and previews live. No applied
  // summary line either — the sliders themselves show the values, and the
  // section title above names the action in every state. Segmentation runs
  // from the section header's ML button (White Balance pattern), so there
  // is no detect bar in the content in any state.
  return <div className="selective-mask" data-testid="selective-mask">
    {assist.state === 'idle' && !assist.applied &&
      <p className="inspector-note">Finds the subject with ML and applies instantly — drag either side&apos;s sliders and watch the photo. Changes save automatically.</p>
    }
    {assist.applied && <>
      <div className="auto-enhance-row selective-mask-row">
        <Toggle checked={assist.applied.enabled !== false} onChange={assist.onToggle} label="Enable subject and background enhance" />
        <div className="suggestion-actions">
          <button className="text-button" data-testid="selective-mask-redetect" title="Segment the subject again (keeps your slider values)" onClick={assist.onDetect}>Rescan</button>
          <button className="text-button" data-testid="selective-mask-clear" title="Remove the subject mask and its adjustments" onClick={assist.onClear}>Clear</button>
        </div>
      </div>
      <SelectiveParamGroup label="Subject" values={assist.applied.subject} onParam={(patch) => assist.onAdjust('subject', patch)} testIdPrefix="selective-mask-subject" />
      <SelectiveParamGroup label="Background" values={assist.applied.background} onParam={(patch) => assist.onAdjust('background', patch)} testIdPrefix="selective-mask-background" />
    </>}
    {working && assist.progress && <MlProgressView progress={assist.progress} />}
    {working && <div className="suggestion-actions"><button className="text-button" data-testid="selective-mask-cancel" onClick={assist.onDismiss}>Cancel</button></div>}
    {assist.state === 'ready' && !assist.found && <>
      <p className="inspector-note" role="status">No subject found{assist.source === 'classic' ? ' by the classical scan' : ''}.</p>
      <div className="suggestion-actions"><button className="text-button" onClick={assist.onDismiss}>Dismiss</button></div>
    </>}
    {assist.state === 'ready' && assist.found && !assist.applied && <>
      <p className="inspector-note" role="status" data-testid="selective-mask-summary">Subject {Math.round(assist.coverage * 100)}%{mlTag} — applying to photo…</p>
      {assist.note && <p className="inspector-note">{assist.note}</p>}
    </>}
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

/** 16× closeup of the before/after pair: sensor noise is unreadable at sidebar thumbnail scale. */
function DenoiseCloseup({ preview, loupe }: { preview: NonNullable<DenoiseAssist['preview']>; loupe: { x: number; y: number } }) {
  const position = `${loupe.x}% ${loupe.y}%`;
  return <div className="denoise-closeup" data-testid="denoise-closeup">
    <figure><div className="denoise-zoom" role="img" aria-label="Noisy closeup at 16x magnification" data-testid="denoise-closeup-before" style={{ backgroundImage: `url("${preview.beforeUrl}")`, backgroundPosition: position }} /><figcaption>Before · 16×</figcaption></figure>
    <figure><div className="denoise-zoom" role="img" aria-label="Denoised closeup at 16x magnification" data-testid="denoise-closeup-after" style={{ backgroundImage: `url("${preview.afterUrl}")`, backgroundPosition: position }} /><figcaption>After · 16×</figcaption></figure>
  </div>;
}

/**
 * Focus-rect half-size in % of the After preview width: a 16× loupe samples
 * 1/16 of the image width, so the rect is 6.25% wide and the center stays a
 * half-rect inside each edge. (The rect is an on-screen square, which is
 * exactly the sampled region: the square zoom box always shows a W/16 × W/16
 * patch of the preview, whatever the photo aspect.)
 */
const DENOISE_FOCUS_HALF = 100 / 32;

/** Clamp a loupe % so the centered focus rect stays inside the After preview. */
function clampDenoiseFocus(value: number): number {
  return Math.max(DENOISE_FOCUS_HALF, Math.min(100 - DENOISE_FOCUS_HALF, value));
}

function DenoiseControl({ assist, photo, slider, auto, onDraft }: { assist: DenoiseAssist; photo: Photo; slider: number; auto: boolean; onDraft: (strength: number, auto: boolean) => void }) {
  const working = assist.state === 'previewing' || assist.state === 'applying';
  // Closeup center in % of the small preview; clicking the preview moves it.
  const [loupe, setLoupe] = useState({ x: 50, y: 50 });
  const previewUrl = assist.preview?.beforeUrl;
  useEffect(() => {
    setLoupe({ x: 50, y: 50 });
  }, [previewUrl]);
  const suggestion = denoiseStrengthForIso(photo.iso);
  // Stale after reload (recipe strength, no session pixels) — except while
  // a fresh preview is on screen, where Apply already covers the re-run.
  const stale = assist.applied !== null && !assist.hasBase && assist.state !== 'preview-ready';
  const appliedTag = assist.applied?.source === 'onnx' ? ' · ML' : '';
  const previewTag = assist.preview?.source === 'onnx' ? ' · ML' : '';
  // The draft moved past what the on-screen preview shows.
  const previewStale = assist.preview !== null && slider !== assist.preview.strength;
  // No inner heading and no Auto pill: the control lives in its own
  // "Denoise" section whose header already carries the title and the ML
  // action (the auto suggestion moved there like everywhere else). The
  // slider stays always editable — any manual move clears the auto mark
  // (White Balance pattern: manual edits clear the highlight, the value
  // stays). Nothing on the photo changes until Preview, then Apply.
  return <div className="denoise" data-testid="denoise">
    <div className="denoise-suggest-row" data-testid="denoise-suggest-row">
      <span>{suggestion > 0 ? `Suggested for ISO ${photo.iso}: ${suggestion}` : `ISO ${photo.iso} looks clean — no suggestion`}</span>
    </div>
    <RangeControl label="Strength" value={slider} min={0} max={100} step={1} defaultValue={DENOISE_MANUAL_DEFAULT} disabled={working} testId="denoise-strength" onChange={(next) => onDraft(next, false)} />
    <p className="inspector-note" data-testid="denoise-hint">
      {auto
        ? `Auto ${suggestion} — drag the slider to fine-tune`
        : 'Draft strength — Preview, then Apply, to change the photo'}
    </p>
    {working && assist.progress && <MlProgressView progress={assist.progress} />}
    {working && <div className="suggestion-actions"><button className="text-button" data-testid="denoise-cancel" onClick={assist.onDismiss}>Cancel</button></div>}
    {!working && assist.state !== 'preview-ready' && !assist.applied && <>
      <button className="text-button full-width" data-testid="denoise-preview" disabled={slider <= 0} title={slider <= 0 ? 'Raise the strength to preview' : `Show strength ${slider} as a small before/after below, in this panel`} onClick={() => assist.onPreview(slider, auto)}><span>Preview denoise</span></button>
      <p className="inspector-note">How it works: 1) pick a strength, 2) Preview shows a small before/after below in this panel, 3) Apply denoises the full photo. Only the strength is saved.</p>
    </>}
    {!working && assist.state === 'preview-ready' && assist.preview && <>
      <p className="denoise-preview-title" data-testid="denoise-preview-title">Preview — small downsample, shown here</p>
      <div className="denoise-compare" data-testid="denoise-compare" title="Click to move the 16× closeup" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = Math.round(((event.clientX - rect.left) / rect.width) * 100);
        const y = Math.round(((event.clientY - rect.top) / rect.height) * 100);
        setLoupe({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
      }}>
        <figure><div className="denoise-after-wrap"><img src={assist.preview.afterUrl} alt="Denoised preview" data-testid="denoise-after" /><div className="denoise-focus-rect" data-testid="denoise-focus-rect" aria-hidden="true" style={{ left: `${clampDenoiseFocus(loupe.x)}%`, top: `${clampDenoiseFocus(loupe.y)}%` }} /></div><figcaption>After</figcaption></figure>
      </div>
      <DenoiseCloseup preview={assist.preview} loupe={loupe} />
      <p className="inspector-note" role="status" data-testid="denoise-summary">Preview {assist.preview.strength}{previewTag} · small downsample</p>
      {previewStale && <p className="inspector-note" data-testid="denoise-preview-stale">Strength is now {slider} — update the preview to see it.</p>}
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="text-button" data-testid="denoise-apply" title={`Denoise the full photo at strength ${slider} and edit from the clean pixels`} onClick={() => assist.onApply(slider, auto)}>Apply to photo</button>
        <button className="text-button" data-testid="denoise-repreview" title={`Preview the current strength (${slider}) again`} onClick={() => assist.onPreview(slider, auto)}>Update preview</button>
        <button className="text-button" onClick={assist.onDismiss}>Cancel</button>
      </div>
    </>}
    {!working && assist.state === 'applied' && assist.hasBase && assist.applied && <>
      <p className="inspector-note" role="status" data-testid="denoise-applied">Denoised {assist.applied.strength}{appliedTag} — the canvas and export use the clean photo.</p>
      {assist.preview && <DenoiseCloseup preview={assist.preview} loupe={loupe} />}
      <p className="inspector-note" data-testid="denoise-compare-hint">On the photo, Compare (B in the toolbar) toggles the noisy original against this clean photo.</p>
      {slider !== assist.applied.strength && <p className="inspector-note" data-testid="denoise-draft-diff">Draft {slider} differs from applied {assist.applied.strength} — preview it below before applying.</p>}
      {assist.note && <p className="inspector-note">{assist.note}</p>}
      <div className="suggestion-actions">
        <button className="text-button" data-testid="denoise-repreview" title="Preview a different strength below before applying" onClick={() => assist.onPreview(slider, auto)}>Preview another strength</button>
        <button className="text-button" data-testid="denoise-clear" title="Drop the denoised photo and edit from the original" onClick={assist.onClear}>Clear</button>
      </div>
    </>}
    {!working && stale && assist.applied && <>
      <p className="inspector-note" role="status" data-testid="denoise-stale">Denoise {assist.applied.strength}{appliedTag} was applied — re-run to restore the clean photo.</p>
      <div className="suggestion-actions">
        <button className="text-button" data-testid="denoise-restore" title="Denoise the full photo again at the stored strength" onClick={() => assist.onApply(assist.applied!.strength, assist.applied!.auto)}>Restore denoise</button>
        <button className="text-button" data-testid="denoise-clear" title="Drop the stored strength and keep the original" onClick={assist.onClear}>Clear</button>
      </div>
    </>}
    {assist.state === 'error' && <>
      <p className="inspector-note" role="alert">{assist.message ?? 'Denoise failed.'}</p>
      <div className="suggestion-actions">
        <button className="text-button" data-testid="denoise-retry" onClick={() => assist.onPreview(slider, auto)}>Retry</button>
        <button className="text-button" onClick={assist.onDismiss}>Dismiss</button>
      </div>
    </>}
  </div>;
}

/**
 * The Denoise section: the draft strength lives here (not in the control)
 * so the shared header ML button drives the same auto suggestion the old
 * content Auto pill did — it highlights while the draft is the ISO
 * suggestion, and engaging it sets the suggestion. The reset follows the
 * Enhance Faces pattern: present exactly while a denoise is stored, and
 * clearing it (no pre-apply snapshot exists, so canRevert stays false and
 * the reset always runs onClear).
 */
function DenoiseSection({ assist, photo }: { assist: DenoiseAssist; photo: Photo }) {
  const working = assist.state === 'previewing' || assist.state === 'applying';
  // Draft strength, reset per photo: high-ISO captures start at the ISO
  // suggestion (marked auto), clean captures at manual 45.
  const [slider, setSlider] = useState(() => denoiseStrengthForIso(photo.iso) || DENOISE_MANUAL_DEFAULT);
  const [auto, setAuto] = useState(() => shouldAutoDenoise(photo.iso));
  useEffect(() => {
    setSlider(denoiseStrengthForIso(photo.iso) || DENOISE_MANUAL_DEFAULT);
    setAuto(shouldAutoDenoise(photo.iso));
  }, [photo.id]);
  const suggestion = denoiseStrengthForIso(photo.iso);
  const applied = assist.applied !== null;
  const mlTitle = suggestion <= 0
    ? `ISO ${photo.iso} needs no denoise`
    : auto
      ? `Auto suggestion ${suggestion} — click to go manual, or drag the slider to fine-tune`
      : `Set strength to the ISO ${photo.iso} suggestion (${suggestion})`;
  return <AdjustmentSection title="Denoise" icon={<Waves size={14} />}
    ml={{
      id: 'denoise',
      applied: auto,
      canRevert: false,
      onToggle: () => { if (auto) setAuto(false); else { setSlider(suggestion); setAuto(true); } },
      onRevert: () => setAuto(false),
      disabled: working || suggestion <= 0,
      title: mlTitle,
    }}
    onReset={applied ? assist.onClear : undefined} dirty={applied}>
    <DenoiseControl assist={assist} photo={photo} slider={slider} auto={auto} onDraft={(strength, nextAuto) => { setSlider(strength); setAuto(nextAuto); }} />
  </AdjustmentSection>;
}

/**
 * The One-Click Removal section: detection runs from the shared header ML
 * button (Face Enhance pattern), so the content holds the review list but
 * no detect bar — the idle state is just the explanatory note. The assist
 * is ephemeral (apply dismisses back to idle; the strokes live in the
 * Repairs section from there), so the button never highlights and carries
 * no reset: every click runs a fresh detection.
 */
function RemovalSection({ assist }: { assist: ObjectRemovalAssist }) {
  const working = assist.state === 'detecting';
  const title = working
    ? 'Detecting people…'
    : assist.state === 'idle'
      ? 'Find people with ML, then review before removing'
      : 'Detect people again';
  return <AdjustmentSection title="One-Click Removal" icon={<Eraser size={14} />}
    ml={{
      id: 'object-removal',
      applied: false,
      canRevert: false,
      onToggle: assist.onDetect,
      onRevert: assist.onDismiss,
      disabled: working,
      title,
    }}>
    <ObjectRemovalControl assist={assist} />
  </AdjustmentSection>;
}

/**
 * The Dust Spots section: the same shared-header convergence as
 * RemovalSection — the header ML button runs the scan, the content keeps
 * the review list with no detect bar, and the ephemeral assist means no
 * highlight and no reset.
 */
function DustSpotsSection({ assist }: { assist: DustSpotsAssist }) {
  const working = assist.state === 'detecting';
  const title = working
    ? 'Detecting dust spots…'
    : assist.state === 'idle'
      ? 'Find dust spots with ML, then review before repairing'
      : 'Detect dust spots again';
  return <AdjustmentSection title="Dust Spots" icon={<Sparkles size={14} />}
    ml={{
      id: 'dust-spots',
      applied: false,
      canRevert: false,
      onToggle: assist.onDetect,
      onRevert: assist.onDismiss,
      disabled: working,
      title,
    }}>
    <DustSpotsControl assist={assist} />
  </AdjustmentSection>;
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
  /** Last enhance mode with a stored snapshot; null when no enhance revert is available. */
  enhanceMode?: 'classic' | 'scene' | null;
  /** True while the recipe still holds exactly the last enhance's values. */
  enhancePure?: boolean;
  /** True while a pre-enhance snapshot exists for the last mode. False after a reload (flags persist, the snapshot does not), hiding the revert affordance while the highlight stays. Defaults to mode presence — in-session snapshots always accompany a mode. */
  enhanceCanRevert?: boolean;
  /** Restore the pre-enhance snapshot (shared by both enhance modes). */
  onRevertEnhance: () => void;
  /** ML face-aware exposure; omit to hide the faces control. */
  faceAssist?: FaceEnhanceAssist;
  /** ML selective (masked) adjustments; omit to hide the subject control. */
  selectiveAssist?: SelectiveMaskAssist;
  /** Lightweight denoise; omit to hide it from the ML Enhance section. */
  denoiseAssist?: DenoiseAssist;
  onAutoWhiteBalance: () => void;
  onAutoLightness: () => void;
  onAutoColor: () => void;
  onRevertWhiteBalance: () => void;
  onRevertLightness: () => void;
  onRevertColor: () => void;
  /** Per-category ML highlight flags; a set flag lights the ML button (pure auto values). */
  mlApplied?: Partial<Record<MlCategory, boolean>>;
  /** Per-category ML revert flags; a set flag routes the header reset to the pre-ML snapshot, even after manual edits. */
  mlRevert?: Partial<Record<MlCategory, boolean>>;
  onCopy: () => void;
  onPaste: () => void;
  onSavePreset: () => void;
  onBrushSize: (value: number) => void;
  onBrushStrength: (value: number) => void;
  onClose: () => void;
}

export function Inspector({ photo, edit, tool, histogram, brushSize, brushStrength, canPaste, straightenAssist, repairAssist, onStraightenDragging, highlightStroke = null, onHighlightStroke, onChange, onRotate, onStraighten, onReset, onAuto, onAutoScene, enhanceMode = null, enhancePure = false, enhanceCanRevert, onRevertEnhance, faceAssist, selectiveAssist, denoiseAssist, onAutoWhiteBalance, onAutoLightness, onAutoColor, onRevertWhiteBalance, onRevertLightness, onRevertColor, mlApplied, mlRevert, onCopy, onPaste, onSavePreset, onBrushSize, onBrushStrength, onClose }: InspectorProps) {
  const [menu, setMenu] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [extraSections, setExtraSections] = useState<string[]>([]);
  const [openedExtra, setOpenedExtra] = useState('');
  const [extraRevision, setExtraRevision] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(menuRef, () => setMenu(false));
  useMenuDismiss(addMenuRef, () => setAddMenu(false));

  const range = (key: NumericAdjustment, label: string, options: Partial<React.ComponentProps<typeof RangeControl>> = {}) => <RangeControl key={key} label={label} value={edit[key]} signed onChange={(value) => onChange({ [key]: value }, key)} {...options} />;
  // Legacy recipes can carry a disabled category (the header toggle used to
  // bypass the effect); the first manual slider move re-enables it so the
  // edit shows on the photo. ML applies always enable their category.
  const rangeEnabled = (enabledKey: 'whiteBalanceEnabled' | 'lightnessEnabled' | 'colorEnabled' | 'detailsEnabled', key: NumericAdjustment, label: string, options: Partial<React.ComponentProps<typeof RangeControl>> = {}) => <RangeControl key={key} label={label} value={edit[key]} signed onChange={(value) => onChange({ [key]: value, [enabledKey]: true }, key)} {...options} />;
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
  // Whole-photo enhance UI: each mode's button highlights only its own pure
  // state, and the last-used mode carries the shared revert icon — manual
  // look edits clear the highlight but keep the revert. A reload seeds the
  // highlight from persisted flags with no snapshot, so the revert icon
  // (and its dirty state) needs the explicit snapshot signal, not the mode.
  const enhanceSnapshot = enhanceCanRevert ?? enhanceMode !== null;
  const classicActive = enhanceMode === 'classic' && enhancePure;
  const classicRevert = enhanceMode === 'classic' && enhanceSnapshot;
  const sceneActive = enhanceMode === 'scene' && enhancePure;
  const sceneRevert = enhanceMode === 'scene' && enhanceSnapshot;

  return <aside className="adjustments-sidebar" ref={ref} aria-label="Editing inspector">
    <div className="inspector-title">
      <TitleIcon size={15} strokeWidth={1.7} /><h2>{title}</h2>
      <div className="inspector-menu-anchor" ref={menuRef}>
        <IconButton label="Adjustment options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></IconButton>
        {menu && <div className="dropdown-menu inspector-options" role="menu">
          <MenuItem onClick={() => closeAction(onCopy)} shortcut="Ctrl Shift C">Copy Adjustments</MenuItem>
          <MenuItem onClick={() => closeAction(onPaste)} disabled={!canPaste} shortcut="Ctrl Shift V">Paste Adjustments</MenuItem>
          <MenuItem onClick={() => closeAction(onSavePreset)}>Save as Preset...</MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => closeAction(onReset)}>Reset All Adjustments</MenuItem>
        </div>}
      </div>
      <IconButton label="Hide editing inspector" className="inspector-close" onClick={onClose}><X size={15} /></IconButton>
    </div>
    <div className="inspector-scroll">{tool === 'adjust' ? <><Histogram data={histogram} photo={photo} /><AdjustmentSection title="Auto Enhance" icon={<Sparkles size={14} />} ml={{ id: 'auto-enhance', kind: 'auto', applied: classicActive, canRevert: classicRevert, onToggle: onAuto, onRevert: onRevertEnhance }} onReset={classicRevert ? onRevertEnhance : undefined} dirty={classicRevert}><p className="inspector-note">Automatically enhance exposure, contrast, and color.</p></AdjustmentSection>{onAutoScene && <AdjustmentSection title="Scene Enhance" icon={<Sparkles size={14} />} ml={{ id: 'scene-enhance', applied: sceneActive, canRevert: sceneRevert, onToggle: onAutoScene, onRevert: onRevertEnhance }} onReset={sceneRevert ? onRevertEnhance : undefined} dirty={sceneRevert}><SceneEnhanceControl edit={edit} /></AdjustmentSection>}{faceAssist && <AdjustmentSection title="Enhance Faces" icon={<ScanFace size={14} />} ml={{ id: 'face-enhance', applied: Boolean(faceAssist.applied), canRevert: Boolean(faceAssist.applied), onToggle: faceAssist.applied ? faceAssist.onClear : faceAssist.onDetect, onRevert: faceAssist.onClear }} onReset={faceAssist.applied ? faceAssist.onClear : undefined} dirty={Boolean(faceAssist.applied)}><FaceEnhanceControl assist={faceAssist} /></AdjustmentSection>}{selectiveAssist && <AdjustmentSection title="Subject & Background" icon={<Layers size={14} />} ml={{ id: 'selective-mask', applied: Boolean(selectiveAssist.applied), canRevert: Boolean(selectiveAssist.applied), onToggle: selectiveAssist.applied ? selectiveAssist.onClear : selectiveAssist.onDetect, onRevert: selectiveAssist.onClear }} onReset={selectiveAssist.applied ? selectiveAssist.onClear : undefined} dirty={Boolean(selectiveAssist.applied)}><SelectiveMaskControl assist={selectiveAssist} /></AdjustmentSection>}{denoiseAssist && <DenoiseSection assist={denoiseAssist} photo={photo} />}
      <AdjustmentSection title="White Balance" icon={<Thermometer size={14} />} ml={{ id: 'white-balance', applied: Boolean(mlApplied?.whiteBalance), canRevert: Boolean(mlRevert?.whiteBalance), onToggle: onAutoWhiteBalance, onRevert: onRevertWhiteBalance }} onReset={() => onChange({ temperature: 5500, tint: 0 })} dirty={edit.temperature !== 5500 || edit.tint !== 0}>
        {rangeEnabled('whiteBalanceEnabled', 'temperature', 'Temperature', { min: 2000, max: 10000, step: 50, defaultValue: 5500, suffix: 'K', color: 'temperature', signed: false })}
        {rangeEnabled('whiteBalanceEnabled', 'tint', 'Tint', { color: 'tint' })}
      </AdjustmentSection>
      <AdjustmentSection title="Lightness" icon={<Sun size={15} />} ml={{ id: 'lightness', applied: Boolean(mlApplied?.lightness), canRevert: Boolean(mlRevert?.lightness), onToggle: onAutoLightness, onRevert: onRevertLightness }} onReset={() => onChange({ exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, blacks: 0 })} dirty={edit.exposure !== 0 || edit.brightness !== 0 || edit.contrast !== 0 || edit.highlights !== 0 || edit.shadows !== 0 || edit.blacks !== 0}>
        {rangeEnabled('lightnessEnabled', 'exposure', 'Exposure', { min: -3, max: 3, step: 0.01 })}
        {rangeEnabled('lightnessEnabled', 'brightness', 'Brightness')}
        {rangeEnabled('lightnessEnabled', 'contrast', 'Contrast')}
        {rangeEnabled('lightnessEnabled', 'highlights', 'Highlights')}
        {rangeEnabled('lightnessEnabled', 'shadows', 'Shadows')}
        {rangeEnabled('lightnessEnabled', 'blacks', 'Black Point')}
      </AdjustmentSection>
      <AdjustmentSection title="Hue & Saturation" icon={<Palette size={14} />} ml={{ id: 'color', applied: Boolean(mlApplied?.color), canRevert: Boolean(mlRevert?.color), onToggle: onAutoColor, onRevert: onRevertColor }} onReset={() => onChange({ hue: 0, saturation: 0, vibrance: 0 })} dirty={edit.hue !== 0 || edit.saturation !== 0 || edit.vibrance !== 0}>
        {rangeEnabled('colorEnabled', 'saturation', 'Saturation')}
        {rangeEnabled('colorEnabled', 'vibrance', 'Vibrance')}
        {rangeEnabled('colorEnabled', 'hue', 'Hue', { min: -180, max: 180, color: 'hue' })}
      </AdjustmentSection>
      <AdjustmentSection key={`curves-${openedExtra === 'Curves' ? extraRevision : 0}`} title="Curves" icon={<Spline size={14} />} initiallyOpen={openedExtra === 'Curves'} onReset={() => onChange({ curve: 0 })} dirty={edit.curve !== 0}>
        <div className="curve-graph"><span>RGB</span><svg viewBox="0 0 240 160" aria-label="Interactive tone curve" role="slider" tabIndex={0} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={edit.curve} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); onChange({ curve: Math.max(-100, Math.min(100, (0.5 - (event.clientY - rect.top) / rect.height) * 200)) }, 'curve'); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.getBoundingClientRect(); onChange({ curve: Math.max(-100, Math.min(100, (0.5 - (event.clientY - rect.top) / rect.height) * 200)) }, 'curve'); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onChange({ curve: Math.max(-100, Math.min(100, edit.curve + (event.key === 'ArrowUp' ? 5 : -5))) }, 'curve'); } }}><g className="curve-grid">{[60, 120, 180].map((x) => <path key={x} d={`M${x} 0V160`} />)}{[40, 80, 120].map((y) => <path key={y} d={`M0 ${y}H240`} />)}</g><path d="M0 160L240 0" stroke="#555" strokeDasharray="3 4" /><path d={`M0 160Q120 ${80 - edit.curve * 0.8} 240 0`} fill="none" stroke="#e4c67d" strokeWidth="2" /><circle cx="120" cy={80 - edit.curve * 0.4} r="4" fill="#f3d492" /></svg></div>{range('curve', 'Midtones')}
      </AdjustmentSection>
      <AdjustmentSection key={`details-${openedExtra === 'Details' ? extraRevision : 0}`} title="Details" icon={<Focus size={14} />} initiallyOpen={openedExtra === 'Details'} onReset={() => onChange({ clarity: 0, sharpness: 0, grain: 0 })} dirty={edit.clarity !== 0 || edit.sharpness !== 0 || edit.grain !== 0}>
        {rangeEnabled('detailsEnabled', 'clarity', 'Clarity')}{rangeEnabled('detailsEnabled', 'sharpness', 'Sharpness', { min: 0 })}{rangeEnabled('detailsEnabled', 'grain', 'Grain', { min: 0 })}
      </AdjustmentSection>
      <AdjustmentSection key={`effects-${openedExtra === 'Effects' ? extraRevision : 0}`} title="Effects" icon={<CircleDashed size={14} />} initiallyOpen={openedExtra === 'Effects'} onReset={() => onChange({ vignette: 0, fade: 0 })} dirty={edit.vignette !== 0 || edit.fade !== 0}>
        {range('vignette', 'Vignette', { min: 0 })}{range('fade', 'Fade', { min: 0 })}
      </AdjustmentSection>
      {extraSections.includes('Black & White') && <AdjustmentSection title="Black & White" icon={<Contrast size={14} />} enabled={edit.blackAndWhite} toggleLabel="Enable black & white" onToggle={() => onChange({ blackAndWhite: !edit.blackAndWhite })}><p className="inspector-note">A timeless look, without the distraction of color.</p><button className="secondary-button full-width" onClick={() => onChange({ blackAndWhite: !edit.blackAndWhite })}>{edit.blackAndWhite ? 'Restore Color' : 'Make Black & White'}</button></AdjustmentSection>}
      <div className="inspector-end-note"><Circle size={10} />Every change. Always reversible.</div>
    </> : tool === 'crop' ? <div className="tool-inspector crop-inspector"><div className="tool-intro"><Crop size={28} strokeWidth={1.3} /><h3>A fresh point of view.</h3><p>Find the right balance. Keep the best bits.</p></div><SelectField label="Aspect Ratio" value={edit.cropRatio} options={Object.keys(CROP_RATIOS).map((ratio) => ({ value: ratio, label: ratio === 'Original' ? 'Original proportions' : ratio }))} onChange={(cropRatio) => onChange({ cropRatio })} /><div className="ratio-presets">{['Original', '1:1', '4:3', '16:9'].map((ratio) => <button key={ratio} className={edit.cropRatio === ratio ? 'is-active' : ''} onClick={() => onChange({ cropRatio: ratio })}><span style={{ aspectRatio: CROP_RATIOS[ratio] || 1.5 }} />{ratio}</button>)}</div><div className="tool-divider" /><h4>Rotate & Flip</h4><div className="transform-buttons"><button title="Rotate left 90 degrees" onClick={() => onRotate(-1)}><RotateCcw size={18} /><span>Left</span></button><button title="Rotate right 90 degrees" onClick={() => onRotate(1)}><RotateCw size={18} /><span>Right</span></button><button className={edit.flipH ? 'is-active' : ''} title="Flip horizontally" onClick={() => onChange({ flipH: !edit.flipH })}><FlipHorizontal2 size={18} /><span>Horizontal</span></button><button className={edit.flipV ? 'is-active' : ''} title="Flip vertically" onClick={() => onChange({ flipV: !edit.flipV })}><FlipVertical2 size={18} /><span>Vertical</span></button></div>{straightenAssist ? <StraightenControl value={edit.straighten} assist={straightenAssist} onStraighten={onStraighten} onDraggingChange={onStraightenDragging} /> : <RangeControl label="Straighten" value={edit.straighten} min={-15} max={15} step={0.1} suffix="deg" signed onDraggingChange={onStraightenDragging} onChange={(next) => onStraighten(next, 'straighten')} />}<p className="inspector-note">Cropping is non-destructive. Your original photo is always kept safe.</p></div> : <><AdjustmentSection title="Brush" icon={<Brush size={14} />}><RangeControl label="Brush Size" value={brushSize} min={5} max={160} defaultValue={45} suffix="px" testId="brush-size" onChange={onBrushSize} /><RangeControl label="Strength" value={brushStrength} min={1} max={100} defaultValue={100} suffix="%" testId="brush-strength" onChange={onBrushStrength} /></AdjustmentSection>{repairAssist && <AdjustmentSection title="Reconstruction" icon={<Layers size={14} />}><RepairMethodControl assist={repairAssist} /></AdjustmentSection>}{repairAssist?.removal && <RemovalSection assist={repairAssist.removal} />}{repairAssist?.dustSpots && <DustSpotsSection assist={repairAssist.dustSpots} />}<AdjustmentSection title="Repairs" icon={<Bandage size={14} />}><RetouchGroups edit={edit} highlightStroke={highlightStroke} onHighlightStroke={onHighlightStroke} onChange={onChange} /></AdjustmentSection></>}</div>
    {tool === 'adjust' && <div className="inspector-footer" ref={addMenuRef}><button className="add-adjustment" onClick={() => setAddMenu(!addMenu)} aria-expanded={addMenu}>Add Adjustment<ChevronDown size={12} /></button>{addMenu && <div className="dropdown-menu add-adjustment-menu" role="menu">{['Black & White'].filter((name) => !extraSections.includes(name)).map((name) => <MenuItem key={name} onClick={() => addSection(name)}>{name}</MenuItem>)}{!extraSections.includes('Black & White') && <MenuSeparator />}<MenuItem onClick={() => { onSavePreset(); setAddMenu(false); }}>Save as Preset...</MenuItem></div>}</div>}
  </aside>;
}