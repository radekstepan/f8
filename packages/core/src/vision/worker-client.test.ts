import { describe, expect, it, vi } from "vitest";
import {
  VisionWorkerClient,
  VisionWorkerError,
  type VisionWorkerPort,
  type VisionWorkerStatus,
} from "./worker-client.js";
import type { VisionWorkerRequest } from "./worker-protocol.js";
import { solidColor } from "./fixtures.js";

type Listener = (event: { readonly data?: unknown }) => void;

class FakePort implements VisionWorkerPort {
  sent: VisionWorkerRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  postMessage(message: VisionWorkerRequest): void {
    if (this.terminated) throw new Error("Port is terminated.");
    this.sent.push(message);
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  emitError(type: "messageerror" | "error" = "error"): void {
    for (const listener of this.listeners.get(type) ?? []) listener({});
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

/** Flush microtasks so the client's async send has registered before we answer. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(options: { timeoutMs?: number } = {}): {
  client: VisionWorkerClient;
  ports: FakePort[];
  statuses: VisionWorkerStatus[];
} {
  const ports: FakePort[] = [];
  const client = new VisionWorkerClient(() => {
    const port = new FakePort();
    ports.push(port);
    return port;
  }, options);
  const statuses: VisionWorkerStatus[] = [];
  client.subscribe((status) => statuses.push(status));
  return { client, ports, statuses };
}

describe("VisionWorkerClient", () => {
  it("starts idle with no version and no worker", () => {
    const { client, ports } = setup();
    expect(client.status).toBe("idle");
    expect(client.version).toBeNull();
    expect(ports).toHaveLength(0);
  });

  it("becomes ready on pong and reports the OpenCV version", async () => {
    const { client, ports, statuses } = setup();
    const ready = client.ensureReady();
    expect(client.status).toBe("loading");
    expect(ports).toHaveLength(1);
    expect(ports[0]?.sent).toEqual([{ id: 1, kind: "ping" }]);
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    expect(client.status).toBe("ready");
    expect(client.version).toBe("5.0.0");
    expect(statuses).toEqual(["loading", "ready"]);
  });

  it("shares one init across concurrent ensureReady calls", async () => {
    const { client, ports } = setup();
    const first = client.ensureReady();
    const second = client.ensureReady();
    expect(ports).toHaveLength(1);
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await Promise.all([first, second]);
    expect(ports[0]?.sent).toHaveLength(1);
  });

  it("round-trips grayscale after implicit init", async () => {
    const { client, ports } = setup();
    const pending = client.grayscale(solidColor(4, 4, 10, 20, 30));
    await tick();
    expect(ports).toHaveLength(1);
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await client.ensureReady();
    await tick();
    expect(ports[0]?.sent[1]).toMatchObject({ id: 2, kind: "grayscale", width: 4, height: 4 });
    ports[0]?.emit({ id: 2, kind: "grayscale", width: 4, height: 4, data: new Uint8ClampedArray(16).fill(18) });
    const result = await pending;
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(Array.from(result.data)).toEqual(new Array(16).fill(18));
  });

  it("round-trips straighten and clamps the angle to the slider range", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    const pending = client.straighten(solidColor(8, 6, 10, 20, 30));
    await tick();
    expect(ports[0]?.sent[1]).toMatchObject({ id: 2, kind: "straighten", width: 8, height: 6 });
    ports[0]?.emit({ id: 2, kind: "straighten", angle: -45, confidence: 0.9 });
    await expect(pending).resolves.toEqual({ angle: -15, confidence: 0.9 });
  });

  it("rejects malformed straighten images before touching the worker", async () => {
    const { client, ports } = setup();
    await expect(
      client.straighten({ width: 8, height: 6, data: new Uint8ClampedArray(8) }),
    ).rejects.toThrow(RangeError);
    expect(ports).toHaveLength(0);
  });

  it("round-trips inpaint with mask, radius, and method", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    const image = solidColor(8, 6, 10, 20, 30);
    const mask = { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6) };
    const pending = client.inpaint(image, mask, 5, "ns");
    await tick();
    expect(ports[0]?.sent[1]).toMatchObject({ id: 2, kind: "inpaint", width: 8, height: 6, radius: 5, method: "ns" });
    expect((ports[0]?.sent[1] as { mask?: unknown }).mask).toBe(mask.data);
    ports[0]?.emit({ id: 2, kind: "inpaint", width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4).fill(7) });
    const result = await pending;
    expect(result.width).toBe(8);
    expect(result.height).toBe(6);
    expect(Array.from(result.data)).toEqual(new Array(8 * 6 * 4).fill(7));
  });

  it("rejects malformed inpaint input before touching the worker", async () => {
    const { client, ports } = setup();
    const image = solidColor(4, 4, 0, 0, 0);
    const mask = { width: 4, height: 4, data: new Uint8ClampedArray(16) };
    await expect(client.inpaint(image, { width: 2, height: 2, data: new Uint8ClampedArray(4) }, 3, "telea")).rejects.toThrow(
      RangeError,
    );
    await expect(client.inpaint(image, mask, 0, "telea")).rejects.toThrow(RangeError);
    await expect(client.inpaint(image, mask, 3, "patchmatch" as never)).rejects.toThrow(RangeError);
    await expect(client.inpaint(image, mask, 3, "heal", { quality: "ultra" as never })).rejects.toThrow(
      RangeError,
    );
    expect(ports).toHaveLength(0);
  });

  it("sends the heal quality through to the worker", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    const pending = client.inpaint(
      solidColor(8, 6, 10, 20, 30),
      { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6) },
      3,
      "heal",
      { quality: "best" },
    );
    await tick();
    expect(ports[0]?.sent[1]).toMatchObject({ id: 2, kind: "inpaint", method: "heal", quality: "best" });
    ports[0]?.emit({ id: 2, kind: "inpaint", width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4) });
    await pending;
  });

  it("routes inpaint progress to the subscriber without resolving", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    const calls: Array<[number, string]> = [];
    const pending = client.inpaint(
      solidColor(8, 6, 10, 20, 30),
      { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6) },
      3,
      "heal",
      { onProgress: (fraction, stage) => calls.push([fraction, stage]) },
    );
    await tick();
    ports[0]?.emit({ id: 2, kind: "inpaint-progress", fraction: 0.25, stage: "Healing 1/2" });
    ports[0]?.emit({ id: 2, kind: "inpaint-progress", fraction: 0.75, stage: "Healing 2/2" });
    await tick();
    expect(calls).toEqual([
      [0.25, "Healing 1/2"],
      [0.75, "Healing 2/2"],
    ]);
    // The call is still pending: only the terminal response resolves it.
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    ports[0]?.emit({ id: 2, kind: "inpaint", width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4) });
    await pending;
    expect(settled).toBe(true);
  });

  it("ignores progress for calls without a subscriber and survives a throwing one", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    const plain = client.inpaint(
      solidColor(4, 4, 0, 0, 0),
      { width: 4, height: 4, data: new Uint8ClampedArray(16) },
      3,
      "heal",
    );
    const throwing = client.inpaint(
      solidColor(4, 4, 0, 0, 0),
      { width: 4, height: 4, data: new Uint8ClampedArray(16) },
      3,
      "heal",
      {
        onProgress: () => {
          throw new Error("subscriber boom");
        },
      },
    );
    await tick();
    ports[0]?.emit({ id: 2, kind: "inpaint-progress", fraction: 0.5, stage: "Healing" });
    ports[0]?.emit({ id: 3, kind: "inpaint-progress", fraction: 0.5, stage: "Healing" });
    ports[0]?.emit({ id: 2, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64) });
    ports[0]?.emit({ id: 3, kind: "inpaint", width: 4, height: 4, data: new Uint8ClampedArray(64) });
    await plain;
    await throwing;
    expect(client.status).toBe("ready");
  });

  it("fails when the worker answers ping with an error", async () => {
    const { client, ports, statuses } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "error", message: "WASM missing" });
    await expect(ready).rejects.toThrow(VisionWorkerError);
    await expect(ready).rejects.toThrow("WASM missing");
    expect(client.status).toBe("failed");
    expect(statuses).toEqual(["loading", "failed"]);
    expect(ports[0]?.terminated).toBe(true);
  });

  it("fails when the port errors during init", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emitError();
    await expect(ready).rejects.toThrow(VisionWorkerError);
    expect(client.status).toBe("failed");
  });

  it("fails a live worker on port error so the UI can offer retry", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    ports[0]?.emitError();
    expect(client.status).toBe("failed");
    expect(client.version).toBeNull();
  });

  it("times out a silent worker", async () => {
    const { client, statuses } = setup({ timeoutMs: 5 });
    await expect(client.ensureReady()).rejects.toThrow(/timed out after 5ms/);
    expect(client.status).toBe("failed");
    expect(statuses).toEqual(["loading", "failed"]);
  });

  it("rejects new ops while failed without spawning another worker", async () => {
    const { client, ports } = setup({ timeoutMs: 5 });
    await expect(client.ensureReady()).rejects.toThrow(VisionWorkerError);
    expect(ports).toHaveLength(1);
    await expect(client.grayscale(solidColor(2, 2, 0, 0, 0))).rejects.toThrow(VisionWorkerError);
    expect(ports).toHaveLength(1);
  });

  it("retries with a fresh worker after failure", async () => {
    const { client, ports } = setup({ timeoutMs: 5 });
    await expect(client.ensureReady()).rejects.toThrow(VisionWorkerError);
    const retry = client.ensureReady();
    expect(ports).toHaveLength(2);
    ports[1]?.emit({ id: 2, kind: "pong", version: "5.0.0" });
    await retry;
    expect(client.status).toBe("ready");
  });

  it("rejects malformed images before touching the worker", async () => {
    const { client, ports } = setup();
    await expect(
      client.grayscale({ width: 4, height: 4, data: new Uint8ClampedArray(8) }),
    ).rejects.toThrow(RangeError);
    expect(ports).toHaveLength(0);
  });

  it("ignores malformed messages and unknown ids", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit(null);
    ports[0]?.emit({ id: 999, kind: "pong", version: "bogus" });
    ports[0]?.emit({ id: 1, kind: "pong" });
    expect(client.status).toBe("loading");
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    expect(client.status).toBe("ready");
    expect(client.version).toBe("5.0.0");
  });

  it("terminate rejects pendings, detaches, and returns to idle", async () => {
    const { client, ports, statuses } = setup();
    const ready = client.ensureReady();
    const port = ports[0];
    expect(port?.listenerCount).toBe(3);
    const rejection = expect(ready).rejects.toThrow(/terminated/);
    client.terminate();
    await rejection;
    expect(client.status).toBe("idle");
    expect(port?.terminated).toBe(true);
    expect(port?.listenerCount).toBe(0);
    expect(statuses).toEqual(["loading", "idle"]);
    // A later ensureReady restarts cleanly (React StrictMode remount path).
    const restart = client.ensureReady();
    ports[1]?.emit({ id: 2, kind: "pong", version: "5.0.0" });
    await restart;
    expect(client.status).toBe("ready");
  });

  it("supports unsubscribe", async () => {
    const { client, ports } = setup();
    const spy = vi.fn();
    const unsubscribe = client.subscribe(spy);
    unsubscribe();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    expect(spy).not.toHaveBeenCalled();
  });

  it("survives a throwing subscriber", async () => {
    const { client, ports } = setup();
    client.subscribe(() => {
      throw new Error("subscriber boom");
    });
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    expect(client.status).toBe("ready");
  });

  it("surfaces a worker-side op error without killing the session", async () => {
    const { client, ports } = setup();
    const ready = client.ensureReady();
    ports[0]?.emit({ id: 1, kind: "pong", version: "5.0.0" });
    await ready;
    const pending = client.grayscale(solidColor(2, 2, 0, 0, 0));
    await tick();
    ports[0]?.emit({ id: 2, kind: "error", message: "cvtColor failed" });
    await expect(pending).rejects.toThrow("cvtColor failed");
    expect(client.status).toBe("ready");
  });
});
