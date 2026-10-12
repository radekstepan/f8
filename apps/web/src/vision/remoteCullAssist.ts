// Remote import-time cull assist: one POST per album, the server assesses
// blur and near-duplicates over its cached thumbs and answers with the
// cull report.
//
// Unlike the semantic transport there are no pixels on the wire and no
// weights to provision — the pass is classical plus embedded coefficients,
// so no warmup polling: a single request always finishes the job.

import { LibraryError, createLibraryClient, type CullAlbumReport } from "@f8/core";

export class RemoteCullAssistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteCullAssistError";
  }
}

const client = createLibraryClient();

export async function runRemoteCullAlbum(albumId: string): Promise<CullAlbumReport> {
  try {
    return await client.cullAlbum(albumId);
  } catch (error) {
    if (error instanceof LibraryError && error.status === 0) {
      throw new RemoteCullAssistError("Photo server unreachable — start it with yarn dev.");
    }
    throw new RemoteCullAssistError(error instanceof Error ? error.message : "Cull assist failed.");
  }
}
