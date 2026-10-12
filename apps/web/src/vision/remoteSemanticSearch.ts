// Remote local semantic search: text queries rank on the photo server
// against stored CLIP-image embeddings, and album labeling embeds + labels
// every photo that lacks ML labels yet.
//
// Unlike the detect transports there are no pixels on the wire: search POSTs
// a query string, labeling POSTs an album id, and the server does the rest.
// The first labeling run downloads the ~89MB vision weights once; warmup
// polling reports that download with real progress, like the other ML paths.

import { LibraryError, createLibraryClient, type LabelAlbumReport, type SemanticSearchResponse } from "@f8/core";

export class RemoteSemanticSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteSemanticSearchError";
  }
}

/** Thrown when labeling needs the one-time weight download first. */
export class SemanticWeightsMissingError extends RemoteSemanticSearchError {
  constructor(message: string) {
    super(message);
    this.name = "SemanticWeightsMissingError";
  }
}

export type SemanticSearchProgress = (fraction: number, stage: string) => void;

const client = createLibraryClient();

function unreachable(error: unknown): RemoteSemanticSearchError {
  if (error instanceof LibraryError && error.status === 0) {
    return new RemoteSemanticSearchError("Photo server unreachable — start it with yarn dev.");
  }
  return new RemoteSemanticSearchError(error instanceof Error ? error.message : "Semantic search failed.");
}

export async function runRemoteSemanticSearch(
  q: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<SemanticSearchResponse> {
  try {
    // The shared client has no abort plumbing; the hook drops stale
    // responses by request id, so an in-flight search never needs canceling.
    void options.signal;
    return await client.semanticSearch(q, options.limit);
  } catch (error) {
    throw unreachable(error);
  }
}

export async function runRemoteLabelAlbum(albumId: string): Promise<LabelAlbumReport> {
  try {
    return await client.labelAlbum(albumId);
  } catch (error) {
    // The label route only 503s for missing weights (needsDownload); every
    // other failure surfaces with the server's message.
    if (error instanceof LibraryError && error.status === 503) {
      throw new SemanticWeightsMissingError(error.message);
    }
    throw unreachable(error);
  }
}

/**
 * Warm the labeling endpoint: kick provisioning and poll health until the
 * weights land and the session warms, reporting real download %. Search
 * needs no warmup (it serves over stored data immediately).
 */
export async function warmupRemoteSemanticSearch(
  options: { onProgress?: SemanticSearchProgress; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const startedAt = Date.now();
  options.onProgress?.(0, "Checking photo server…");
  try {
    await client.semanticWarmup();
  } catch {
    // Unreachable server surfaces via the poll below.
  }
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let snapshot;
    try {
      snapshot = await client.semanticHealth();
    } catch (error) {
      throw unreachable(error);
    }
    if (snapshot.error) throw new RemoteSemanticSearchError(snapshot.error.slice(0, 220));
    if (snapshot.weightsReady && snapshot.sessionsWarm) {
      options.onProgress?.(1, "Server ready.");
      return;
    }
    if (snapshot.downloading) {
      const pct = Math.max(0, Math.min(0.99, snapshot.downloadPct));
      options.onProgress?.(pct, `Downloading models… ${Math.round(pct * 100)}%`);
    } else {
      options.onProgress?.(0, "Preparing models…");
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new RemoteSemanticSearchError("Photo server is still preparing models — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
