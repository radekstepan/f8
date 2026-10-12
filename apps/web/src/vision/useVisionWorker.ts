// React binding for the vision worker: readiness state plus a 4x4 grayscale
// self-test that proves OpenCV computes (not just loads) in the browser.

import { useCallback, useEffect, useState } from "react";
import { grayscaleReference, solidColor, type VisionWorkerStatus } from "@f8/core";
import { getVisionWorkerClient } from "./visionClient";

export interface VisionWorkerState {
  status: VisionWorkerStatus;
  version: string | null;
  /** Settles after the first successful init; null until then. */
  selfTest: boolean | null;
  error: string | null;
  ensureReady: () => Promise<void>;
}

async function runSelfTest(): Promise<boolean> {
  try {
    const fixture = solidColor(4, 4, 200, 100, 50);
    const expected = grayscaleReference(fixture);
    const actual = await getVisionWorkerClient().grayscale(fixture);
    if (actual.width !== 4 || actual.height !== 4 || actual.data.length !== 16) return false;
    // OpenCV uses integer math; allow +-1 against the float reference.
    return actual.data.every((value, i) => Math.abs(value - (expected[i] ?? 0)) <= 1);
  } catch {
    return false;
  }
}

export function useVisionWorker(): VisionWorkerState {
  const [client] = useState(getVisionWorkerClient);
  const [status, setStatus] = useState<VisionWorkerStatus>(client.status);
  const [version, setVersion] = useState<string | null>(client.version);
  const [selfTest, setSelfTest] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = client.subscribe((next) => {
      if (cancelled) return;
      setStatus(next);
      setVersion(client.version);
      if (next !== "failed") setError(null);
      if (next === "ready") {
        setSelfTest(null);
        void runSelfTest().then((passed) => {
          if (!cancelled) setSelfTest(passed);
        });
      } else if (next === "idle") {
        setSelfTest(null);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client]);

  const ensureReady = useCallback(async () => {
    setError(null);
    try {
      await client.ensureReady();
      setVersion(client.version);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  return { status, version, error, selfTest, ensureReady };
}
