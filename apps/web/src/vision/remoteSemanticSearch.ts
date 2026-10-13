// Remote local semantic search: text queries rank on the photo server
// against stored CLIP-image embeddings. (Labeling needs no transport: every
// import embeds + labels itself in a server background queue.)
//
// Unlike the detect transports there are no pixels on the wire: search POSTs
// a query string and the server does the rest.

import { LibraryError, createLibraryClient, type SemanticSearchResponse } from "@f8/core";

export class RemoteSemanticSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteSemanticSearchError";
  }
}

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

