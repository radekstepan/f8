// Promise-based client for the vision worker.
//
// Framework-free and DOM-free: it talks to a minimal port interface instead
// of the DOM Worker type, so it runs in Node tests with a fake transport and
// in the app with a Vite module worker behind a thin adapter. Pixel buffers
// are copied by structured clone, never transferred, so callers keep
// ownership of their PixelImage data.

import { assertValidImage, type PixelImage } from "./analyze.js";
import {
  createGrayscaleRequest,
  createPingRequest,
  isVisionWorkerResponse,
  type GrayscaleResponse,
  type PongResponse,
  type VisionRequestId,
  type VisionWorkerRequest,
  type VisionWorkerResponse,
} from "./worker-protocol.js";

export type VisionWorkerStatus = "idle" | "loading" | "ready" | "failed";

/** Minimal transport surface; a DOM Worker satisfies this via an adapter. */
export interface VisionWorkerPort {
  postMessage(message: VisionWorkerRequest): void;
  addEventListener(
    type: "message" | "messageerror" | "error",
    listener: (event: { readonly data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message" | "messageerror" | "error",
    listener: (event: { readonly data?: unknown }) => void,
  ): void;
  terminate(): void;
}

export interface VisionWorkerClientOptions {
  /** Per-request timeout in ms. Applies to init (WASM download + compile) and ops. */
  timeoutMs?: number;
}

export const DEFAULT_VISION_WORKER_TIMEOUT_MS = 60_000;

export class VisionWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionWorkerError";
  }
}

export interface GrayscaleResult {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface PendingCall {
  resolve: (response: VisionWorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class VisionWorkerClient {
  private port: VisionWorkerPort | null = null;
  private statusValue: VisionWorkerStatus = "idle";
  private versionValue: string | null = null;
  private readonly listeners = new Set<(status: VisionWorkerStatus) => void>();
  private readonly pending = new Map<VisionRequestId, PendingCall>();
  private readyPromise: Promise<void> | null = null;
  private nextId = 1;
  /** Bumped by every detach so a superseded init cannot flip status afterwards. */
  private epoch = 0;
  private readonly timeoutMs: number;

  constructor(
    private readonly createPort: () => VisionWorkerPort,
    options: VisionWorkerClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_VISION_WORKER_TIMEOUT_MS;
  }

  get status(): VisionWorkerStatus {
    return this.statusValue;
  }

  /** OpenCV version reported by the worker once ready, null otherwise. */
  get version(): string | null {
    return this.versionValue;
  }

  subscribe(listener: (status: VisionWorkerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Lazily create the worker and wait for its first pong. Concurrent calls
   * share one init; after failure this retries with a fresh worker.
   */
  ensureReady(): Promise<void> {
    if (this.statusValue === "ready") return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.init();
    return this.readyPromise;
  }

  /** Convert an RGBA image to single-channel luma in the worker. */
  async grayscale(image: PixelImage): Promise<GrayscaleResult> {
    assertValidImage(image);
    // Ops never auto-retry: a failed init (e.g. no network for the WASM
    // download) would otherwise refetch megabytes on every call. The UI
    // offers an explicit retry via ensureReady().
    if (this.statusValue === "failed") {
      throw new VisionWorkerError("Vision worker failed; call ensureReady() to retry.");
    }
    await this.ensureReady();
    const id = this.nextId;
    this.nextId += 1;
    const response = (await this.send(createGrayscaleRequest(id, image))) as GrayscaleResponse;
    return { width: response.width, height: response.height, data: response.data };
  }

  /** Stop the worker, reject pending calls, return to idle for a later restart. */
  terminate(): void {
    this.detachPort(new VisionWorkerError("Vision worker was terminated."));
    this.versionValue = null;
    this.setStatus("idle");
  }

  private async init(): Promise<void> {
    const epoch = this.epoch;
    this.setStatus("loading");
    try {
      this.port = this.createPort();
    } catch (error) {
      return this.initFailed(epoch, error);
    }
    this.port.addEventListener("message", this.handleMessage);
    this.port.addEventListener("messageerror", this.handlePortError);
    this.port.addEventListener("error", this.handlePortError);
    try {
      const id = this.nextId;
      this.nextId += 1;
      const response = (await this.send(createPingRequest(id))) as PongResponse;
      if (epoch !== this.epoch) throw new VisionWorkerError("Vision worker init was superseded.");
      this.versionValue = response.version;
      this.readyPromise = null;
      this.setStatus("ready");
    } catch (error) {
      return this.initFailed(epoch, error);
    }
  }

  private initFailed(epoch: number, error: unknown): Promise<void> {
    // A superseded init (terminate/restart raced it) must not touch status;
    // its own caller still sees the original rejection.
    if (epoch !== this.epoch) throw error;
    const message = error instanceof Error ? error.message : String(error);
    this.transitionToFailed(message);
    return Promise.reject(new VisionWorkerError(message));
  }

  private transitionToFailed(message: string): void {
    this.detachPort(new VisionWorkerError(message));
    this.versionValue = null;
    this.setStatus("failed");
  }

  private send(request: VisionWorkerRequest): Promise<VisionWorkerResponse> {
    const port = this.port;
    if (!port) return Promise.reject(new VisionWorkerError("Vision worker is not running."));
    return new Promise<VisionWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new VisionWorkerError(`Vision worker timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      this.pending.set(request.id, { resolve, reject, timer });
      try {
        port.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(error instanceof Error ? error : new VisionWorkerError(String(error)));
      }
    });
  }

  private readonly handleMessage = (event: { readonly data?: unknown }): void => {
    const response = event.data;
    if (!isVisionWorkerResponse(response)) return;
    const call = this.pending.get(response.id);
    if (!call) return;
    clearTimeout(call.timer);
    this.pending.delete(response.id);
    if (response.kind === "error") {
      call.reject(new VisionWorkerError(response.message));
    } else {
      call.resolve(response);
    }
  };

  private readonly handlePortError = (): void => {
    if (this.statusValue === "ready") {
      // A live worker died mid-session; surface it so the UI can offer retry.
      this.transitionToFailed("Vision worker reported an error.");
    } else if (this.readyPromise) {
      for (const call of this.pending.values()) {
        clearTimeout(call.timer);
        call.reject(new VisionWorkerError("Vision worker failed to start."));
      }
      this.pending.clear();
    }
  };

  private detachPort(error: Error): void {
    this.epoch += 1;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
    this.readyPromise = null;
    if (this.port) {
      const port = this.port;
      this.port = null;
      port.removeEventListener("message", this.handleMessage);
      port.removeEventListener("messageerror", this.handlePortError);
      port.removeEventListener("error", this.handlePortError);
      port.terminate();
    }
  }

  private setStatus(status: VisionWorkerStatus): void {
    if (status === this.statusValue) return;
    this.statusValue = status;
    for (const listener of [...this.listeners]) {
      try {
        listener(status);
      } catch {
        // A throwing subscriber must not break worker state transitions.
      }
    }
  }
}
