// Vite wiring for the vision worker: constructs the module worker and adapts
// the DOM Worker surface to the framework-free VisionWorkerPort.

import { VisionWorkerClient, type VisionWorkerPort, type VisionWorkerRequest } from "@photomator/core";

type PortListener = (event: { readonly data?: unknown }) => void;

function createPort(): VisionWorkerPort {
  const worker = new Worker(new URL("../workers/vision.worker.ts", import.meta.url), { type: "module" });
  const wrapped = new Map<PortListener, EventListener>();
  const toListener = (listener: PortListener): EventListener => {
    let fn = wrapped.get(listener);
    if (!fn) {
      fn = (event: Event) => listener(event as MessageEvent);
      wrapped.set(listener, fn);
    }
    return fn;
  };
  return {
    postMessage: (message: VisionWorkerRequest) => worker.postMessage(message),
    addEventListener: (type, listener) => worker.addEventListener(type, toListener(listener)),
    removeEventListener: (type, listener) => {
      const fn = wrapped.get(listener);
      if (fn) {
        worker.removeEventListener(type, fn);
        wrapped.delete(listener);
      }
    },
    terminate: () => worker.terminate(),
  };
}

/** Fresh client (tests, one-off tasks). Prefer the shared singleton in UI. */
export function createVisionWorkerClient(): VisionWorkerClient {
  return new VisionWorkerClient(createPort);
}

let shared: VisionWorkerClient | null = null;

/** App-wide client. Creating it is cheap; the worker spawns on ensureReady. */
export function getVisionWorkerClient(): VisionWorkerClient {
  if (!shared) shared = createVisionWorkerClient();
  return shared;
}
