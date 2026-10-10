// Vision worker: heavy OpenCV work off the main thread.
//
// Loaded lazily by the app (`new Worker(new URL(...))` in visionClient.ts),
// and OpenCV itself loads lazily inside on the first message via dynamic
// import, so the ~13MB Emscripten bundle is only fetched when a vision
// feature runs. The techstark build is single-file (WASM embedded as base64),
// so there is no separate .wasm asset to serve.

import {
  isVisionWorkerRequest,
  type GrayscaleRequest,
  type VisionWorkerRequest,
  type VisionWorkerResponse,
} from "@photomator/core";

/** Minimal structural view of the OpenCV.js runtime used by Phase 3. */
interface OpenCvMat {
  readonly data: Uint8Array;
  delete(): void;
}

interface OpenCvMatConstructor {
  new (): OpenCvMat;
  new (rows: number, cols: number, type: number): OpenCvMat;
}

interface OpenCvApi {
  readonly CV_8UC4: number;
  readonly COLOR_RGBA2GRAY: number;
  readonly Mat: OpenCvMatConstructor;
  cvtColor(src: OpenCvMat, dst: OpenCvMat, code: number): void;
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

async function handle(request: VisionWorkerRequest): Promise<VisionWorkerResponse> {
  const cv = await loadOpenCv();
  if (request.kind === "ping") {
    return { id: request.id, kind: "pong", version: openCvVersion(cv) };
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
  void handle(request).then(
    (response) => scope.postMessage(response),
    (error: unknown) =>
      scope.postMessage({
        id: request.id,
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};
