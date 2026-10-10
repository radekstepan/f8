import { CROP_RATIOS } from './data.js';
import type { EditState } from './types.js';
import type { PixelImage } from './vision/analyze.js';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => { imageCache.delete(src); reject(new Error('This photo could not be loaded. Check your connection and try again.')); };
      image.src = src;
    }));
  }
  return imageCache.get(src)!;
}

export interface ImportSize {
  width: number;
  height: number;
}

// Decode an imported file with the browser's own EXIF handling so portrait
// phone photos report upright dimensions. The returned size is orientation 1;
// every later decode of the same blob URL (<img> auto-orients for display)
// sees the same upright pixels, so the rest of this pipeline must not rotate
// for EXIF again. Falls back to <img> when createImageBitmap is unavailable
// or rejects the options argument (older decoders).
export async function decodeImportSize(file: Blob, fallbackSrc: string): Promise<ImportSize> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch { /* Fall through to the <img> decode below. */ }
  }
  const image = await loadImage(fallbackSrc);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

// Decode to a small pixel buffer for analysis (histograms, auto-enhance).
// Throws if the image cannot be decoded or its pixels are unreadable
// (e.g. a canvas tainted by missing CORS headers); callers must catch
// and fall back instead of breaking the editor.
export async function decodeDownsampled(src: string, maxDimension = 160): Promise<PixelImage> {
  const image = await loadImage(src);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8ClampedArray(pixels.data) };
}

// The preview and exported image share the same filter mapping.
// These lightweight browser adjustments are not a RAW or machine-learning engine.
export function getPhotoFilter(edit: EditState): string {
  const brightness = edit.lightnessEnabled
    ? Math.max(0.08, Math.pow(2, edit.exposure * 0.6) * (1 + edit.brightness / 100) * (1 + edit.shadows / 650 + edit.highlights / 1000)) : 1;
  const contrast = edit.lightnessEnabled ? Math.max(0.1, 1 + edit.contrast / 125 - edit.blacks / 400 + edit.curve / 250) : 1;
  const saturation = edit.colorEnabled ? Math.max(0, 1 + (edit.saturation + edit.vibrance * 0.6) / 100) : 1;
  const warmth = edit.whiteBalanceEnabled ? (edit.temperature - 5500) / 14000 : 0;
  const hue = (edit.whiteBalanceEnabled ? edit.tint / 4 - warmth * 24 : 0) + (edit.colorEnabled ? edit.hue : 0);
  const detailContrast = edit.detailsEnabled ? edit.clarity / 350 + edit.sharpness / 700 : 0;
  return `brightness(${brightness}) contrast(${Math.max(0.05, contrast + detailContrast)}) saturate(${saturation}) sepia(${Math.max(0, warmth)}) hue-rotate(${hue + Math.min(0, warmth) * 50}deg) grayscale(${edit.blackAndWhite ? 1 : 0})`;
}

// The input image is already upright (orientation 1): imports are decoded
// with imageOrientation: "from-image" and <img> auto-orients EXIF for
// display. Only user edits (rotation/flips/straighten) transform here;
// applying EXIF orientation again would double-rotate portrait photos.
export function geometryCanvas(image: HTMLImageElement, edit: EditState, maxSize = 1800): HTMLCanvasElement {
  const rotated = Math.abs(edit.rotation % 180) === 90;
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const rotatedCanvas = document.createElement('canvas');
  rotatedCanvas.width = rotated ? height : width;
  rotatedCanvas.height = rotated ? width : height;
  const ctx = rotatedCanvas.getContext('2d')!;
  ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  ctx.rotate((edit.rotation + edit.straighten) * Math.PI / 180);
  ctx.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  const straightenScale = 1 + Math.abs(Math.sin(edit.straighten * Math.PI / 180)) * Math.max(width / height, height / width);
  ctx.scale(straightenScale, straightenScale);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);

  const ratio = CROP_RATIOS[edit.cropRatio];
  let cropWidth = rotatedCanvas.width;
  let cropHeight = rotatedCanvas.height;
  if (ratio) {
    if (cropWidth / cropHeight > ratio) cropWidth = cropHeight * ratio;
    else cropHeight = cropWidth / ratio;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cropWidth);
  canvas.height = Math.round(cropHeight);
  const output = canvas.getContext('2d')!;
  output.drawImage(rotatedCanvas, (rotatedCanvas.width - cropWidth) / 2, (rotatedCanvas.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

  if (edit.retouches.length) {
    const source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    source.getContext('2d')!.drawImage(canvas, 0, 0);
    for (const point of edit.retouches) {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      const radius = point.size * canvas.width / 2;
      output.save();
      output.beginPath();
      output.arc(x, y, radius, 0, Math.PI * 2);
      output.clip();
      output.globalAlpha = point.strength / 100;
      if (point.kind === 'clone') {
        const sx = (point.sourceX ?? point.x) * canvas.width;
        const sy = (point.sourceY ?? point.y) * canvas.height;
        output.drawImage(source, sx - radius, sy - radius, radius * 2, radius * 2, x - radius, y - radius, radius * 2, radius * 2);
      } else {
        output.filter = `blur(${Math.max(2, radius / 3)}px)`;
        output.drawImage(source, 0, 0);
      }
      output.restore();
    }
  }
  return canvas;
}

export function drawEffects(ctx: CanvasRenderingContext2D, width: number, height: number, edit: EditState) {
  if (edit.fade > 0) {
    ctx.fillStyle = `rgba(212, 205, 190, ${edit.fade / 230})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (edit.vignette > 0) {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.15, width / 2, height / 2, Math.max(width, height) * 0.65);
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(1, `rgba(0, 0, 0, ${edit.vignette / 100})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  if (edit.grain > 0 && edit.detailsEnabled) {
    const pixels = ctx.getImageData(0, 0, width, height);
    let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = ((seed / 4294967296) - 0.5) * edit.grain * 0.6;
      pixels.data[i] = (pixels.data[i] ?? 0) + noise;
      pixels.data[i + 1] = (pixels.data[i + 1] ?? 0) + noise;
      pixels.data[i + 2] = (pixels.data[i + 2] ?? 0) + noise;
    }
    ctx.putImageData(pixels, 0, 0);
  }
}

export async function exportPhoto(src: string, edit: EditState, format: string, quality: number, maxSize: number): Promise<Blob> {
  const image = await loadImage(src);
  const base = geometryCanvas(image, edit, maxSize);
  const output = document.createElement('canvas');
  output.width = base.width;
  output.height = base.height;
  const ctx = output.getContext('2d')!;
  ctx.filter = getPhotoFilter(edit);
  ctx.drawImage(base, 0, 0);
  ctx.filter = 'none';
  drawEffects(ctx, output.width, output.height, edit);
  return new Promise((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Your browser could not create the image. Try another format.')), `image/${format}`, quality / 100));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}