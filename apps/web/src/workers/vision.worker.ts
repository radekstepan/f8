// Vision worker: heavy OpenCV work off the main thread.
//
// Loaded lazily by the app (`new Worker(new URL(...))` in visionClient.ts),
// and OpenCV itself loads lazily inside on the first message via dynamic
// import, so the ~13MB Emscripten bundle is only fetched when a vision
// feature runs. The techstark build is single-file (WASM embedded as base64),
// so there is no separate .wasm asset to serve.

import {
  INPAINT_DILATE_PX,
  STRAIGHTEN_CANNY_HIGH,
  STRAIGHTEN_CANNY_LOW,
  STRAIGHTEN_HOUGH_MAX_LINE_GAP,
  STRAIGHTEN_HOUGH_MIN_LINE_LENGTH,
  STRAIGHTEN_HOUGH_THRESHOLD,
  STRAIGHTEN_WORKING_WIDTH,
  dilateRepairMask,
  healRepair,
  inpaintWithCv,
  isVisionWorkerRequest,
  voteStraightenAngle,
  type GrayscaleRequest,
  type InpaintRequest,
  type LineSegment,
  type StraightenRequest,
  type VisionWorkerRequest,
  type VisionWorkerResponse,
} from "@photomator/core";

/** Minimal structural view of the OpenCV.js runtime used by the worker. */
interface OpenCvMat {
  readonly rows: number;
  readonly cols: number;
  readonly data: Uint8Array;
  /** Int32 view over the same buffer; HoughLinesP reports CV_32SC4 rows. */
  readonly data32S: Int32Array;
  delete(): void;
}

interface OpenCvMatConstructor {
  new (): OpenCvMat;
  new (rows: number, cols: number, type: number): OpenCvMat;
}

interface OpenCvSize {
  readonly width: number;
  readonly height: number;
}

interface OpenCvSizeConstructor {
  new (width: number, height: number): OpenCvSize;
}

interface OpenCvApi {
  readonly CV_8UC4: number;
  readonly CV_8UC1: number;
  readonly COLOR_RGBA2GRAY: number;
  readonly COLOR_RGBA2RGB: number;
  readonly COLOR_RGB2RGBA: number;
  readonly INPAINT_TELEA: number;
  readonly INPAINT_NS: number;
  readonly INTER_AREA: number;
  readonly Mat: OpenCvMatConstructor;
  readonly Size: OpenCvSizeConstructor;
  cvtColor(src: OpenCvMat, dst: OpenCvMat, code: number): void;
  GaussianBlur(src: OpenCvMat, dst: OpenCvMat, ksize: OpenCvSize, sigmaX: number): void;
  Canny(image: OpenCvMat, edges: OpenCvMat, threshold1: number, threshold2: number): void;
  inpaint(
    src: OpenCvMat,
    inpaintMask: OpenCvMat,
    dst: OpenCvMat,
    inpaintRadius: number,
    flags: number,
  ): void;
  HoughLinesP(
    image: OpenCvMat,
    lines: OpenCvMat,
    rho: number,
    theta: number,
    threshold: number,
    minLineLength?: number,
    maxLineGap?: number,
  ): void;
  resize(
    src: OpenCvMat,
    dst: OpenCvMat,
    dsize: OpenCvSize,
    fx?: number,
    fy?: number,
    interpolation?: number,
  ): void;
  getBuildInformation(): string;
}

type OpenCvModuleShape = OpenCvApi & {
  Mat?: unknown;
  onRuntimeInitialized?: (() => void) | null;
};

let cvPromise: Promise<OpenCvApi> | null = null;

function loadOpenCv(): Promise<OpenCvApi> {
  if (!cvPromise) cvPromise = importOpenCv();
  return cvPromise;
}

async function importOpenCv(): Promise<OpenCvApi> {
  // The package's .d.ts only carries the class types; the runtime export is
  // the Emscripten module, a promise of it (current shape), or a namespace
  // wrapping either, depending on the bundler. Normalize all three.
  const raw = (await import("@techstark/opencv-js")) as unknown;
  const maybeDefault = (raw as { default?: unknown }).default ?? raw;
  const settled = (maybeDefault instanceof Promise ? await maybeDefault : maybeDefault) as OpenCvModuleShape;
  if (!settled.Mat) {
    await new Promise<void>((resolve) => {
      settled.onRuntimeInitialized = () => resolve();
    });
  }
  return settled;
}

function openCvVersion(cv: OpenCvApi): string {
  const match = /OpenCV (\d+\.\d+\.\d+)/.exec(cv.getBuildInformation());
  return match?.[1] ?? "unknown";
}

function grayscale(cv: OpenCvApi, request: GrayscaleRequest): VisionWorkerResponse {
  const src = new cv.Mat(request.height, request.width, cv.CV_8UC4);
  try {
    src.data.set(request.data);
    const dst = new cv.Mat();
    try {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      return {
        id: request.id,
        kind: "grayscale",
        width: request.width,
        height: request.height,
        data: new Uint8ClampedArray(dst.data),
      };
    } finally {
      dst.delete();
    }
  } finally {
    src.delete();
  }
}

function straighten(cv: OpenCvApi, request: StraightenRequest): VisionWorkerResponse {
  // Downscale (never upscale) so detection cost is bounded and Hough
  // parameters tuned for STRAIGHTEN_WORKING_WIDTH apply to every photo.
  const scale = Math.min(1, STRAIGHTEN_WORKING_WIDTH / request.width);
  const workWidth = Math.max(1, Math.round(request.width * scale));
  const workHeight = Math.max(1, Math.round(request.height * scale));
  const mats: OpenCvMat[] = [];
  try {
    const src = new cv.Mat(request.height, request.width, cv.CV_8UC4);
    mats.push(src);
    src.data.set(request.data);
    const small = new cv.Mat();
    mats.push(small);
    cv.resize(src, small, new cv.Size(workWidth, workHeight), 0, 0, cv.INTER_AREA);
    const gray = new cv.Mat();
    mats.push(gray);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    const blurred = new cv.Mat();
    mats.push(blurred);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    const edges = new cv.Mat();
    mats.push(edges);
    cv.Canny(blurred, edges, STRAIGHTEN_CANNY_LOW, STRAIGHTEN_CANNY_HIGH);
    const lines = new cv.Mat();
    mats.push(lines);
    cv.HoughLinesP(
      edges,
      lines,
      1,
      Math.PI / 180,
      STRAIGHTEN_HOUGH_THRESHOLD,
      STRAIGHTEN_HOUGH_MIN_LINE_LENGTH,
      STRAIGHTEN_HOUGH_MAX_LINE_GAP,
    );
    // HoughLinesP outputs one CV_32SC4 element per segment: x1, y1, x2, y2.
    // The JS binding lays them out as a 1xN row (not Nx1), so count from the
    // buffer length rather than rows/cols to stay shape-agnostic.
    const segments: LineSegment[] = [];
    const raw = lines.data32S;
    const count = Math.floor(raw.length / 4);
    for (let i = 0; i < count; i += 1) {
      const x1 = raw[i * 4] ?? 0;
      const y1 = raw[i * 4 + 1] ?? 0;
      const x2 = raw[i * 4 + 2] ?? 0;
      const y2 = raw[i * 4 + 3] ?? 0;
      segments.push({ x1, y1, x2, y2 });
    }
    const vote = voteStraightenAngle(segments);
    return { id: request.id, kind: "straighten", angle: vote.angle, confidence: vote.confidence };
  } finally {
    for (const mat of mats.reverse()) mat.delete();
  }
}

function inpaint(
  cv: OpenCvApi,
  request: InpaintRequest,
  postMessage: (message: VisionWorkerResponse) => void,
): VisionWorkerResponse {
  // Full caller resolution (preview or export): no downscaling, the mask
  // already matches the pixels. Heal is pure TypeScript (no OpenCV) and
  // fills the exact mask; diffusion dilates the fill region by the same
  // amount the caller dilates its blend mask, so fringe reconstruction is
  // kept. Mat wrangling is shared with the Node golden tests through
  // inpaintWithCv.
  if (request.method === "heal") {
    // Progress is throttled: exemplar fill reports every iteration, and the
    // UI only needs a few updates per second.
    let lastPost = 0;
    const result = healRepair(
      { width: request.width, height: request.height, data: request.data },
      { width: request.width, height: request.height, data: request.mask },
      {
        quality: request.quality ?? "balanced",
        seamlessLight: request.seamlessLight ?? false,
        onProgress: (fraction, stage) => {
          const now = performance.now();
          if (now - lastPost > 50 || fraction >= 1) {
            lastPost = now;
            postMessage({ id: request.id, kind: "inpaint-progress", fraction, stage });
          }
        },
      },
    );
    return {
      id: request.id,
      kind: "inpaint",
      width: result.width,
      height: result.height,
      data: result.data,
    };
  }
  const fill = dilateRepairMask(
    { width: request.width, height: request.height, data: request.mask },
    INPAINT_DILATE_PX,
  );
  const result = inpaintWithCv(
    cv,
    { width: request.width, height: request.height, data: request.data },
    fill,
    request.radius,
    request.method,
  );
  return {
    id: request.id,
    kind: "inpaint",
    width: result.width,
    height: result.height,
    data: result.data,
  };
}

async function handle(
  request: VisionWorkerRequest,
  postMessage: (message: VisionWorkerResponse) => void,
): Promise<VisionWorkerResponse> {
  const cv = await loadOpenCv();
  if (request.kind === "ping") {
    return { id: request.id, kind: "pong", version: openCvVersion(cv) };
  }
  if (request.kind === "straighten") {
    return straighten(cv, request);
  }
  if (request.kind === "inpaint") {
    return inpaint(cv, request, postMessage);
  }
  return grayscale(cv, request);
}

interface WorkerScope {
  postMessage(message: VisionWorkerResponse): void;
  onmessage: ((event: MessageEvent<VisionWorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<VisionWorkerRequest>) => {
  const request = event.data;
  if (!isVisionWorkerRequest(request)) return;
  void handle(request, (message) => scope.postMessage(message)).then(
    (response) => scope.postMessage(response),
    (error: unknown) =>
      scope.postMessage({
        id: request.id,
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};
