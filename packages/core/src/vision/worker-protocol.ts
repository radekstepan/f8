// Typed messages for the vision worker.
//
// The worker itself lives in apps/web (Vite bundles it); this module is the
// shared, framework-free contract. Messages are plain data plus
// Uint8ClampedArray buffers, so they survive structured-clone transport
// unchanged.

import { assertValidImage, type PixelImage } from "./analyze.js";
import { assertValidMask, type InpaintMethod, type RepairMask } from "./inpaint.js";

export type VisionRequestId = number;

export interface PingRequest {
  id: VisionRequestId;
  kind: "ping";
}

export interface GrayscaleRequest {
  id: VisionRequestId;
  kind: "grayscale";
  width: number;
  height: number;
  /** Row-major RGBA, width * height * 4 bytes. */
  data: Uint8ClampedArray;
}

export interface StraightenRequest {
  id: VisionRequestId;
  kind: "straighten";
  width: number;
  height: number;
  /** Row-major RGBA, width * height * 4 bytes. */
  data: Uint8ClampedArray;
}

export interface InpaintRequest {
  id: VisionRequestId;
  kind: "inpaint";
  width: number;
  height: number;
  /** Row-major RGBA, width * height * 4 bytes. */
  data: Uint8ClampedArray;
  /** Single-channel repair mask, width * height bytes (0 = keep). */
  mask: Uint8ClampedArray;
  /** cv.inpaint neighbourhood radius in pixels. */
  radius: number;
  method: InpaintMethod;
}

export type VisionWorkerRequest = PingRequest | GrayscaleRequest | StraightenRequest | InpaintRequest;

export interface PongResponse {
  id: VisionRequestId;
  kind: "pong";
  /** OpenCV version reported by the worker, e.g. "5.0.0". */
  version: string;
}

export interface GrayscaleResponse {
  id: VisionRequestId;
  kind: "grayscale";
  width: number;
  height: number;
  /** Single-channel luma, width * height bytes. */
  data: Uint8ClampedArray;
}

export interface StraightenResponse {
  id: VisionRequestId;
  kind: "straighten";
  /** Suggested EditState.straighten value in degrees, within [-15, 15]. */
  angle: number;
  /** Confidence in the suggestion, 0..1. */
  confidence: number;
}

export interface InpaintResponse {
  id: VisionRequestId;
  kind: "inpaint";
  width: number;
  height: number;
  /** Row-major RGBA, width * height * 4 bytes; alpha restored from the input. */
  data: Uint8ClampedArray;
}

export interface VisionErrorResponse {
  id: VisionRequestId;
  kind: "error";
  message: string;
}

export type VisionWorkerResponse =
  | PongResponse
  | GrayscaleResponse
  | StraightenResponse
  | InpaintResponse
  | VisionErrorResponse;

export function createPingRequest(id: VisionRequestId): PingRequest {
  return { id, kind: "ping" };
}

export function createGrayscaleRequest(id: VisionRequestId, image: PixelImage): GrayscaleRequest {
  assertValidImage(image);
  return { id, kind: "grayscale", width: image.width, height: image.height, data: image.data };
}

export function createStraightenRequest(id: VisionRequestId, image: PixelImage): StraightenRequest {
  assertValidImage(image);
  return { id, kind: "straighten", width: image.width, height: image.height, data: image.data };
}

export function createInpaintRequest(
  id: VisionRequestId,
  image: PixelImage,
  mask: RepairMask,
  radius: number,
  method: InpaintMethod,
): InpaintRequest {
  assertValidImage(image);
  assertValidMask(mask);
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new RangeError(
      `Inpaint image (${image.width}x${image.height}) and mask (${mask.width}x${mask.height}) must match.`,
    );
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`Expected a positive inpaint radius, got ${radius}.`);
  }
  if (method !== "telea" && method !== "ns" && method !== "heal") {
    throw new RangeError(`Unknown inpaint method: ${String(method)}.`);
  }
  return {
    id,
    kind: "inpaint",
    width: image.width,
    height: image.height,
    data: image.data,
    mask: mask.data,
    radius,
    method,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isId(value: unknown): value is VisionRequestId {
  return typeof value === "number" && Number.isInteger(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPixelBuffer(value: unknown, length: number): value is Uint8ClampedArray {
  return value instanceof Uint8ClampedArray && value.length === length;
}

function isImageRequest(value: Record<string, unknown>): boolean {
  return (
    isPositiveInt(value.width) &&
    isPositiveInt(value.height) &&
    isPixelBuffer(value.data, (value.width as number) * (value.height as number) * 4)
  );
}

export function isVisionWorkerRequest(value: unknown): value is VisionWorkerRequest {
  if (!isRecord(value) || !isId(value.id)) return false;
  if (value.kind === "ping") return true;
  if (value.kind === "grayscale" || value.kind === "straighten") return isImageRequest(value);
  if (value.kind === "inpaint") {
    return (
      isImageRequest(value) &&
      isPixelBuffer(value.mask, (value.width as number) * (value.height as number)) &&
      isPositiveNumber(value.radius) &&
      (value.method === "telea" || value.method === "ns" || value.method === "heal")
    );
  }
  return false;
}

export function isVisionWorkerResponse(value: unknown): value is VisionWorkerResponse {
  if (!isRecord(value) || !isId(value.id)) return false;
  if (value.kind === "pong") return typeof value.version === "string";
  if (value.kind === "grayscale") {
    return (
      isPositiveInt(value.width) &&
      isPositiveInt(value.height) &&
      isPixelBuffer(value.data, (value.width as number) * (value.height as number))
    );
  }
  if (value.kind === "straighten") {
    return (
      typeof value.angle === "number" &&
      Number.isFinite(value.angle) &&
      typeof value.confidence === "number" &&
      Number.isFinite(value.confidence) &&
      (value.confidence as number) >= 0 &&
      (value.confidence as number) <= 1
    );
  }
  if (value.kind === "inpaint") {
    return (
      isPositiveInt(value.width) &&
      isPositiveInt(value.height) &&
      isPixelBuffer(value.data, (value.width as number) * (value.height as number) * 4)
    );
  }
  if (value.kind === "error") return typeof value.message === "string";
  return false;
}

/**
 * BT.601 luma per pixel: round(0.299 R + 0.587 G + 0.114 B), alpha ignored.
 * Matches OpenCV COLOR_RGBA2GRAY within +-1 (integer rounding); the worker
 * is the source of truth, this is the documented fallback formula and the
 * test oracle.
 */
export function grayscaleReference(image: PixelImage): Uint8ClampedArray {
  assertValidImage(image);
  const out = new Uint8ClampedArray(image.width * image.height);
  for (let i = 0, p = 0; i < image.data.length; i += 4, p += 1) {
    const r = image.data[i] ?? 0;
    const g = image.data[i + 1] ?? 0;
    const b = image.data[i + 2] ?? 0;
    out[p] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}
