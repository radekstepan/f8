// Pre-export file-size estimate for the export dialog.
//
// The estimate runs the real export pipeline — renderExportCanvas at the
// selected size, then encodeExportCanvas with the selected format/quality —
// and reports the encoded blob's byte size. Accuracy follows by
// construction: identical pixels through the identical browser encoder
// produce identical bytes, so the number matches the eventual download
// exactly, modulo two documented exceptions:
//
// 1. Repair strokes estimate with the blur fallback (no worker inpaint
//    binding is passed), while the real export heals them through the
//    worker. The pixel difference is confined to the small repair regions,
//    so the size delta is negligible — and it keeps the estimate off the
//    (potentially ML-backed, slow) heal path.
// 2. Super-resolution 2x upscales are excluded: the final pixels only exist
//    after the server ML run, so no pre-export number can be accurate. The
//    dialog shows an "unavailable" note instead of a misleading figure.

import { encodeExportCanvas, renderExportCanvas } from "./image.js";
import type { EditState } from "./types.js";

// Human-readable byte count for the estimate line: whole bytes below 1 KB,
// one decimal below 100 units, whole units above ("842 B", "1.2 MB").
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export interface ExportEstimate {
  /** Encoded byte size — the eventual download size, modulo repair pixels. */
  bytes: number;
  /** Export canvas dimensions after geometry (rotation/crop/resize). */
  width: number;
  height: number;
}

/**
 * Seams for the estimate's pipeline stages. Production callers omit this and
 * get the real render + encode; tests inject fakes (core tests run in node,
 * where the DOM pipeline cannot execute).
 */
export interface ExportEstimateDeps {
  render: typeof renderExportCanvas;
  encode: typeof encodeExportCanvas;
}

export async function estimateExportBytes(
  src: string,
  edit: EditState,
  format: string,
  quality: number,
  maxSize: number,
  deps?: ExportEstimateDeps,
): Promise<ExportEstimate> {
  const render = deps?.render ?? renderExportCanvas;
  const encode = deps?.encode ?? encodeExportCanvas;
  // Deliberately no repair binding: the blur fallback keeps the estimate off
  // the worker heal path (see the module note); repairs barely move the size.
  const canvas = await render(src, edit, maxSize);
  const blob = await encode(canvas, format, quality);
  return { bytes: blob.size, width: canvas.width, height: canvas.height };
}
