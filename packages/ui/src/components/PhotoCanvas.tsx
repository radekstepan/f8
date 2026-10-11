import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronsLeftRight, Columns2, Heart, ImageOff, Info, Maximize, Minus, Plus, Star } from 'lucide-react';
import { DEFAULT_EDIT } from '@photomator/core';
import { applyInpaintRepair, drawEffects, geometryCanvas, loadImage, nextRetouchStrokeId, renderAdjustedCanvas, strokeIdForPoint } from '@photomator/core';
import type { ChangeEdit, EditState, Photo, RepairInpaintBinding, RetouchPoint, RunInpaint, Tool } from '@photomator/core';
import { IconButton } from './EditorUI.js';

export type HistogramData = { red: number[]; green: number[]; blue: number[] };

interface PhotoCanvasProps {
  photo: Photo;
  edit: EditState;
  tool: Tool;
  zoom: number;
  compare: boolean;
  showOriginal: boolean;
  brushSize: number;
  brushStrength: number;
  /** Worker inpainting for repair strokes; absent means blur repair only. */
  inpaintRepair?: RepairInpaintBinding | null;
  /** Stroke group highlighted from the inspector list (red overlay). */
  highlightStroke?: number | null;
  onHighlightStroke?: (stroke: number | null) => void;
  onZoom: (zoom: number) => void;
  onCompare: () => void;
  onFavorite: () => void;
  onRating: (rating: number) => void;
  onInfo: () => void;
  onChange: ChangeEdit;
  onHistogram: (data: HistogramData) => void;
}

export function PhotoCanvas({ photo, edit, tool, zoom, compare, showOriginal, brushSize, brushStrength, inpaintRepair, highlightStroke = null, onHighlightStroke, onZoom, onCompare, onFavorite, onRating, onInfo, onChange, onHistogram }: PhotoCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const points = useRef<RetouchPoint[]>([]);
  const cloneSource = useRef<{ x: number; y: number } | null>(null);
  const cloneStart = useRef<{ x: number; y: number } | null>(null);
  const lastStamp = useRef<{ x: number; y: number } | null>(null);
  const strokeCounter = useRef(1);
  const activeStrokeRef = useRef<number | null>(null);
  const [activeStroke, setActiveStroke] = useState<number | null>(null);
  const repairGeneration = useRef(0);
  const inpaintRun = useRef<RunInpaint | null>(null);
  inpaintRun.current = inpaintRepair?.run ?? null;
  const [stageSize, setStageSize] = useState({ width: 800, height: 520 });
  const [aspect, setAspect] = useState(1200 / 627);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [split, setSplit] = useState(50);
  const [sourceSet, setSourceSet] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const isBrush = tool === 'repair' || tool === 'clone';

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setLoading(true); setError(''); cloneSource.current = null; setSourceSet(false); strokeCounter.current = 1; activeStrokeRef.current = null; setActiveStroke(null); }, [photo.src, retry]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    loadImage(photo.src).then((image) => {
      if (cancelled || !canvasRef.current || !originalRef.current) return;
      const renderBase = (base: HTMLCanvasElement) => {
        const canvas = canvasRef.current!;
        const adjusted = renderAdjustedCanvas(base, edit);
        canvas.width = adjusted.width;
        canvas.height = adjusted.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(adjusted, 0, 0);
        drawEffects(ctx, adjusted.width, adjusted.height, edit);
        setAspect(adjusted.width / adjusted.height);

        const sampler = document.createElement('canvas');
        sampler.width = 160;
        sampler.height = 100;
        const sampleCtx = sampler.getContext('2d', { willReadFrequently: true })!;
        sampleCtx.drawImage(canvas, 0, 0, 160, 100);
        const pixels = sampleCtx.getImageData(0, 0, 160, 100).data;
        const histogram: HistogramData = { red: Array(64).fill(0), green: Array(64).fill(0), blue: Array(64).fill(0) };
        for (let i = 0; i < pixels.length; i += 4) {
          const r = (pixels[i] ?? 0) >> 2;
          const g = (pixels[i + 1] ?? 0) >> 2;
          const b = (pixels[i + 2] ?? 0) >> 2;
          histogram.red[r] = (histogram.red[r] ?? 0) + 1;
          histogram.green[g] = (histogram.green[g] ?? 0) + 1;
          histogram.blue[b] = (histogram.blue[b] ?? 0) + 1;
        }
        onHistogram(histogram);
      };
      // While a repair stroke is being painted every repair stamp stays out
      // of the canvas: the red mask overlay shows all repair areas live
      // instead of the blur placeholder, which appears only after release
      // (then inpainting upgrades it).
      const paintingRepair = tool === 'repair' && activeStroke !== null;
      const previewEdit = paintingRepair ? { ...edit, retouches: edit.retouches.filter((point) => point.kind !== 'repair') } : edit;
      renderBase(geometryCanvas(image, previewEdit));
      const original = geometryCanvas(image, { ...DEFAULT_EDIT, cropRatio: edit.cropRatio, rotation: edit.rotation, flipH: edit.flipH, flipV: edit.flipV, straighten: edit.straighten });
      originalRef.current.width = original.width;
      originalRef.current.height = original.height;
      originalRef.current.getContext('2d')!.drawImage(original, 0, 0);
      setLoading(false);

      // Upgrade repair strokes from the blur fallback to worker inpainting,
      // debounced so a painting stroke doesn't flood the worker queue. While
      // dragging, all repairs are excluded until release (the red mask shows
      // instead). Failures keep the blur already displayed.
      const repairs = previewEdit.retouches.filter((point) => point.kind === 'repair');
      const run = inpaintRun.current;
      const method = inpaintRepair?.method;
      // Distinct heal groups (strokes) covered by this pass, for progress
      // copy ("Healing 3 areas…"). Points share a stroke id per drag.
      const areas = new Set(repairs.map((point) => strokeIdForPoint(point))).size;
      const repairOptions = {
        quality: inpaintRepair?.quality,
        seamlessLight: inpaintRepair?.seamlessLight,
        featherPx: inpaintRepair?.featherPx,
        areas,
      };
      if (repairs.length && run && method) {
        const generation = repairGeneration.current + 1;
        repairGeneration.current = generation;
        timer = window.setTimeout(() => {
          if (cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
          const clean = geometryCanvas(image, { ...previewEdit, retouches: previewEdit.retouches.filter((point) => point.kind !== 'repair') });
          void applyInpaintRepair(clean, repairs, method, run, repairOptions).then((applied) => {
            if (!applied || cancelled || repairGeneration.current !== generation || !canvasRef.current) return;
            renderBase(clean);
          }).catch(() => { /* Blur fallback already displayed. */ });
        }, 300);
      }
    }).catch((reason: Error) => { if (!cancelled) { setError(reason.message); setLoading(false); } });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [photo.src, edit, tool, activeStroke, onHistogram, retry, inpaintRepair?.method, inpaintRepair?.quality, inpaintRepair?.seamlessLight, inpaintRepair?.featherPx, inpaintRepair?.status]);

  const fitWidth = Math.max(100, Math.min(stageSize.width - 64, (stageSize.height - 48) * aspect));
  const frameWidth = fitWidth * zoom;

  const positionFromClient = (clientX: number, clientY: number) => {
    const rect = frameRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) };
  };

  const position = (event: ReactPointerEvent) => positionFromClient(event.clientX, event.clientY);

  /** Pen pressure shrinks the stamp; mouse and touch always paint full size. */
  const stampSize = (native: { pointerType?: string; pressure?: number }) => {
    const base = brushSize / 800;
    if (native.pointerType === 'pen' && typeof native.pressure === 'number' && native.pressure > 0) {
      return base * (0.4 + 0.6 * Math.min(1, native.pressure));
    }
    return base;
  };

  const stampAt = (point: { x: number; y: number }, size: number) => {
    const next: RetouchPoint = { ...point, size, strength: brushStrength, kind: tool === 'clone' ? 'clone' : 'repair', stroke: activeStrokeRef.current ?? undefined };
    if (tool === 'clone' && cloneSource.current && cloneStart.current) {
      next.sourceX = Math.max(0, Math.min(1, cloneSource.current.x + point.x - cloneStart.current.x));
      next.sourceY = Math.max(0, Math.min(1, cloneSource.current.y + point.y - cloneStart.current.y));
    }
    points.current = [...points.current, next];
  };

  const paint = (event: ReactPointerEvent) => {
    if (tool === 'clone' && (!cloneSource.current || !cloneStart.current)) return;
    // Coalesced events recover the pointer positions the browser merged
    // between frames, so fast strokes stay continuous.
    const native = event.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const samples = native.getCoalescedEvents && native.getCoalescedEvents().length
      ? native.getCoalescedEvents()
      : [native];
    for (const sample of samples) {
      const point = positionFromClient(sample.clientX, sample.clientY);
      const size = stampSize(sample);
      // Interpolate between stamps so discs always overlap: without this,
      // fast drags leave dotted gaps the mask rasterizer keeps.
      const last = lastStamp.current;
      const spacing = Math.max(1e-4, size / 2);
      if (last) {
        const dist = Math.hypot(point.x - last.x, point.y - last.y);
        const steps = Math.max(1, Math.min(64, Math.ceil(dist / spacing)));
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          stampAt({ x: last.x + (point.x - last.x) * t, y: last.y + (point.y - last.y) * t }, size);
        }
      } else {
        stampAt(point, size);
      }
      lastStamp.current = point;
    }
    onChange({ retouches: points.current }, 'retouch-stroke');
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isBrush || compare || showOriginal) return;
    if (tool === 'clone' && (event.altKey || !cloneSource.current)) { cloneSource.current = position(event); setSourceSet(true); return; }
    points.current = [...edit.retouches];
    painting.current = true;
    const id = Math.max(nextRetouchStrokeId(edit.retouches), strokeCounter.current);
    strokeCounter.current = id + 1;
    activeStrokeRef.current = id;
    setActiveStroke(id);
    cloneStart.current = position(event);
    lastStamp.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    paint(event);
  };

  const endStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    painting.current = false;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  /** Topmost stroke group under the cursor, for hover highlighting. */
  const strokeAt = (point: { x: number; y: number }, frameHeight: number, frameWidth: number) => {
    for (let i = edit.retouches.length - 1; i >= 0; i -= 1) {
      const stamp = edit.retouches[i];
      if (!stamp) continue;
      const dx = (point.x - stamp.x) * frameWidth;
      const dy = (point.y - stamp.y) * frameHeight;
      if (Math.hypot(dx, dy) <= (stamp.size * frameWidth) / 2) return strokeIdForPoint(stamp);
    }
    return null;
  };

  const frameHeight = frameWidth / aspect;
  const showOverlay = isBrush && !loading && !compare && !showOriginal;
  const draggingRepair = showOverlay && tool === 'repair' && activeStroke !== null;
  // While dragging, every repair area shows red — not just the new stroke —
  // so the single worker pass over all areas is visible. Otherwise red
  // appears only for the hovered heal group (canvas or inspector list):
  // past work stays unobscured until inspected.
  const activePoints = draggingRepair
    ? edit.retouches.filter((point) => point.kind === 'repair')
    : [];
  const hoverPoints = showOverlay && activeStroke === null && highlightStroke !== null
    ? edit.retouches.filter((point) => strokeIdForPoint(point) === highlightStroke)
    : [];
  const maskCircle = (point: RetouchPoint, key: string) => (
    <circle key={key} cx={point.x * frameWidth} cy={point.y * frameHeight} r={Math.max(1, (point.size * frameWidth) / 2)} />
  );

  return <section className="photo-workspace" aria-label="Photo editor"><div className="photo-heading"><div className="photo-filename">{photo.name}<span className="file-type">{photo.raw ? 'RAW' : 'JPEG'}</span>{edit.preset !== 'Original' && <span className="edited-indicator">Edited</span>}</div><div className="photo-rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} aria-label={`Rate ${value} stars`} title={`Rate ${value} stars`} onClick={() => onRating(photo.rating === value ? 0 : value)}><Star size={11} fill={photo.rating >= value ? 'currentColor' : 'none'} className={photo.rating >= value ? 'rated' : ''} /></button>)}<span className="heading-divider" /><IconButton label={photo.favorite ? 'Remove from favorites (F)' : 'Add to favorites (F)'} active={photo.favorite} onClick={onFavorite}><Heart size={15} fill={photo.favorite ? 'currentColor' : 'none'} strokeWidth={1.5} /></IconButton></div></div><div className="canvas-stage" ref={stageRef}><div className="canvas-stage-inner"><div className={`photo-frame ${isBrush ? 'brush-active' : ''} ${loading ? 'is-loading' : ''}`} ref={frameRef} style={{ width: frameWidth, height: frameHeight }} onPointerDown={pointerDown} onPointerMove={(event) => { if (isBrush) { const point = position(event); setCursor({ x: point.x * frameWidth, y: point.y * frameHeight }); if (!painting.current && onHighlightStroke && !compare && !showOriginal) { const found = strokeAt(point, frameHeight, frameWidth); if (found !== highlightStroke) onHighlightStroke(found); } } if (painting.current) paint(event); }} onPointerUp={endStroke} onPointerCancel={endStroke} onPointerLeave={() => { setCursor(null); if (!painting.current && highlightStroke !== null) onHighlightStroke?.(null); }}>
      <canvas className="edited-canvas" ref={canvasRef} role="img" aria-label={`${photo.title}, with current adjustments`} />
      <div className="original-layer" style={{ clipPath: `inset(0 ${showOriginal ? 0 : compare ? 100 - split : 100}% 0 0)` }}><canvas ref={originalRef} role="img" aria-label="Original photo" /></div>
      {loading && <div className="photo-loading"><span className="loading-spinner" /><span>Developing your photo...</span></div>}
      {error && <div className="photo-error"><ImageOff size={28} /><p>{error}</p><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
      {compare && !showOriginal && !loading && <><span className="comparison-label original-label">Original</span><span className="comparison-label edited-label">Edited</span><div className="comparison-divider" role="slider" aria-label="Before and after comparison" aria-valuemin={2} aria-valuemax={98} aria-valuenow={Math.round(split)} tabIndex={0} style={{ left: `${split}%` }} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSplit(Math.max(2, Math.min(98, position(event).x * 100))); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); setSplit((value) => Math.max(2, Math.min(98, value + (event.key === 'ArrowRight' ? 2 : -2)))); } }}><span><ChevronsLeftRight size={17} /></span></div></>}
      {showOriginal && <span className="comparison-label original-label">Original</span>}
      {tool === 'crop' && !loading && <div className="crop-grid" aria-hidden="true"><i /><i /><i /><i /></div>}
      {isBrush && cursor && !showOriginal && <div className={`brush-cursor${compare ? ' is-compare' : ''}`} style={{ left: cursor.x, top: cursor.y, width: brushSize / 800 * frameWidth, height: brushSize / 800 * frameWidth }} />}
      {(activePoints.length > 0 || hoverPoints.length > 0) && <svg className="retouch-overlay" viewBox={`0 0 ${frameWidth} ${frameHeight}`} aria-hidden="true">{hoverPoints.length > 0 && <g className="retouch-highlight-group">{hoverPoints.map((point, index) => maskCircle(point, `h-${index}`))}</g>}{activePoints.length > 0 && <g className="retouch-active-group">{activePoints.map((point, index) => maskCircle(point, `a-${index}`))}</g>}</svg>}
    </div></div>
      {isBrush && <div className="tool-hint">{tool === 'clone' ? sourceSet ? 'Click and drag to clone. Alt-click to change the source.' : 'Click the photo to choose a clone source.' : compare ? 'Comparing — turn off Compare to keep repairing.' : 'Click and drag to repair — hover a repair in the list to locate it.'}</div>}
    </div>
    <div className="canvas-status">
      <button className="canvas-dimensions" onClick={onInfo} title="Photo information">
        <Info size={12} />
        <span>{photo.width.toLocaleString()} <span className="dimension-x">x</span> {photo.height.toLocaleString()} px</span>
        <span className="dimension-separator" />{Math.round(photo.width * photo.height / 1000000)} MP
      </button>
      <button className={`compare-button ${compare ? 'is-active' : ''}`} onClick={onCompare} title="Compare with original (B)">
        <Columns2 size={14} /><span>Compare</span><kbd>B</kbd>
      </button>
      <div className="zoom-controls">
        <IconButton label="Zoom out (-)" disabled={zoom <= 0.5} onClick={() => onZoom(Math.max(0.5, zoom - 0.25))}><Minus size={13} /></IconButton>
        <select aria-label="Zoom level" value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>
          {Array.from({ length: 11 }, (_, index) => 0.5 + index * 0.25).map((value) => <option key={value} value={value}>{value === 1 ? 'Fit' : `${value * 100}%`}</option>)}
        </select>
        <IconButton label="Zoom in (+)" disabled={zoom >= 3} onClick={() => onZoom(Math.min(3, zoom + 0.25))}><Plus size={13} /></IconButton>
        <IconButton label="Zoom to fit (0)" onClick={() => onZoom(1)}><Maximize size={13} /></IconButton>
      </div>
    </div>
  </section>;
}