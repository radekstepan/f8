// React binding for import-time cull assist: the album "find blurry
// photos" action plus its in-flight flag for the progress toast.
//
// Labeling needs no warmup (the server pass is classical), so unlike the
// semantic hook this is a single request with a busy flag — no progress
// polling, no retry dance.

import { useCallback, useState } from "react";
import type { CullAlbumReport } from "@f8/core";
import { runRemoteCullAlbum } from "./remoteCullAssist";

export function useCullAssist() {
  const [culling, setCulling] = useState(false);

  const cullAlbum = useCallback(async (albumId: string): Promise<CullAlbumReport> => {
    setCulling(true);
    try {
      return await runRemoteCullAlbum(albumId);
    } finally {
      setCulling(false);
    }
  }, []);

  return { culling, cullAlbum };
}

export type CullAssist = ReturnType<typeof useCullAssist>;
